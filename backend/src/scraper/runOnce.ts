import "../config/env";
import { runScrapeToCompletion, markInterruptedScrapes, ScrapeMode } from "./scrapeRunner";
import { disconnectDb } from "../config/db";
import { logger } from "../utils/logger";

/**
 * One-shot scrape from the command line:
 *   npm run scrape          -> full sweep
 *   npm run scrape -- new   -> incremental
 */
async function main() {
  const mode: ScrapeMode = process.argv.includes("new") ? "NEW" : "FULL";

  await markInterruptedScrapes();
  const result = await runScrapeToCompletion({ mode });

  logger.info(
    `Scrape ${result.status}: pages=${result.pagesScanned}, found=${result.tendersFound}, inserted=${result.inserted}, updated=${result.updated}, skipped=${result.skipped}, errors=${result.errors}, gemStatedTotal=${result.gemStatedTotal ?? "unknown"}`
  );

  await disconnectDb();
  process.exit(result.status === "SUCCESS" ? 0 : 1);
}

main().catch((err) => {
  logger.error(`Fatal error running scrape: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
