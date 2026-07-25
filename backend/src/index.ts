import { createApp } from "./app";
import { config } from "./config/env";
import { logger } from "./utils/logger";
import { connectDb, disconnectDb } from "./config/db";
import { startScheduler, stopScheduler } from "./scraper/scheduler";
import { markInterruptedScrapes } from "./scraper/scrapeRunner";

async function main() {
  await connectDb();
  logger.info(`Connected to PostgreSQL (${config.nodeEnv})`);

  // Any run still marked RUNNING belongs to a previous process.
  await markInterruptedScrapes();

  const app = createApp();

  const server = app.listen(config.port, () => {
    logger.info(`RRP Groups Tender Search API listening on http://127.0.0.1:${config.port}`);
    logger.info(`CORS origins: ${config.corsOrigin.join(", ")}`);
  });

  server.on("error", (error) => {
    logger.error(`HTTP server error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });

  startScheduler();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down gracefully`);

    stopScheduler();

    // Stop accepting connections, let in-flight requests drain, then close the
    // database. A background scrape is abandoned here on purpose: its run row
    // is marked INTERRUPTED on next boot and the next scrape resumes from it.
    const forceExit = setTimeout(() => {
      logger.warn("Graceful shutdown timed out, exiting");
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server.close(async () => {
      try {
        await disconnectDb();
        logger.info("Shutdown complete");
        process.exit(0);
      } catch (error) {
        logger.error(`Error during shutdown: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    });
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    logger.error(`Unhandled promise rejection: ${reason instanceof Error ? reason.message : reason}`);
  });
}

main().catch((err) => {
  logger.error(`Failed to start server: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
