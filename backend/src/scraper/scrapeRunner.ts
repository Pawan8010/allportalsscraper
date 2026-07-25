import { TenderStatus } from "@prisma/client";
import { prisma } from "../config/db";
import { config } from "../config/env";
import { logger } from "../utils/logger";
import { scrapeGemApi } from "./gemApiScraper";
import { upsertScrapedTenders } from "../services/tenderService";

/** FULL sweeps every listed page; NEW only walks the newest pages. */
export type ScrapeMode = "FULL" | "NEW";

export interface StartScrapeOptions {
  mode?: ScrapeMode;
  maxPages?: number;
  sort?: string;
  startPage?: number;
  /** Continue an interrupted run of the same mode instead of restarting. */
  resume?: boolean;
}

export interface StartedScrape {
  runId: string;
  mode: ScrapeMode;
  status: string;
  startedAt: Date;
  /** Page the sweep begins on - above 1 when resuming. */
  startPage: number;
  /** Pages inherited from an interrupted run and queued for another attempt. */
  retryPages: number[];
  resumedFromRunId: string | null;
}

let scrapeInProgress = false;
let currentRunId: string | null = null;

export function isScrapeInProgress(): boolean {
  return scrapeInProgress;
}

export function getCurrentRunId(): string | null {
  return currentRunId;
}

/**
 * A run is considered abandoned once its heartbeat is this old. A live scrape
 * writes progress at most once a second, so this is a wide margin.
 */
export const STALE_RUN_THRESHOLD_MS = 120_000;

/**
 * A RUNNING row whose heartbeat has gone quiet belonged to a process that died
 * mid-scrape. Mark those INTERRUPTED (not FAILED) so a later run can tell the
 * difference and resume from the recorded watermark. No tender rows are touched.
 *
 * The heartbeat check is what makes this safe to run at startup: a second
 * backend booting against the same database used to flip the first one's
 * actively-running scrape to INTERRUPTED, which both lied about the run's state
 * and poisoned the resume watermark for every later sweep.
 */
export async function markInterruptedScrapes(now: Date = new Date()): Promise<number> {
  const staleBefore = new Date(now.getTime() - STALE_RUN_THRESHOLD_MS);

  const result = await prisma.scrapeRun.updateMany({
    where: {
      status: "RUNNING",
      OR: [
        { heartbeatAt: null, startedAt: { lt: staleBefore } },
        { heartbeatAt: { lt: staleBefore } },
      ],
    },
    data: {
      status: "INTERRUPTED",
      finishedAt: now,
      errorMessage: "Interrupted before completion. A new scrape of the same mode will resume from the last stored page.",
    },
  });

  if (result.count > 0) {
    logger.warn(`[scrapeRunner] Marked ${result.count} abandoned scrape run(s) as INTERRUPTED`);
  }

  const stillRunning = await prisma.scrapeRun.count({ where: { status: "RUNNING" } });
  if (stillRunning > 0) {
    logger.info(
      `[scrapeRunner] Left ${stillRunning} scrape run(s) alone - their heartbeat is current, so another process is still working on them`
    );
  }

  return result.count;
}

function parseFailedPages(value: string | null): number[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is number => Number.isInteger(entry)) : [];
  } catch {
    return [];
  }
}

/**
 * Tracks which pages have been stored so `lastPage` is a genuinely safe resume
 * point. Pages complete out of order under concurrency, so the watermark is the
 * highest *contiguous* completed page - resuming from a plain maximum would
 * skip the gaps behind it.
 */
class PageWatermark {
  private readonly completed = new Set<number>();
  private watermark: number;

  constructor(startFrom: number) {
    this.watermark = startFrom;
  }

  complete(page: number): number {
    this.completed.add(page);
    while (this.completed.has(this.watermark + 1)) {
      this.watermark += 1;
      this.completed.delete(this.watermark);
    }
    return this.watermark;
  }

  get value(): number {
    return this.watermark;
  }
}

/** Statuses that mean a run stopped before covering the whole listing. */
const INCOMPLETE_STATUSES = ["INTERRUPTED", "PARTIAL", "FAILED"];

export interface ResumePoint {
  startPage: number;
  retryPages: number[];
  resumedFromRunId: string | null;
}

