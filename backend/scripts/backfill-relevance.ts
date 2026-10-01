/**
 * One-off backfill: classifies every existing Tender row that predates the
 * relevance column (relevance IS NULL). New rows already get classified
 * automatically at scrape time (see tenderToFields() in
 * portalScrapeService.ts) -- this script only needs to run once, and again
 * only if classifyRelevance()'s rules change and old rows should be
 * reclassified.
 *
 * Usage: npx ts-node scripts/backfill-relevance.ts
 */
import { prisma } from "../src/services/prisma";
import { classifyRelevance } from "../src/utils/relevance";
import { logger } from "../src/utils/logger";

const BATCH_SIZE = 5000;

async function main() {
  let cursor: string | undefined;
  let processed = 0;
  const counts: Record<string, number> = { relevant: 0, irrelevant: 0, unclassified: 0 };

  for (;;) {
    const batch = await prisma.tender.findMany({
      where: { relevance: null },
      select: { id: true, title: true, category: true, organisation: true, department: true },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;

    for (const t of batch) {
      const relevance = classifyRelevance(t);
      await prisma.tender.update({ where: { id: t.id }, data: { relevance } });
      counts[relevance] += 1;
    }

    processed += batch.length;
    cursor = batch[batch.length - 1].id;
    logger.info({ processed, ...counts }, "backfill-relevance progress");
  }

  logger.info({ processed, ...counts }, "backfill-relevance finished");
  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error({ err: String(err) }, "backfill-relevance failed");
  process.exit(1);
});
