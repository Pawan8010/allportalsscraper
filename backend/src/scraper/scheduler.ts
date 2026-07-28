import cron, { ScheduledTask } from "node-cron";
import { config } from "../config/env";
import { logger } from "../utils/logger";
import { startScrape, isScrapeInProgress, ScrapeInProgressError } from "./scrapeRunner";

let task: ScheduledTask | null = null;

/**
 * Automatic refresh, every six hours by default (SCRAPE_CRON).
 *
 * Runs an incremental NEW scrape: it walks the newest pages, upserts by bid
 * number and leaves everything else untouched. A full sweep stays a deliberate,
 * operator-triggered action.
 *
 * The scrape runs in the background exactly like an API-triggered one, so
 * search keeps being served while it works.
 */
export function startScheduler(): void {
  if (!config.scrapeCron) {
    logger.info("[scheduler] SCRAPE_CRON not set - automatic scraping disabled");
    return;
  }

  if (!cron.validate(config.scrapeCron)) {
    logger.warn(`[scheduler] Invalid SCRAPE_CRON expression "${config.scrapeCron}" - automatic scraping disabled`);
    return;
  }

  task = cron.schedule(config.scrapeCron, async () => {
    // Belt and braces: startScrape also refuses to overlap.
    if (isScrapeInProgress()) {
      logger.info("[scheduler] Skipping scheduled scrape - one is already running");
      return;
    }

    try {
      const started = await startScrape({ mode: "NEW" });
      logger.info(`[scheduler] Scheduled incremental scrape started (run ${started.runId})`);
    } catch (error) {
      if (error instanceof ScrapeInProgressError) {
        logger.info("[scheduler] Skipping scheduled scrape - one is already running");
        return;
      }
      logger.error(`[scheduler] Scheduled scrape failed to start: ${error instanceof Error ? error.message : error}`);
    }
  });

  logger.info(`[scheduler] Automatic incremental scraping enabled with cron "${config.scrapeCron}"`);
}

/** Stops the cron task so the process can exit cleanly. */
export function stopScheduler(): void {
  task?.stop();
  task = null;
}