/**
 * Works out where a sweep of `mode` should begin.
 *
 * Only the MOST RECENT completed run of that portal and mode is consulted:
 *
 * - Looking up the latest *incomplete* run instead let a stale `INTERRUPTED`
 *   watermark keep winning even after a later run had swept through to the end,
 *   so every subsequent full sweep restarted mid-listing and the pages before
 *   the watermark were never read again.
 * - A `RUNNING` row is skipped rather than resumed from: it belongs to a scrape
 *   that is still moving, and its watermark is not a finished result.
 */
export async function resolveResumePoint(
  mode: string,
  configuredStartPage: number,
  portal = "GeM"
): Promise<ResumePoint> {
  const previous = await prisma.scrapeRun.findFirst({
    where: { mode, portal, status: { not: "RUNNING" } },
    orderBy: { startedAt: "desc" },
    select: { id: true, status: true, lastPage: true, failedPages: true },
  });

  if (!previous) return { startPage: configuredStartPage, retryPages: [], resumedFromRunId: null };

  if (!INCOMPLETE_STATUSES.includes(previous.status)) {
    logger.info(
      `[scrapeRunner] Previous ${mode} run ${previous.id} finished as ${previous.status} - starting a fresh sweep from page ${configuredStartPage}`
    );
    return { startPage: configuredStartPage, retryPages: [], resumedFromRunId: null };
  }

  if (previous.lastPage <= 0) {
    return { startPage: configuredStartPage, retryPages: [], resumedFromRunId: null };
  }

  const startPage = Math.max(configuredStartPage, previous.lastPage + 1);
  const retryPages = parseFailedPages(previous.failedPages);
  logger.info(
    `[scrapeRunner] Resuming ${mode} scrape from page ${startPage} (run ${previous.id}, ${retryPages.length} failed page(s) re-queued)`
  );
  return { startPage, retryPages, resumedFromRunId: previous.id };
}

/**
 * Creates the scrape run row and starts the work in the background.
 *
 * Returns as soon as the row exists so the caller gets a run id to poll -
 * the API is never blocked by a scrape.
 */
export async function startScrape(options: StartScrapeOptions = {}): Promise<StartedScrape> {
  if (scrapeInProgress) {
    throw new ScrapeInProgressError(currentRunId);
  }

  const mode: ScrapeMode = options.mode ?? "FULL";

  let startPage = options.startPage ?? (mode === "NEW" ? 1 : config.scraperStartPage);
  let retryPages: number[] = [];
  let resumedFromRunId: string | null = null;

  if (options.resume !== false) {
    const point = await resolveResumePoint(mode, startPage);
    startPage = point.startPage;
    retryPages = point.retryPages;
    resumedFromRunId = point.resumedFromRunId;
  }

  scrapeInProgress = true;

  let run;
  try {
    run = await prisma.scrapeRun.create({
      data: {
        portal: "GeM",
        mode,
        status: "RUNNING",
        lastPage: Math.max(0, startPage - 1),
        heartbeatAt: new Date(),
      },
    });
  } catch (error) {
    scrapeInProgress = false;
    throw error;
  }

  currentRunId = run.id;

  // Deliberately not awaited - the HTTP handler returns the run id immediately.
  void executeScrape(run.id, { mode, startPage, retryPages, maxPages: options.maxPages, sort: options.sort })
    .catch((error) => {
      logger.error(`[scrapeRunner] Run ${run.id} threw: ${error instanceof Error ? error.message : error}`);
    })
    .finally(() => {
      scrapeInProgress = false;
      currentRunId = null;
    });

  return {
    runId: run.id,
    mode,
    status: run.status,
    startedAt: run.startedAt,
    startPage,
    retryPages,
    resumedFromRunId,
  };
}

export class ScrapeInProgressError extends Error {
  readonly runId: string | null;
  constructor(runId: string | null) {
    super("A scrape is already in progress");
    this.runId = runId;
  }
}

interface ExecuteOptions {
  mode: ScrapeMode;
  startPage: number;
  retryPages: number[];
  maxPages?: number;
  sort?: string;
}

