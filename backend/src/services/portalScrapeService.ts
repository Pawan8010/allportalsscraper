import pLimit from "p-limit";
import { prisma } from "./prisma";
import { PORTAL_REGISTRY, getPortalEntry, getEnabledPortals } from "../portals/portalRegistry";
import { PortalTender, ScrapeOptions } from "../portals/portal.types";
import { computeContentHash } from "../utils/hash";
import { logger } from "../utils/logger";
import { env } from "../config/env";

type Mode = "full" | "incremental";

// Per-portal lock so two callers can never scrape the same portal at once.
const runningPortals = new Set<string>();

// In-memory progress for runs that are still in flight (persisted counters
// live on the ScrapeRun row; this just gives live polling something to read
// without hammering the DB on every progress tick).
const liveProgress = new Map<string, { pagesScanned: number; tendersFound: number }>();

export interface ScrapePortalResult {
  runId: string;
  portal: string;
  status: "success" | "partial" | "failed" | "skipped";
  reason?: string;
}

/**
 * Any ScrapeRun still marked "running" when this process starts belongs to
 * a previous process that died or got restarted mid-scrape -- the
 * in-memory `runningPortals` lock that would normally block/track it is
 * gone along with that process, so the row is orphaned and would otherwise
 * sit at "running" forever, inflating "currently active" counts in the UI.
 * Call once at startup, before the scheduler (or anything else) can start
 * a new run.
 */
export async function reconcileOrphanedRuns(): Promise<number> {
  const result = await prisma.scrapeRun.updateMany({
    where: { status: "running" },
    data: {
      status: "failed",
      errorMessage: "Interrupted: the backend process restarted while this run was in progress.",
      finishedAt: new Date(),
    },
  });
  if (result.count > 0) {
    logger.warn({ count: result.count }, "reconciled orphaned scrape runs left 'running' by a previous process");
  }
  return result.count;
}

function tenderToFields(t: PortalTender, portalName: string) {
  return {
    portal: t.portal,
    portalName,
    tenderId: t.tenderId,
    title: t.title,
    organisation: t.organisation ?? null,
    department: t.department ?? null,
    location: t.location ?? null,
    state: t.state ?? null,
    category: t.category ?? null,
    description: t.description ?? null,
    estimatedValue: t.estimatedValue ?? null,
    emdAmount: t.emdAmount ?? null,
    tenderFee: t.tenderFee ?? null,
    publishedDate: t.publishedDate ? new Date(t.publishedDate) : null,
    closingDate: t.closingDate ? new Date(t.closingDate) : null,
    openingDate: t.openingDate ? new Date(t.openingDate) : null,
    status: t.status ?? null,
    tenderURL: t.tenderURL,
    documentURL: t.documentURL ?? null,
    sourceUrl: t.tenderURL,
    sourceUpdatedAt: t.sourceUpdatedAt ? new Date(t.sourceUpdatedAt) : null,
  };
}

export async function upsertTenders(
  tenders: PortalTender[],
  portalName: string,
  runId: string
): Promise<{ inserted: number; updated: number; skipped: number; failed: number }> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const t of tenders) {
    try {
      const fields = tenderToFields(t, portalName);
      const contentHash = computeContentHash(fields as Record<string, unknown>);

      const existing = await prisma.tender.findUnique({
        where: { portal_tenderId: { portal: t.portal, tenderId: t.tenderId } },
      });

      // A tender whose own scraped closingDate is already in the past is
      // never stored as a brand-new row -- otherwise a portal that keeps
      // listing a closed tender for a while would just get it re-inserted
      // on every later scrape, right after the cleanup job deletes it.
      // Rows already in the DB keep updating normally; the cleanup job
      // (tenderCleanupService.ts) removes those on its own schedule.
      if (!existing && fields.closingDate && fields.closingDate < new Date()) {
        skipped++;
        continue;
      }

      if (existing && existing.contentHash === contentHash) {
        // Nothing changed — just bump lastSeenAt/lastSeenRunId, no full write.
        await prisma.tender.update({
          where: { id: existing.id },
          data: { lastSeenAt: new Date(), lastSeenRunId: runId },
        });
        skipped++;
        continue;
      }

      await prisma.tender.upsert({
        where: { portal_tenderId: { portal: t.portal, tenderId: t.tenderId } },
        create: { ...fields, contentHash, lastSeenAt: new Date(), lastSeenRunId: runId },
        update: { ...fields, contentHash, lastSeenAt: new Date(), lastSeenRunId: runId },
      });

      if (existing) updated++;
      else inserted++;
    } catch (err) {
      failed++;
      logger.error({ err: String(err), tenderId: t.tenderId, portal: t.portal }, "upsert failed for tender");
    }
  }

  return { inserted, updated, skipped, failed };
}

