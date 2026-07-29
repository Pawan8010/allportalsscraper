import { PortalAdapter, PortalTender, ScrapeOptions } from "../../src/portals/portal.types";

// Mock Prisma so these tests exercise orchestrator control flow (locking,
// failure isolation, availability short-circuit) without a real database.
const scrapeRuns: Record<string, any> = {};
let runCounter = 0;

jest.mock("../../src/services/prisma", () => ({
  prisma: {
    scrapeRun: {
      create: jest.fn(async ({ data }: any) => {
        const id = `run-${++runCounter}`;
        scrapeRuns[id] = { id, ...data, pagesScanned: 0, tendersFound: 0 };
        return scrapeRuns[id];
      }),
      update: jest.fn(async ({ where, data }: any) => {
        scrapeRuns[where.id] = { ...scrapeRuns[where.id], ...data };
        return scrapeRuns[where.id];
      }),
      findUnique: jest.fn(async ({ where }: any) => scrapeRuns[where.id] ?? null),
    },
    tender: {
      findUnique: jest.fn(async () => null),
      upsert: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
  },
  disconnectPrisma: jest.fn(),
}));

function makeFakeAdapter(key: string, opts: { fails?: boolean; unavailable?: boolean } = {}): PortalAdapter {
  return {
    key,
    name: key,
    baseUrl: `https://example.invalid/${key}`,
    supportsFullScrape: true,
    supportsIncrementalScrape: true,
    async checkAvailability() {
      if (opts.unavailable) return { available: false, reason: "blocked", detail: "test-forced unavailable" };
      return { available: true };
    },
    async scrapeAll(_options: ScrapeOptions): Promise<PortalTender[]> {
      if (opts.fails) throw new Error("simulated adapter failure");
      return [
        {
          portal: key,
          tenderId: `${key}-1`,
          title: `Sample tender from ${key}`,
          tenderURL: `https://example.invalid/${key}/1`,
        },
      ];
    },
    async scrapeNew(options: ScrapeOptions): Promise<PortalTender[]> {
      return this.scrapeAll(options);
    },
  };
}

jest.mock("../../src/portals/portalRegistry", () => {
  const actual = jest.requireActual("../../src/portals/portalRegistry");
  return {
    ...actual,
    getPortalEntry: jest.fn(),
    getEnabledPortals: jest.fn(),
  };
});

import { getPortalEntry, getEnabledPortals } from "../../src/portals/portalRegistry";
import { scrapePortal, scrapeAllEnabledPortals, upsertTenders } from "../../src/services/portalScrapeService";
import { prisma } from "../../src/services/prisma";

describe("portalScrapeService failure isolation", () => {
  beforeEach(() => {
    runCounter = 0;
    Object.keys(scrapeRuns).forEach((k) => delete scrapeRuns[k]);
  });

  it("marks a portal as failed via checkAvailability without throwing", async () => {
    (getPortalEntry as jest.Mock).mockReturnValue({
      key: "blocked-portal",
      name: "Blocked Portal",
      baseUrl: "https://example.invalid",
      enabled: true,
      adapter: makeFakeAdapter("blocked-portal", { unavailable: true }),
      rateLimit: { requestsPerMinute: 10 },
      concurrency: 1,
      requestDelayMs: 0,
    });

    const result = await scrapePortal("blocked-portal", "full");
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("blocked");
  });

  it("one failing portal does not stop scrapeAllEnabledPortals from completing the others", async () => {
    const good1 = { key: "good1", name: "Good 1", baseUrl: "x", enabled: true, adapter: makeFakeAdapter("good1"), rateLimit: { requestsPerMinute: 10 }, concurrency: 1, requestDelayMs: 0 };
    const bad = { key: "bad", name: "Bad", baseUrl: "x", enabled: true, adapter: makeFakeAdapter("bad", { fails: true }), rateLimit: { requestsPerMinute: 10 }, concurrency: 1, requestDelayMs: 0 };
    const good2 = { key: "good2", name: "Good 2", baseUrl: "x", enabled: true, adapter: makeFakeAdapter("good2"), rateLimit: { requestsPerMinute: 10 }, concurrency: 1, requestDelayMs: 0 };

    (getEnabledPortals as jest.Mock).mockReturnValue([good1, bad, good2]);
    (getPortalEntry as jest.Mock).mockImplementation((key: string) => [good1, bad, good2].find((p) => p.key === key));

    const results = await scrapeAllEnabledPortals();

    expect(results).toHaveLength(3);
    const byKey = Object.fromEntries(results.map((r) => [r.portal, r.status]));
    expect(byKey.good1).toBe("success");
    expect(byKey.good2).toBe("success");
    expect(byKey.bad).toBe("failed");
  });

  it("reports an overlapping scrape of the same portal as skipped, not failed", async () => {
    let resolveScrape: () => void;
    // Resolves once the adapter's scrapeAll has actually been entered, so the
    // test can assert on the overlap without racing scrapePortal's own
    // internal awaits (checkAvailability, the ScrapeRun insert) first.
    let scrapeStarted: () => void;
    const scrapeHasStarted = new Promise<void>((resolve) => {
      scrapeStarted = resolve;
    });
    const slowAdapter = makeFakeAdapter("slow");
    slowAdapter.scrapeAll = () =>
      new Promise((resolve) => {
        resolveScrape = () => resolve([]);
        scrapeStarted();
      });

    (getPortalEntry as jest.Mock).mockReturnValue({
      key: "slow",
      name: "Slow",
      baseUrl: "x",
      enabled: true,
      adapter: slowAdapter,
      rateLimit: { requestsPerMinute: 10 },
      concurrency: 1,
      requestDelayMs: 0,
    });

    const first = scrapePortal("slow", "full");
    await scrapeHasStarted;

    // The second caller must not start a duplicate scrape -- but an
    // already-running portal is an expected condition (the cron sweep is
    // frequently mid-scrape), so it reports "skipped" rather than throwing,
    // which would otherwise surface as a false "failed" row in the UI.
    const second = await scrapePortal("slow", "full");
    expect(second.status).toBe("skipped");
    expect(second.reason).toBe("already-running");

    resolveScrape!();
    await first;
  });
});

describe("upsertTenders — closed-tender resurrection guard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.tender.findUnique as jest.Mock).mockResolvedValue(null);
  });

  it("never inserts a brand-new tender whose own closingDate is already in the past", async () => {
    const pastClosing = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const counts = await upsertTenders(
      [
        {
          portal: "gem",
          tenderId: "already-closed-1",
          title: "Already closed",
          tenderURL: "https://example.invalid/1",
          closingDate: pastClosing,
        },
      ],
      "Government e-Marketplace",
      "run-1"
    );

    expect(counts).toEqual({ inserted: 0, updated: 0, skipped: 1, failed: 0 });
    expect(prisma.tender.upsert).not.toHaveBeenCalled();
  });

  it("still inserts a brand-new tender whose closingDate is in the future", async () => {
    const futureClosing = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const counts = await upsertTenders(
      [
        {
          portal: "gem",
          tenderId: "still-open-1",
          title: "Still open",
          tenderURL: "https://example.invalid/2",
          closingDate: futureClosing,
        },
      ],
      "Government e-Marketplace",
      "run-1"
    );

    expect(counts).toEqual({ inserted: 1, updated: 0, skipped: 0, failed: 0 });
    expect(prisma.tender.upsert).toHaveBeenCalledTimes(1);
  });

  it("still inserts a brand-new tender with no known closingDate at all", async () => {
    const counts = await upsertTenders(
      [{ portal: "gem", tenderId: "no-date-1", title: "No date", tenderURL: "https://example.invalid/3" }],
      "Government e-Marketplace",
      "run-1"
    );

    expect(counts).toEqual({ inserted: 1, updated: 0, skipped: 0, failed: 0 });
    expect(prisma.tender.upsert).toHaveBeenCalledTimes(1);
  });
});
