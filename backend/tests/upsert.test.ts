import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenderStatus } from "@prisma/client";
import { prisma } from "../src/config/db";
import { upsertScrapedTenders } from "../src/services/tenderService";
import { RawScrapedTender } from "../src/types/scraper";

/**
 * Deduplication is the property that matters most here: re-scraping a bid must
 * update the existing row, never create a second one.
 */

const PREFIX = "TEST-UPSERT/";

let databaseReachable = false;

function gemTenderWhere(tenderId: string) {
  return { portal_tenderId: { portal: "GeM", tenderId } } as const;
}

function raw(suffix: string, overrides: Partial<RawScrapedTender> = {}): RawScrapedTender {
  return {
    tenderId: `${PREFIX}${suffix}`,
    title: "Upsert fixture thermal imager",
    organisation: "Upsert Org",
    department: "Upsert Dept",
    location: "India",
    state: null,
    category: "GeM Bid",
    description: "Upsert fixture description",
    estimatedValueText: "1000",
    publishedDateText: "01-07-2026",
    closingDateText: "31-12-2099",
    tenderURL: `https://bidplus.gem.gov.in/showbidDocument/${suffix}`,
    documentURL: `https://bidplus.gem.gov.in/showbidDocument/${suffix}`,
    statusText: "LIVE",
    ...overrides,
  } as RawScrapedTender;
}

async function cleanup() {
  await prisma.tender.deleteMany({ where: { tenderId: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseReachable = true;
  } catch {
    return;
  }
  await cleanup();
});

afterAll(async () => {
  if (!databaseReachable) return;
  await cleanup();
  await prisma.$disconnect();
});

const dbIt = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!databaseReachable) {
      console.warn(`[skipped - PostgreSQL unreachable] ${name}`);
      return;
    }
    await fn();
  });

describe("upsertScrapedTenders", () => {
  dbIt("inserts new bids and counts them as inserted", async () => {
    const counts = await upsertScrapedTenders([raw("a"), raw("b")]);
    expect(counts).toEqual({ inserted: 2, updated: 0, skipped: 0 });
    await expect(prisma.tender.count({ where: { tenderId: { startsWith: PREFIX } } })).resolves.toBe(2);
  });

  dbIt("updates instead of duplicating when the same bid is scraped again", async () => {
    await upsertScrapedTenders([raw("dup")]);
    const counts = await upsertScrapedTenders([raw("dup", { title: "Upsert fixture retitled" })]);

    expect(counts).toEqual({ inserted: 0, updated: 1, skipped: 0 });

    const rows = await prisma.tender.findMany({ where: { tenderId: `${PREFIX}dup` } });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Upsert fixture retitled");
  });

  dbIt("keeps the same tender number from different portals as separate records", async () => {
    const tenderId = `${PREFIX}cross-portal`;
    const counts = await upsertScrapedTenders([
      raw("cross-portal"),
      raw("cross-portal", { portal: "CPPP", title: "CPPP cross-portal fixture" }),
    ]);

    expect(counts).toEqual({ inserted: 2, updated: 0, skipped: 0 });
    const rows = await prisma.tender.findMany({
      where: { tenderId },
      orderBy: { portal: "asc" },
      select: { portal: true, title: true },
    });
    expect(rows).toEqual([
      { portal: "CPPP", title: "CPPP cross-portal fixture" },
      { portal: "GeM", title: "Upsert fixture thermal imager" },
    ]);
  });

  dbIt("stays at one row after many repeated scrapes", async () => {
    for (let round = 0; round < 4; round += 1) {
      await upsertScrapedTenders([raw("repeat")]);
    }
    await expect(prisma.tender.count({ where: { tenderId: `${PREFIX}repeat` } })).resolves.toBe(1);
  });

  dbIt("skips a bid repeated within a single page", async () => {
    const counts = await upsertScrapedTenders([raw("same"), raw("same"), raw("same")]);
    expect(counts.inserted).toBe(1);
    expect(counts.skipped).toBe(2);
    await expect(prisma.tender.count({ where: { tenderId: `${PREFIX}same` } })).resolves.toBe(1);
  });

  dbIt("skips rows with no bid number rather than aborting the page", async () => {
    const counts = await upsertScrapedTenders([
      raw("valid-1"),
      { ...raw("ignored"), tenderId: "" } as RawScrapedTender,
      raw("valid-2"),
    ]);
    expect(counts.inserted).toBe(2);
    expect(counts.skipped).toBe(1);
  });

  dbIt("preserves createdAt but advances lastSeenAt on update", async () => {
    await upsertScrapedTenders([raw("timestamps")]);
    const before = await prisma.tender.findUnique({ where: gemTenderWhere(`${PREFIX}timestamps`) });

    await new Promise((resolve) => setTimeout(resolve, 25));
    await upsertScrapedTenders([raw("timestamps", { title: "Upsert fixture touched" })]);
    const after = await prisma.tender.findUnique({ where: gemTenderWhere(`${PREFIX}timestamps`) });

    expect(after!.createdAt.getTime()).toBe(before!.createdAt.getTime());
    expect(after!.lastSeenAt!.getTime()).toBeGreaterThan(before!.lastSeenAt!.getTime());
  });

  dbIt("records the scrape run that last saw each bid", async () => {
    const run = await prisma.scrapeRun.create({ data: { mode: "NEW", status: "RUNNING" } });
    try {
      await upsertScrapedTenders([raw("run-tagged")], run.id);
      const stored = await prisma.tender.findUnique({ where: gemTenderWhere(`${PREFIX}run-tagged`) });
      expect(stored!.lastSeenRunId).toBe(run.id);
    } finally {
      await prisma.scrapeRun.delete({ where: { id: run.id } });
    }
  });

  dbIt("normalises dates and status from the scraped text", async () => {
    await upsertScrapedTenders([
      raw("normalised", { publishedDateText: "15-08-2026", closingDateText: "20-09-2026 15:30 PM", statusText: "" }),
    ]);
    const stored = await prisma.tender.findUnique({ where: gemTenderWhere(`${PREFIX}normalised`) });

    expect(stored!.publishedDate?.getFullYear()).toBe(2026);
    expect(stored!.publishedDate?.getMonth()).toBe(7); // August, zero-based
    expect(stored!.publishedDate?.getDate()).toBe(15);
    expect(stored!.closingDate?.getHours()).toBe(15);
    // No status text, but a future closing date -> LIVE.
    expect(stored!.tenderStatus).toBe(TenderStatus.LIVE);
  });

  dbIt("marks a bid whose closing date has passed as CLOSED", async () => {
    await upsertScrapedTenders([raw("expired", { closingDateText: "01-01-2020", statusText: "" })]);
    const stored = await prisma.tender.findUnique({ where: gemTenderWhere(`${PREFIX}expired`) });
    expect(stored!.tenderStatus).toBe(TenderStatus.CLOSED);
  });

  dbIt("preserves the original GeM URL", async () => {
    await upsertScrapedTenders([raw("url")]);
    const stored = await prisma.tender.findUnique({ where: gemTenderWhere(`${PREFIX}url`) });
    expect(stored!.tenderURL).toBe("https://bidplus.gem.gov.in/showbidDocument/url");
  });

  dbIt("handles an empty batch without touching the database", async () => {
    await expect(upsertScrapedTenders([])).resolves.toEqual({ inserted: 0, updated: 0, skipped: 0 });
  });
});