export async function scrapePortal(portalKey: string, mode: Mode, maxPages?: number): Promise<ScrapePortalResult> {
  const entry = getPortalEntry(portalKey);
  if (!entry) {
    throw new Error(`Unknown portal key: ${portalKey}`);
  }

  if (!entry.enabled) {
    const run = await prisma.scrapeRun.create({
      data: { portal: portalKey, mode, status: "skipped", errorMessage: "Portal is disabled in the registry." },
    });
    return { runId: run.id, portal: portalKey, status: "skipped", reason: "disabled" };
  }

  // Already-running is a normal, expected condition -- the hourly cron and
  // the startup sweep are frequently mid-scrape when someone clicks "Scrape
  // All" -- so report it as a skip rather than throwing. Throwing here used
  // to surface as a hard "failed" row for perfectly healthy portals.
  if (runningPortals.has(portalKey)) {
    return { runId: "", portal: portalKey, status: "skipped", reason: "already-running" };
  }

  runningPortals.add(portalKey);
  const run = await prisma.scrapeRun.create({
    data: { portal: portalKey, mode, status: "running" },
  });
  liveProgress.set(run.id, { pagesScanned: 0, tendersFound: 0 });

  try {
    const availability = await entry.adapter.checkAvailability();
    if (!availability.available) {
      await prisma.scrapeRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          errorMessage: `[${availability.reason}] ${availability.detail}`,
          finishedAt: new Date(),
        },
      });
      return { runId: run.id, portal: portalKey, status: "failed", reason: availability.reason };
    }

    const controller = new AbortController();
    let statedTotal: number | undefined;
    const options: ScrapeOptions = {
      runId: run.id,
      mode,
      maxPages,
      signal: controller.signal,
      onProgress: (p) => {
        liveProgress.set(run.id, p);
        if (p.statedTotal !== undefined) statedTotal = p.statedTotal;
        prisma.scrapeRun
          .update({
            where: { id: run.id },
            data: { pagesScanned: p.pagesScanned, tendersFound: p.tendersFound, statedTotal },
          })
          .catch((err) => logger.error({ err: String(err) }, "failed to persist progress"));
      },
    };

    const tenders = mode === "full" ? await entry.adapter.scrapeAll(options) : await entry.adapter.scrapeNew(options);
    const counts = await upsertTenders(tenders, entry.name, run.id);

    const finalStatus = counts.failed > 0 && counts.failed === tenders.length && tenders.length > 0 ? "partial" : "success";

    await prisma.scrapeRun.update({
      where: { id: run.id },
      data: {
        status: finalStatus,
        tendersFound: tenders.length,
        inserted: counts.inserted,
        updated: counts.updated,
        skipped: counts.skipped,
        failed: counts.failed,
        statedTotal,
        finishedAt: new Date(),
      },
    });

    return { runId: run.id, portal: portalKey, status: finalStatus as any };
  } catch (err) {
    logger.error({ err: String(err), portal: portalKey }, "scrape failed");
    await prisma.scrapeRun.update({
      where: { id: run.id },
      data: { status: "failed", errorMessage: String(err), finishedAt: new Date() },
    });
    return { runId: run.id, portal: portalKey, status: "failed", reason: String(err) };
  } finally {
    runningPortals.delete(portalKey);
    liveProgress.delete(run.id);
  }
}

