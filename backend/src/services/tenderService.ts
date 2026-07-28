import { Prisma, TenderStatus } from "@prisma/client";
import { prisma } from "../config/db";
import { logger } from "../utils/logger";
import { RawScrapedTender } from "../types/scraper";
import { mapRawTenderToUpsertData } from "../scraper/mapper";

/**
 * Storage-side tender operations.
 *
 * Searching lives in `searchService` - there is exactly one normalized search
 * pipeline, and it is served from PostgreSQL. This module only writes scraped
 * tenders and reads dashboard aggregates.
 */

export interface UpsertCounts {
  inserted: number;
  updated: number;
  skipped: number;
}

/**
 * Upserts a batch of raw scraped tenders, keyed on source portal + bid number.
 *
 * `tenderId` is UNIQUE, so re-scraping a bid updates the existing row instead of
 * creating a second one. Rows that fail to map or fail to write are counted as
 * skipped rather than aborting the batch, so one bad record cannot lose a page.
 */
export async function upsertScrapedTenders(
  rawTenders: RawScrapedTender[],
  scrapeRunId?: string
): Promise<UpsertCounts> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  // Guard against a single page repeating a bid number.
  const seenInBatch = new Set<string>();

  for (const raw of rawTenders) {
    if (!raw.tenderId) {
      skipped += 1;
      continue;
    }
    const portal = raw.portal?.trim() || "GeM";
    const naturalKey = `${portal}\u0000${raw.tenderId}`;
    if (seenInBatch.has(naturalKey)) {
      skipped += 1;
      continue;
    }
    seenInBatch.add(naturalKey);

    try {
      const data = {
        ...mapRawTenderToUpsertData(raw),
        lastSeenAt: new Date(),
        lastSeenRunId: scrapeRunId ?? null,
      };

      // `upsert` alone cannot tell us which branch it took, and the count is
      // reported to the UI, so the existence check is deliberate.
      const existing = await prisma.tender.findUnique({
        where: { portal_tenderId: { portal, tenderId: raw.tenderId } },
        select: { id: true },
      });

      await prisma.tender.upsert({
        where: { portal_tenderId: { portal, tenderId: raw.tenderId } },
        create: data,
        update: data,
      });

      if (existing) {
        updated += 1;
      } else {
        inserted += 1;
      }
    } catch (error) {
      skipped += 1;
      logger.warn(
        `[tenderService] Skipped bid ${raw.tenderId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  logger.info(`[tenderService] Upsert complete: ${inserted} inserted, ${updated} updated, ${skipped} skipped`);
  return { inserted, updated, skipped };
}

/** Full tender detail, including every normalized relation. */
export async function getTenderById(id: string) {
  return prisma.tender.findUnique({
    where: { id },
    include: {
      buyer: true,
      locationRel: true,
      financial: true,
      eligibility: true,
      products: true,
      attachments: true,
      updates: { orderBy: { createdAt: "desc" } },
    },
  });
}

/** Looks a tender up by its GeM bid number, so the API accepts either id form. */
export async function getTenderByBidNumber(tenderId: string) {
  return prisma.tender.findFirst({
    where: { tenderId },
    orderBy: [{ portal: "asc" }, { updatedAt: "desc" }],
    include: {
      buyer: true,
      locationRel: true,
      financial: true,
      eligibility: true,
      products: true,
      attachments: true,
      updates: { orderBy: { createdAt: "desc" } },
    },
  });
}

export interface TenderStats {
  totalTenders: number;
  gemListedTotal: number;
  newToday: number;
  closingSoon: number;
  keywordMatches: number;
  duplicateOrUnmappedListings: number;
  lastScrapeAt: string | null;
  lastScrapeStatus: string | null;
}

/** Number of days ahead that counts as "closing soon" on the dashboard. */
const CLOSING_SOON_DAYS = 7;

/**
 * Dashboard aggregates, all read from PostgreSQL.
 *
 * `gemListedTotal` is GeM's own reported result count from the most recent run
 * that recorded one - it is read from the `statedTotal` column, never
 * hard-coded, and falls back to the stored count when no run has reported it.
 */
export async function getTenderStats(): Promise<TenderStats> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const now = new Date();
  const closingHorizon = new Date(now);
  closingHorizon.setDate(closingHorizon.getDate() + CLOSING_SOON_DAYS);

  const [totalTenders, newToday, closingSoon, keywordMatches, latestStatedRun, latestRun] = await Promise.all([
    prisma.tender.count({ where: { tenderStatus: TenderStatus.LIVE } }),
    prisma.tender.count({
      where: { tenderStatus: TenderStatus.LIVE, createdAt: { gte: startOfToday } },
    }),
    prisma.tender.count({
      where: { tenderStatus: TenderStatus.LIVE, closingDate: { gte: now, lte: closingHorizon } },
    }),
    prisma.tender.count({
      where: { tenderStatus: TenderStatus.LIVE, keywordMatched: { not: null } },
    }),
    // Most recent run that actually learned GeM's own result count. Both FULL
    // and NEW runs query the same "ongoing bids" listing (they differ only in
    // sort order and page budget), so either one's statedTotal is the real
    // portal-wide figure. Nothing here is hard-coded.
    prisma.scrapeRun.findFirst({
      where: { portal: "GeM", statedTotal: { not: null } },
      orderBy: { startedAt: "desc" },
      select: { statedTotal: true },
    }),
    prisma.scrapeRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: { startedAt: true, finishedAt: true, status: true },
    }),
  ]);

  const gemListedTotal = latestStatedRun?.statedTotal ?? totalTenders;

  return {
    totalTenders,
    gemListedTotal,
    newToday,
    closingSoon,
    keywordMatches,
    // GeM counts listing rows; we store unique bid numbers. The gap is the
    // duplicate/unmappable rows we deliberately did not insert.
    duplicateOrUnmappedListings: Math.max(0, gemListedTotal - totalTenders),
    lastScrapeAt: (latestRun?.finishedAt ?? latestRun?.startedAt)?.toISOString() ?? null,
    lastScrapeStatus: latestRun?.status ?? null,
  };
}

/** Distinct non-null values of a filterable column, for filter dropdowns. */
export async function getDistinctValues(field: "category" | "state" | "department" | "organisation") {
  const rows = (await prisma.tender.findMany({
    where: { [field]: { not: null } } as Prisma.TenderWhereInput,
    select: { [field]: true } as Prisma.TenderSelect,
    distinct: [field],
    orderBy: { [field]: "asc" } as Prisma.TenderOrderByWithRelationInput,
    take: 500,
  })) as unknown as Array<Record<string, string | null>>;

  return rows.map((row) => row[field]).filter((value): value is string => Boolean(value));
}
