import cron from "node-cron";
import { scrapeNewEnabledPortals, scrapeAllEnabledPortals } from "../services/portalScrapeService";
import { deleteExpiredTenders } from "../services/tenderCleanupService";
import { runAlertCycle } from "../services/alertService";
import { runBackup, pruneOldBackups } from "../services/backupService";
import { logger } from "../utils/logger";
import { env } from "../config/env";

let incrementalTask: cron.ScheduledTask | null = null;
let fullTask: cron.ScheduledTask | null = null;
let cleanupTask: cron.ScheduledTask | null = null;
let backupTask: cron.ScheduledTask | null = null;
let incrementalRunning = false;
let fullRunning = false;
let cleanupRunning = false;
let backupRunning = false;

async function runIncrementalCycle(): Promise<void> {
  if (incrementalRunning) {
    logger.warn("Scheduled incremental scrape skipped — previous cycle still running");
    return;
  }
  if (fullRunning) {
    logger.warn("Scheduled incremental scrape skipped — a full sweep is in progress");
    return;
  }
  incrementalRunning = true;
  logger.info("Scheduled incremental scrape cycle starting");
  try {
    const results = await scrapeNewEnabledPortals();
    const failed = results.filter((r) => r.status === "failed");
    logger.info({ total: results.length, failed: failed.length }, "Scheduled incremental scrape cycle finished");
    // Runs right after the scrape it depends on, using the same cadence --
    // a failure here must never take down the scrape cycle it's piggybacking on.
    await runAlertCycle().catch((err) => logger.error({ err: String(err) }, "alert cycle threw unexpectedly"));
  } catch (err) {
    logger.error({ err: String(err) }, "Scheduled incremental scrape cycle threw unexpectedly");
  } finally {
    incrementalRunning = false;
  }
}

async function runFullCycle(): Promise<void> {
  if (fullRunning || incrementalRunning) {
    logger.warn("Scheduled full scrape skipped — another cycle is already running");
    return;
  }
  fullRunning = true;
  logger.info("Scheduled full scrape cycle starting");
  try {
    const results = await scrapeAllEnabledPortals();
    const failed = results.filter((r) => r.status === "failed");
    logger.info({ total: results.length, failed: failed.length }, "Scheduled full scrape cycle finished");
  } catch (err) {
    logger.error({ err: String(err) }, "Scheduled full scrape cycle threw unexpectedly");
  } finally {
    fullRunning = false;
  }
}

async function runCleanupCycle(): Promise<void> {
  if (cleanupRunning) {
    logger.warn("Scheduled tender cleanup skipped — previous cleanup still running");
    return;
  }
  cleanupRunning = true;
  try {
    const deleted = await deleteExpiredTenders();
    logger.info({ deleted }, "Scheduled tender cleanup finished");
  } catch (err) {
    logger.error({ err: String(err) }, "Scheduled tender cleanup threw unexpectedly");
  } finally {
    cleanupRunning = false;
  }
}

async function runBackupCycle(): Promise<void> {
  if (backupRunning) {
    logger.warn("Scheduled backup skipped — previous backup still running");
    return;
  }
  backupRunning = true;
  try {
    const { dir, counts } = await runBackup();
    logger.info({ dir, counts }, "Scheduled backup finished");
    await pruneOldBackups();
  } catch (err) {
    logger.error({ err: String(err) }, "Scheduled backup threw unexpectedly");
  } finally {
    backupRunning = false;
  }
}

export function startScheduler(): void {
  // Cleanup and backups protect/manage data independent of whether
  // scraping itself is turned on -- registered before the scrape-specific
  // early return below so pausing scraping (PORTAL_SCRAPE_ENABLED=false)
  // can never silently also stop backups from running.
  if (!env.tenderCleanupEnabled) {
    logger.info("TENDER_CLEANUP_ENABLED=false — cleanup scheduler not started");
  } else if (!cron.validate(env.tenderCleanupCron)) {
    logger.error({ cron: env.tenderCleanupCron }, "invalid TENDER_CLEANUP_CRON expression, cleanup scheduler not started");
  } else {
    cleanupTask = cron.schedule(env.tenderCleanupCron, () => void runCleanupCycle());
    logger.info({ cron: env.tenderCleanupCron }, "Tender cleanup scheduler started");
  }

  if (!env.backupEnabled) {
    logger.info("BACKUP_ENABLED=false — backup scheduler not started");
  } else if (!cron.validate(env.backupCron)) {
    logger.error({ cron: env.backupCron }, "invalid BACKUP_CRON expression, backup scheduler not started");
  } else {
    backupTask = cron.schedule(env.backupCron, () => void runBackupCycle());
    logger.info({ cron: env.backupCron }, "Backup scheduler started");
  }

  if (!env.portalScrapeEnabled) {
    logger.info("PORTAL_SCRAPE_ENABLED=false — scrape schedulers not started");
    return;
  }
  if (!cron.validate(env.scrapeCron)) {
    logger.error({ cron: env.scrapeCron }, "invalid SCRAPE_CRON expression, incremental scheduler not started");
  } else {
    incrementalTask = cron.schedule(env.scrapeCron, () => void runIncrementalCycle());
    logger.info({ cron: env.scrapeCron }, "Incremental scrape scheduler started");
  }

  if (!cron.validate(env.fullScrapeCron)) {
    logger.error({ cron: env.fullScrapeCron }, "invalid FULL_SCRAPE_CRON expression, full-sweep scheduler not started");
  } else {
    fullTask = cron.schedule(env.fullScrapeCron, () => void runFullCycle());
    logger.info({ cron: env.fullScrapeCron }, "Full scrape scheduler started");
  }

  if (env.scrapeOnStartup) {
    logger.info("Running an initial incremental scrape on startup");
    void runIncrementalCycle();
  }
}

export function stopScheduler(): void {
  incrementalTask?.stop();
  fullTask?.stop();
  cleanupTask?.stop();
  backupTask?.stop();
  incrementalTask = null;
  fullTask = null;
  cleanupTask = null;
  backupTask = null;
}
