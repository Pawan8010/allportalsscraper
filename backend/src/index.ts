import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./utils/logger";
import { startScheduler, stopScheduler } from "./scheduler/scheduler";
import { disconnectPrisma } from "./services/prisma";
import { reconcileOrphanedRuns } from "./services/portalScrapeService";

const app = createApp();

const server = app.listen(env.port, () => {
  logger.info({ port: env.port, env: env.nodeEnv }, "Tender scraper backend listening");
  reconcileOrphanedRuns()
    .catch((err) => logger.error({ err: String(err) }, "failed to reconcile orphaned scrape runs"))
    .finally(() => startScheduler());
});

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down gracefully...");
  stopScheduler();
  server.close(async () => {
    await disconnectPrisma();
    logger.info("Shutdown complete");
    process.exit(0);
  });
  // Force-exit if graceful shutdown hangs (e.g. an in-flight scrape not
  // respecting its AbortSignal quickly enough).
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
