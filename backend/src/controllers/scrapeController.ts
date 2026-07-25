import { Request, Response, NextFunction } from "express";
import {
  startScrape,
  getScrapeRunStatus,
  getLatestScrapeRun,
  isScrapeInProgress,
  getCurrentRunId,
  ScrapeInProgressError,
  ScrapeMode,
} from "../scraper/scrapeRunner";
import { logger } from "../utils/logger";

/**
 * `?resume=false` (or `{"resume": false}`) ignores the previous run's watermark
 * and sweeps from page 1 - the way to force a re-read of pages an earlier
 * resumed run skipped over. Resuming remains the default.
 */
function wantsResume(req: Request): boolean {
  const raw = req.query.resume ?? (req.body as Record<string, unknown> | undefined)?.resume;
  if (raw === undefined) return true;
  return !(raw === false || raw === "false" || raw === "0");
}

async function trigger(mode: ScrapeMode, req: Request, res: Response, next: NextFunction) {
  try {
    const resume = wantsResume(req);
    logger.info(`[scrapeController] ${mode} scrape requested (resume=${resume})`);
    const started = await startScrape({ mode, resume });

    res.status(202).json({
      status: "STARTED",
      runId: started.runId,
      mode: started.mode,
      startedAt: started.startedAt.toISOString(),
      progress: {
        startPage: started.startPage,
        retryPages: started.retryPages,
        resumedFromRunId: started.resumedFromRunId,
        pagesScanned: 0,
        tendersFound: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
      },
      statusUrl: `/api/scrape/status/${started.runId}`,
    });
  } catch (err) {
    if (err instanceof ScrapeInProgressError) {
      res.status(409).json({
        error: err.message,
        runId: err.runId,
        ...(err.runId ? { statusUrl: `/api/scrape/status/${err.runId}` } : {}),
      });
      return;
    }
    next(err);
  }
}

/** POST /api/scrape/all - full sweep of every page GeM lists. */
export async function triggerFullScrape(req: Request, res: Response, next: NextFunction) {
  return trigger("FULL", req, res, next);
}

/** POST /api/scrape/new - newest pages only; existing records are preserved. */
export async function triggerNewTenderScrape(req: Request, res: Response, next: NextFunction) {
  return trigger("NEW", req, res, next);
}

/** GET /api/scrape/status/:runId */
export async function scrapeRunStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const status = await getScrapeRunStatus(req.params.runId);
    if (!status) {
      res.status(404).json({ error: `Scrape run not found: ${req.params.runId}` });
      return;
    }
    res.json(status);
  } catch (err) {
    next(err);
  }
}

/** GET /api/scrape/status - whether anything is running, plus the latest run. */
export async function scrapeStatus(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({
      inProgress: isScrapeInProgress(),
      runId: getCurrentRunId(),
      latestRun: await getLatestScrapeRun(),
    });
  } catch (err) {
    next(err);
  }
}
