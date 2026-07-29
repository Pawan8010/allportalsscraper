import { prisma } from "./prisma";
import { logger } from "../utils/logger";
import { env } from "../config/env";

/**
 * Permanently removes tenders whose closingDate has passed. Search already
 * hides these (see searchService.ts's closingDate filter), but the user
 * wants them actually gone from storage, not just hidden -- this is the
 * complement to upsertTenders()'s guard against re-inserting one that's
 * already closed by the time a scrape sees it.
 */
export async function deleteExpiredTenders(): Promise<number> {
  const cutoff = new Date(Date.now() - env.tenderCleanupGraceDays * 24 * 60 * 60 * 1000);
  const result = await prisma.tender.deleteMany({
    where: { closingDate: { lt: cutoff } },
  });
  if (result.count > 0) {
    logger.info({ deleted: result.count, cutoff: cutoff.toISOString() }, "deleted expired tenders");
  }
  return result.count;
}
