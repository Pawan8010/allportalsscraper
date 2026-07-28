import { prisma } from "../config/db";
import { refreshSearchIndexes } from "../scraper/scrapeRunner";
import { upsertScrapedTenders } from "../services/tenderService";
import { logger } from "../utils/logger";
import { scrapeBiharPortal } from "./biharScraper";
import { scrapeGepnicPortal } from "./gepnicScraper";
import { getPortal, PortalDefinition } from "./portalRegistry";

export type PortalScrapeMode = "FULL" | "NEW";

const runningPortals = new Map<string, string>();

export class PortalScrapeUnavailableError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

export class PortalScrapeInProgressError extends Error {
  constructor(readonly runId: string) {
    super("A scrape is already running for this portal");
  }
}

function assertScrapeable(portalKey: string): PortalDefinition {
  const portal = getPortal(portalKey);
  if (!portal) throw new PortalScrapeUnavailableError(`Unknown portal: ${portalKey}`, 404);
  if (portal.key === "gem") {
    throw new PortalScrapeUnavailableError("Use /api/scrape/all or /api/scrape/new for GeM.");
  }
  if (!portal.enabled || (portal.family !== "GEPNIC" && portal.key !== "bihar")) {
    throw new PortalScrapeUnavailableError(
      portal.unavailableReason ?? `${portal.name} does not have an enabled scraper adapter.`
    );
  }
  return portal;
}

export async function startPortalScrape(portalKey: string, mode: PortalScrapeMode) {
  const portal = assertScrapeable(portalKey);
  const runningRunId = runningPortals.get(portalKey);
  if (runningRunId) throw new PortalScrapeInProgressError(runningRunId);

  const run = await prisma.scrapeRun.create({
    data: {
      portal: portal.shortName,
      mode: `PORTAL_${mode}`,
      status: "RUNNING",
    },
  });
  runningPortals.set(portalKey, run.id);

  void executePortalScrape(portal, run.id, mode)
    .catch((error) => {
      logger.error(
        `[portalScrapeRunner] ${portal.key} run ${run.id} threw: ${error instanceof Error ? error.message : error}`
      );
    })
    .finally(() => {
      runningPortals.delete(portalKey);
    });

  return {
    runId: run.id,
    portalKey: portal.key,
    portal: portal.shortName,
    mode,
    status: run.status,
    startedAt: run.startedAt,
  };
}

async function executePortalScrape(portal: PortalDefinition, runId: string, mode: PortalScrapeMode) {
  let tendersFound = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let statedTotal: number | null = null;
  let organisationsScraped = 0;
  const failedOrganisations = new Set<number>();

  try {
    if (portal.key === "bihar") {
      const tenders = await scrapeBiharPortal(portal);
      statedTotal = tenders.length;
      const counts = await upsertScrapedTenders(tenders, runId);
      tendersFound = tenders.length;
      inserted = counts.inserted;
      updated = counts.updated;
      skipped = counts.skipped;
      organisationsScraped = 1;

      await prisma.scrapeRun.update({
        where: { id: runId },
        data: {
          status: "SUCCESS",
          finishedAt: new Date(),
          pagesScraped: 1,
          lastPage: 1,
          tendersFound,
          tendersNew: inserted,
          tendersUpdated: updated,
          tendersSkipped: skipped,
          statedTotal,
        },
      });
      return;
    }

    const result = await scrapeGepnicPortal(portal, {
      onTotalKnown(total) {
        statedTotal = total;
      },
      onOrganisationError(index, organisation, error) {
        failedOrganisations.add(index);
        logger.warn(`[portalScrapeRunner] ${portal.key} organisation ${organisation} failed: ${error.message}`);
      },
      async onBatch(tenders, organisationIndex) {
        const counts = await upsertScrapedTenders(tenders, runId);
        organisationsScraped = organisationIndex;
        tendersFound += tenders.length;
        inserted += counts.inserted;
        updated += counts.updated;
        skipped += counts.skipped;

        await prisma.scrapeRun.update({
          where: { id: runId },
          data: {
            pagesScraped: organisationIndex,
            lastPage: organisationIndex,
            tendersFound,
            tendersNew: inserted,
            tendersUpdated: updated,
            tendersSkipped: skipped,
            errorCount: failedOrganisations.size,
            statedTotal,
            failedPages:
              failedOrganisations.size > 0
                ? JSON.stringify(Array.from(failedOrganisations).sort((left, right) => left - right))
                : null,
          },
        });
      },
    });

    for (const index of result.failedOrganisations) failedOrganisations.add(index);
    const status = failedOrganisations.size > 0 ? "PARTIAL" : "SUCCESS";

    await prisma.scrapeRun.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: new Date(),
        pagesScraped: result.organisationsScraped,
        lastPage: organisationsScraped,
        tendersFound,
        tendersNew: inserted,
        tendersUpdated: updated,
        tendersSkipped: skipped,
        errorCount: failedOrganisations.size,
        statedTotal: result.statedTotal,
        failedPages:
          failedOrganisations.size > 0
            ? JSON.stringify(Array.from(failedOrganisations).sort((left, right) => left - right))
            : null,
        errorMessage:
          failedOrganisations.size > 0
            ? `${failedOrganisations.size} organisation list(s) failed after retries`
            : null,
      },
    });

    logger.info(
      `[portalScrapeRunner] ${portal.key} ${mode} ${status}: organisations=${result.organisationsScraped}, found=${tendersFound}, inserted=${inserted}, updated=${updated}, skipped=${skipped}`
    );

    // Same reason as the GeM runner: freshly inserted rows sit in the GIN
    // pending lists and slow every later search until they are merged in.
    await refreshSearchIndexes(runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.scrapeRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        pagesScraped: organisationsScraped,
        lastPage: organisationsScraped,
        tendersFound,
        tendersNew: inserted,
        tendersUpdated: updated,
        tendersSkipped: skipped,
        errorCount: Math.max(1, failedOrganisations.size),
        statedTotal,
        errorMessage: message,
      },
    });
    throw error;
  }
}

export function getRunningPortalRun(portalKey: string): string | null {
  return runningPortals.get(portalKey) ?? null;
}
