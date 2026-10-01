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
  const expired = await prisma.tender.findMany({
    where: { closingDate: { lt: cutoff } },
    select: { portal: true, tenderId: true, closingDate: true },
  });
  if (expired.length === 0) return 0;

  const result = await prisma.$transaction(async (transaction) => {
    await transaction.expiredTender.createMany({
      data: expired.map((tender) => ({
        portal: tender.portal,
        tenderId: tender.tenderId,
        closedAt: tender.closingDate!,
      })),
      skipDuplicates: true,
    });
    return transaction.tender.deleteMany({
      where: { closingDate: { lt: cutoff } },
    });
  });
  if (result.count > 0) {
    logger.info({ deleted: result.count, cutoff: cutoff.toISOString() }, "archived and deleted expired tenders");
  }
  return result.count;
}