/**
 * Runs every enabled portal through a bounded concurrency pool. One portal
 * throwing/failing never stops or cancels the others — each call is
 * independently wrapped and independently recorded.
 */
async function scrapeManyPortals(mode: Mode): Promise<ScrapePortalResult[]> {
  const limit = pLimit(Math.max(1, env.portalConcurrency));
  const enabled = getEnabledPortals();

  const results = await Promise.allSettled(
    enabled.map((entry) => limit(() => scrapePortal(entry.key, mode)))
  );

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      runId: "unknown",
      portal: enabled[i].key,
      status: "failed" as const,
      reason: String(r.reason),
    };
  });
}

export async function scrapeAllEnabledPortals(): Promise<ScrapePortalResult[]> {
  return scrapeManyPortals("full");
}

export async function scrapeNewEnabledPortals(): Promise<ScrapePortalResult[]> {
  return scrapeManyPortals("incremental");
}

// Guards the whole batch, separately from the per-portal `runningPortals`
// lock: without it, double-clicking "Scrape All" would queue a second full
// sweep behind the first. Same boolean-flag pattern the cron scheduler uses.
let batchRunning = false;

export interface StartBatchResult {
  accepted: boolean;
  mode: Mode;
  /** Portals this batch will attempt (enabled, and not already mid-scrape). */
  started: string[];
  /** Portals left out, with why -- so the UI can say so instead of implying failure. */
  skipped: { portal: string; reason: string }[];
}

/**
 * Kicks off a full sweep across every enabled portal WITHOUT awaiting it.
 *
 * A complete sweep takes tens of minutes (21 portals, most crawling every
 * organisation), so awaiting it inside a request handler meant the HTTP
 * connection was held open far past any browser's patience -- the caller
 * always timed out even though the scrape itself was fine. Callers now get
 * an immediate answer describing what was started; live progress is read
 * from the ScrapeRun rows (GET /api/scrape/runs), which the dashboard
 * already polls.
 */
export function startScrapeAllInBackground(mode: Mode): StartBatchResult {
  const enabled = getEnabledPortals();
  const skipped: { portal: string; reason: string }[] = [];

  for (const entry of PORTAL_REGISTRY) {
    if (!entry.enabled) skipped.push({ portal: entry.key, reason: "disabled" });
    else if (runningPortals.has(entry.key)) skipped.push({ portal: entry.key, reason: "already-running" });
  }
  const started = enabled.filter((e) => !runningPortals.has(e.key)).map((e) => e.key);

  if (batchRunning) {
    return { accepted: false, mode, started: [], skipped: [{ portal: "*", reason: "batch-already-running" }] };
  }

  batchRunning = true;
  scrapeManyPortals(mode)
    .then((results) => {
      const failed = results.filter((r) => r.status === "failed").length;
      logger.info({ mode, total: results.length, failed }, "background scrape batch finished");
    })
    .catch((err) => logger.error({ err: String(err), mode }, "background scrape batch threw"))
    .finally(() => {
      batchRunning = false;
    });

  return { accepted: true, mode, started, skipped };
}

export function isBatchRunning(): boolean {
  return batchRunning;
}

export async function getPortalScrapeStatus(runId: string) {
  const run = await prisma.scrapeRun.findUnique({ where: { id: runId } });
  if (!run) return null;
  const live = liveProgress.get(runId);
  return { ...run, live: live ?? null };
}

export function isPortalRunning(portalKey: string): boolean {
  return runningPortals.has(portalKey);
}

export { PORTAL_REGISTRY };