/**
 * Flushes the GIN pending lists and refreshes planner statistics after a scrape.
 *
 * GIN indexes buffer newly inserted rows in an unordered "pending list" instead
 * of merging them into the tree immediately. Every subsequent index scan has to
 * read that list linearly, so a large scrape quietly makes search several times
 * slower until autovacuum eventually catches up - measured on the live corpus,
 * a search that runs in 0.49s degraded to 2.7s after a scrape, and a
 * three-keyword search from 1.3s to 6.6s.
 *
 * VACUUM cannot run inside a transaction, and it is deliberately not awaited by
 * the caller's critical path: the run is already recorded as finished, so a
 * failure here is logged and nothing else.
 */
export async function refreshSearchIndexes(runId: string): Promise<void> {
  const startedAt = Date.now();
  try {
    await prisma.$executeRawUnsafe('VACUUM (ANALYZE) "tenders"');
    logger.info(`[scrapeRunner] Run ${runId}: search indexes vacuumed in ${Date.now() - startedAt}ms`);
  } catch (error) {
    // Non-fatal: search still returns correct results, just more slowly until
    // autovacuum runs.
    logger.warn(
      `[scrapeRunner] Run ${runId}: VACUUM ANALYZE failed (search may be slower until autovacuum runs): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function executeScrape(runId: string, options: ExecuteOptions): Promise<void> {
  const { mode, startPage, retryPages } = options;
  const maxPages = options.maxPages ?? (mode === "NEW" ? config.newTenderMaxPages : config.scraperMaxPages);
  const sort = options.sort ?? (mode === "NEW" ? "Bid-Start-Date-Latest" : "Bid-End-Date-Oldest");

  const watermark = new PageWatermark(Math.max(0, startPage - 1));
  const seenTenderIds = new Set<string>();
  const failedPages = new Set<number>(retryPages);

  let tendersFound = 0;
  let tendersNew = 0;
  let tendersUpdated = 0;
  let tendersSkipped = 0;
  let statedTotal: number | null = null;
  let maxAvailablePages = 0;
  let lastProgressWrite = 0;

  const writeProgress = async (force = false) => {
    // Throttled: a full sweep is thousands of pages and every write competes
    // with the search queries the API is still serving.
    if (!force && Date.now() - lastProgressWrite < 1000) return;
    lastProgressWrite = Date.now();
    await prisma.scrapeRun.update({
      where: { id: runId },
      data: {
        pagesScraped: watermark.value,
        lastPage: watermark.value,
        tendersFound,
        tendersNew,
        tendersUpdated,
        tendersSkipped,
        errorCount: failedPages.size,
        failedPages: failedPages.size > 0 ? JSON.stringify(Array.from(failedPages).sort((a, b) => a - b)) : null,
        ...(statedTotal !== null ? { statedTotal } : {}),
        heartbeatAt: new Date(),
      },
    });
  };

  try {
    logger.info(`[scrapeRunner] Starting ${mode} GeM scrape (run ${runId}) from page ${startPage}`);

    const scraped = await scrapeGemApi(
      async (pageTenders, page) => {
        const uniquePage = pageTenders.filter((tender) => {
          if (seenTenderIds.has(tender.tenderId)) return false;
          seenTenderIds.add(tender.tenderId);
          return true;
        });
        tendersSkipped += pageTenders.length - uniquePage.length;

        const counts = await upsertScrapedTenders(uniquePage, runId);
        tendersFound += uniquePage.length;
        tendersNew += counts.inserted;
        tendersUpdated += counts.updated;
        tendersSkipped += counts.skipped;

        // Only count the page as done once its rows are committed.
        watermark.complete(page);
        failedPages.delete(page);
        await writeProgress();
      },
      {
        maxPages,
        sort,
        startPage,
        retryPages,
        onTotalKnown: (total, pages) => {
          statedTotal = total;
          maxAvailablePages = pages;
        },
        onPageError: (page, error) => {
          failedPages.add(page);
          logger.warn(`[scrapeRunner] Run ${runId} page ${page} failed: ${error.message}`);
        },
      }
    );

    for (const page of scraped.failedPages) failedPages.add(page);

    // Closing stale bids is only safe when this run genuinely saw the whole
    // current listing. A page-limited or partially failed run must not touch
    // rows it never had the chance to observe.
    const sweptEverything =
      mode === "FULL" && startPage <= 1 && maxPages === 0 && scraped.pagesScraped >= maxAvailablePages;
    const closeStale = sweptEverything && failedPages.size === 0;
    let staleClosed = 0;

    if (closeStale) {
      const result = await prisma.tender.updateMany({
        where: {
          portal: "GeM",
          tenderStatus: TenderStatus.LIVE,
          OR: [{ lastSeenRunId: { not: runId } }, { lastSeenRunId: null }],
        },
        // Marked closed, never deleted - the record and its history stay.
        data: { tenderStatus: TenderStatus.CLOSED, lastUpdated: new Date() },
      });
      staleClosed = result.count;
    }

    const status = failedPages.size === 0 ? "SUCCESS" : "PARTIAL";

    await prisma.scrapeRun.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: new Date(),
        pagesScraped: scraped.pagesScraped,
        lastPage: watermark.value,
        tendersFound,
        tendersNew,
        tendersUpdated,
        tendersSkipped,
        errorCount: failedPages.size,
        statedTotal: scraped.statedTotal,
        failedPages: failedPages.size > 0 ? JSON.stringify(Array.from(failedPages).sort((a, b) => a - b)) : null,
        errorMessage:
          failedPages.size > 0
            ? `${failedPages.size} page(s) failed after retries; ${staleClosed} stale bid(s) closed`
            : `${staleClosed} stale bid(s) closed`,
      },
    });

    logger.info(
      `[scrapeRunner] Run ${runId} ${status}: pages=${scraped.pagesScraped}/${maxAvailablePages}, found=${tendersFound}, new=${tendersNew}, updated=${tendersUpdated}, skipped=${tendersSkipped}, failedPages=${failedPages.size}, staleClosed=${staleClosed}, gemStatedTotal=${scraped.statedTotal}`
    );

    await refreshSearchIndexes(runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.scrapeRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        // Progress so far is preserved so the next run can resume from it.
        pagesScraped: watermark.value,
        lastPage: watermark.value,
        tendersFound,
        tendersNew,
        tendersUpdated,
        tendersSkipped,
        errorCount: Math.max(1, failedPages.size),
        failedPages: failedPages.size > 0 ? JSON.stringify(Array.from(failedPages).sort((a, b) => a - b)) : null,
        ...(statedTotal !== null ? { statedTotal } : {}),
        errorMessage: message,
      },
    });
    logger.error(`[scrapeRunner] Run ${runId} FAILED: ${message}`);
  }
}

export interface ScrapeRunStatus {
  runId: string;
  portal: string;
  status: string;
  mode: string;
  pagesScanned: number;
  tendersFound: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  failedPages: number[];
  gemStatedTotal: number | null;
  lastPage: number;
  startedAt: string;
  finishedAt: string | null;
  message: string | null;
  inProgress: boolean;
}

/** Progress for one run, in the shape the dashboard polls for. */
export async function getScrapeRunStatus(runId: string): Promise<ScrapeRunStatus | null> {
  const run = await prisma.scrapeRun.findUnique({ where: { id: runId } });
  if (!run) return null;

  return {
    runId: run.id,
    portal: run.portal,
    status: run.status,
    mode: run.mode,
    pagesScanned: run.pagesScraped,
    tendersFound: run.tendersFound,
    inserted: run.tendersNew,
    updated: run.tendersUpdated,
    skipped: run.tendersSkipped,
    errors: run.errorCount,
    failedPages: parseFailedPages(run.failedPages),
    gemStatedTotal: run.statedTotal,
    lastPage: run.lastPage,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    message: run.errorMessage,
    inProgress: run.status === "RUNNING",
  };
}

/**
 * Starts a scrape and waits for it to finish. For the CLI (`npm run scrape`)
 * only - HTTP handlers must use `startScrape` so they never block.
 */
export async function runScrapeToCompletion(
  options: StartScrapeOptions = {},
  pollIntervalMs = 2000
): Promise<ScrapeRunStatus> {
  const started = await startScrape(options);

  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const status = await getScrapeRunStatus(started.runId);
    if (!status) throw new Error(`Scrape run ${started.runId} disappeared`);
    if (status.finishedAt) return status;
  }
}

/** The most recent run, used by the dashboard to show last-scrape state. */
export async function getLatestScrapeRun(): Promise<ScrapeRunStatus | null> {
  const run = await prisma.scrapeRun.findFirst({ orderBy: { startedAt: "desc" }, select: { id: true } });
  return run ? getScrapeRunStatus(run.id) : null;
}
