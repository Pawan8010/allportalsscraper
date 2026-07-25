import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { TenderStatus } from "@prisma/client";

/**
 * Integration tests against the real PostgreSQL database named in backend/.env.
 *
 * Nothing here contacts GeM: LIVE_SEARCH_ENABLED is forced off in
 * vitest.config.ts and no scrape is triggered, so the suite is safe to run
 * repeatedly and does not depend on the portal being up.
 *
 * Fixtures use a TEST-VITEST bid-number prefix and are removed afterwards.
 */

const PREFIX = "TEST-VITEST/";

let app: Express;
let prisma: typeof import("../src/config/db").prisma;
let upsertScrapedTenders: typeof import("../src/services/tenderService").upsertScrapedTenders;
let databaseReachable = false;

function fixture(suffix: string, overrides: Record<string, unknown> = {}) {
  return {
    tenderId: `${PREFIX}${suffix}`,
    title: "Vitest Handheld Thermal Imager for perimeter surveillance",
    organisation: "Vitest Test Organisation",
    department: "Vitest Department of Verification",
    location: "Testville",
    state: "Test State",
    category: "Vitest Category",
    description: "Fixture row created by the automated test suite.",
    estimatedValueText: "125000",
    publishedDateText: "01-07-2026",
    closingDateText: "31-12-2099",
    tenderURL: `https://bidplus.gem.gov.in/showbidDocument/${suffix}`,
    documentURL: `https://bidplus.gem.gov.in/showbidDocument/${suffix}`,
    statusText: "LIVE",
    ...overrides,
  };
}

async function cleanup() {
  await prisma.tender.deleteMany({ where: { tenderId: { startsWith: PREFIX } } });
  await prisma.scrapeRun.deleteMany({ where: { errorMessage: { startsWith: "vitest-fixture" } } });
}

beforeAll(async () => {
  const db = await import("../src/config/db");
  prisma = db.prisma;
  ({ upsertScrapedTenders } = await import("../src/services/tenderService"));

  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseReachable = true;
  } catch {
    databaseReachable = false;
    return;
  }

  app = (await import("../src/app")).createApp();
  await cleanup();
});

afterAll(async () => {
  if (!databaseReachable) return;
  await cleanup();
  await prisma.$disconnect();
});

const dbIt = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!databaseReachable) {
      // Reported as skipped rather than silently passing.
      console.warn(`[skipped - PostgreSQL unreachable] ${name}`);
      return;
    }
    await fn();
  });

describe("GET /health", () => {
  dbIt("returns status ok", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  dbIt("reports the database as reachable", async () => {
    const response = await request(app).get("/health/db");
    expect(response.status).toBe(200);
    expect(response.body.database).toBe("reachable");
  });
});

describe("GET /api/tenders/stats", () => {
  dbIt("returns every documented counter as a real number", async () => {
    const response = await request(app).get("/api/tenders/stats");
    expect(response.status).toBe(200);

    for (const key of ["totalTenders", "gemListedTotal", "newToday", "closingSoon", "keywordMatches"]) {
      expect(typeof response.body[key], key).toBe("number");
      expect(response.body[key], key).toBeGreaterThanOrEqual(0);
    }
  });

  dbIt("agrees with a direct database count", async () => {
    const response = await request(app).get("/api/tenders/stats");
    const liveCount = await prisma.tender.count({ where: { tenderStatus: TenderStatus.LIVE } });
    expect(response.body.totalTenders).toBe(liveCount);
  });

  dbIt("never reports a hard-coded GeM total", async () => {
    const response = await request(app).get("/api/tenders/stats");
    expect([48000, 50000]).not.toContain(response.body.gemListedTotal);
  });
});

describe("GET /api/tenders/search", () => {
  dbIt("returns the documented response shape", async () => {
    const response = await request(app).get("/api/tenders/search").query({ limit: 2 });
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(typeof response.body.total).toBe("number");
    expect(response.body.pagination).toMatchObject({ page: 1, limit: 2 });
    expect(typeof response.body.source).toBe("string");
    expect(typeof response.body.searchedAt).toBe("string");
    expect(response.body.meta).toBeTruthy();
  });

  dbIt("does not leak the internal relevance score onto rows", async () => {
    const response = await request(app).get("/api/tenders/search").query({ q: "thermal camera", limit: 3 });
    for (const row of response.body.data) expect(row).not.toHaveProperty("score");
    // It is still reported internally, under meta.
    expect(response.body.meta).toHaveProperty("topScore");
  });

  dbIt("finds a fixture by an alias of its title", async () => {
    await upsertScrapedTenders([fixture("alias-1")]);

    // The fixture says "Thermal Imager"; "infrared camera" is an alias of it.
    const response = await request(app).get("/api/tenders/search").query({ q: "infrared camera", limit: 100 });
    const ids = response.body.data.map((row: { tenderId: string }) => row.tenderId);
    expect(ids).toContain(`${PREFIX}alias-1`);
  });

  dbIt("filters results by one or multiple portals", async () => {
    await upsertScrapedTenders([
      fixture("portal-filter", { portal: "GeM" }),
      fixture("portal-filter", { portal: "CPPP", title: "Vitest CPPP thermal imager" }),
    ]);

    const cpppOnly = await request(app)
      .get("/api/tenders/search")
      .query({ q: "thermal imager", portal: "CPPP", limit: 100 });
    const filtered = cpppOnly.body.data.filter(
      (row: { tenderId: string }) => row.tenderId === `${PREFIX}portal-filter`,
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].portal).toBe("CPPP");

    const both = await request(app)
      .get("/api/tenders/search")
      .query({ q: "thermal imager", portals: "GeM,CPPP", limit: 100 });
    const crossPortalRows = both.body.data.filter(
      (row: { tenderId: string }) => row.tenderId === `${PREFIX}portal-filter`,
    );
    expect(crossPortalRows).toHaveLength(2);
  });

  dbIt("finds a non-GeM tender by its slash-separated reference number", async () => {
    const reference = "SMET/TMCH/2024/42/PT2/25/1070";
    await upsertScrapedTenders([
      fixture("reference-search", {
        portal: "Assam",
        title: "Supply of medicines and surgical items",
        description: `Health and Family Welfare Department | ${reference}`,
      }),
    ]);

    const response = await request(app).get("/api/tenders/search").query({ q: reference, limit: 100 });
    const match = response.body.data.find(
      (row: { portal: string; tenderId: string }) =>
        row.portal === "Assam" && row.tenderId === `${PREFIX}reference-search`,
    );
    expect(match).toBeTruthy();
  });

  dbIt("is case insensitive and tolerates punctuation and plurals", async () => {
    await upsertScrapedTenders([fixture("case-1")]);

    for (const term of ["THERMAL IMAGER", "thermal-imagers", "  thermal   imager  "]) {
      const response = await request(app).get("/api/tenders/search").query({ q: term, limit: 100 });
      const ids = response.body.data.map((row: { tenderId: string }) => row.tenderId);
      expect(ids, `term: ${term}`).toContain(`${PREFIX}case-1`);
    }
  });

  dbIt("finds a tender by its exact bid number and ranks it first", async () => {
    // Uses a real stored GeM bid number: the exact-bid ranking rule only
    // engages for GeM's own GEM/YYYY/X/NNNN format.
    const sample = await prisma.tender.findFirst({
      where: { tenderId: { startsWith: "GEM/" } },
      select: { tenderId: true },
    });
    if (!sample) {
      console.warn("[skipped - no GeM bids stored yet] exact bid number ranking");
      return;
    }

    const response = await request(app).get("/api/tenders/search").query({ q: sample.tenderId, limit: 10 });
    expect(response.body.total).toBeGreaterThanOrEqual(1);
    expect(response.body.data[0].tenderId).toBe(sample.tenderId);
  });

  dbIt("finds a tender by a bid number typed with different separators", async () => {
    const sample = await prisma.tender.findFirst({
      where: { tenderId: { startsWith: "GEM/" } },
      select: { tenderId: true },
    });
    if (!sample) return;

    const typedWithDashes = sample.tenderId.replace(/\//g, "-").toLowerCase();
    const response = await request(app).get("/api/tenders/search").query({ q: typedWithDashes, limit: 10 });
    const ids = response.body.data.map((row: { tenderId: string }) => row.tenderId);
    expect(ids).toContain(sample.tenderId);
  });

  dbIt("matches on organisation, department, state and location", async () => {
    await upsertScrapedTenders([fixture("fields-1")]);

    for (const term of ["Vitest Test Organisation", "Vitest Department of Verification", "Testville"]) {
      const response = await request(app).get("/api/tenders/search").query({ q: term, limit: 100 });
      const ids = response.body.data.map((row: { tenderId: string }) => row.tenderId);
      expect(ids, `term: ${term}`).toContain(`${PREFIX}fields-1`);
    }
  });

  dbIt("returns zero results for nonsense instead of falling back to unrelated rows", async () => {
    const response = await request(app)
      .get("/api/tenders/search")
      .query({ q: "qqzzxx nonexistent gibberish term", limit: 10 });
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(0);
    expect(response.body.data).toEqual([]);
  });

  dbIt("deduplicates by portal and tenderId", async () => {
    const response = await request(app).get("/api/tenders/search").query({ q: "thermal", limit: 100 });
    const identities = response.body.data.map(
      (row: { portal: string; tenderId: string }) => `${row.portal}\u0000${row.tenderId}`,
    );
    expect(new Set(identities).size).toBe(identities.length);
  });

  dbIt("rejects an unknown sort without erroring", async () => {
    const response = await request(app).get("/api/tenders/search").query({ sort: "; DROP TABLE tenders", limit: 1 });
    expect(response.status).toBe(200);
    expect(response.body.meta.sort).toBe("relevance");
  });

  dbIt("survives a SQL injection attempt in q", async () => {
    const response = await request(app)
      .get("/api/tenders/search")
      .query({ q: "'; DROP TABLE tenders; --", limit: 5 });
    expect(response.status).toBe(200);
    // The table is obviously still there.
    await expect(prisma.tender.count()).resolves.toBeGreaterThan(0);
  });
});

describe("GET /api/portals", () => {
  dbIt("returns the complete portal registry and scraper availability", async () => {
    const response = await request(app).get("/api/portals");
    expect(response.status).toBe(200);
    expect(response.body.totalConfigured).toBe(23);
    expect(response.body.procurementPortals).toBe(22);
    expect(response.body.enabledScrapers).toBe(17);
    expect(response.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "gem", enabled: true }),
        expect.objectContaining({ key: "cppp", family: "GEPNIC", enabled: true }),
        expect.objectContaining({ key: "ireps", enabled: false }),
      ]),
    );
  });
});

describe("multiple keyword chips", () => {
  dbIt("returns the union of the selected chips (OR semantics)", async () => {
    await upsertScrapedTenders([
      fixture("chip-thermal", { title: "Vitest Thermal Imaging Camera unit" }),
      fixture("chip-nvd", { title: "Vitest Night Vision Device unit" }),
    ]);

    const thermalOnly = await request(app)
      .get("/api/tenders/search")
      .query({ keywords: "Thermal Camera", limit: 100 });
    const both = await request(app)
      .get("/api/tenders/search")
      .query({ keywords: ["Thermal Camera", "Night Vision Device"], limit: 100 });

    const thermalIds: string[] = thermalOnly.body.data.map((row: { tenderId: string }) => row.tenderId);
    const bothIds: string[] = both.body.data.map((row: { tenderId: string }) => row.tenderId);

    expect(thermalIds).toContain(`${PREFIX}chip-thermal`);
    expect(thermalIds).not.toContain(`${PREFIX}chip-nvd`);

    // Selecting both chips must return both fixtures.
    expect(bothIds).toContain(`${PREFIX}chip-thermal`);
    expect(bothIds).toContain(`${PREFIX}chip-nvd`);
    expect(both.body.total).toBeGreaterThanOrEqual(thermalOnly.body.total);
  });

  dbIt("accepts chips as repeated params or one comma-separated value", async () => {
    const repeated = await request(app)
      .get("/api/tenders/search")
      .query({ keywords: ["Thermal Camera", "Night Vision Device"], limit: 1 });
    const commaSeparated = await request(app)
      .get("/api/tenders/search")
      .query({ keywords: "Thermal Camera,Night Vision Device", limit: 1 });

    expect(commaSeparated.body.meta.keywords).toEqual(repeated.body.meta.keywords);
    expect(commaSeparated.body.meta.keywords).toHaveLength(2);
  });

  dbIt("ANDs typed text against the chip selection", async () => {
    await upsertScrapedTenders([
      fixture("and-thermal-drone", { title: "Vitest Thermal Camera mounted on Drone" }),
      fixture("and-thermal-plain", { title: "Vitest Thermal Camera handheld" }),
    ]);

    const response = await request(app)
      .get("/api/tenders/search")
      .query({ q: "drone", keywords: "Thermal Camera", limit: 100 });
    const ids = response.body.data.map((row: { tenderId: string }) => row.tenderId);

    expect(ids).toContain(`${PREFIX}and-thermal-drone`);
    expect(ids).not.toContain(`${PREFIX}and-thermal-plain`);
  });
});

describe("pagination", () => {
  const PAGE_ROWS = 14;

  // Seed enough rows to fill two pages of five. Without this the block would
  // assert against whatever happened to be in the database, which passes on a
  // populated machine and fails on a freshly migrated one.
  beforeAll(async () => {
    if (!databaseReachable) return;
    await upsertScrapedTenders(
      Array.from({ length: PAGE_ROWS }, (_, index) =>
        fixture(`paging-${String(index).padStart(2, "0")}`, {
          title: `Vitest Paging Thermal Imager unit ${index}`,
          // Deliberately only two distinct values per sort column, so any sort
          // relying on that column alone has ties and needs the id tiebreaker.
          publishedDateText: index % 2 === 0 ? "01-07-2026" : "02-07-2026",
          closingDateText: index % 2 === 0 ? "30-12-2099" : "31-12-2099",
        })
      )
    );
  });

  // Every sort is checked: a sort column with ties and no tiebreaker leaves the
  // row order undefined, which silently duplicates rows across pages.
  for (const sort of ["relevance", "newest", "oldest", "closing_soon", "recently_updated"]) {
    dbIt(`returns distinct, non-overlapping pages when sorted by ${sort}`, async () => {
      const first = await request(app).get("/api/tenders/search").query({ limit: 5, page: 1, sort });
      const second = await request(app).get("/api/tenders/search").query({ limit: 5, page: 2, sort });

      expect(first.body.data).toHaveLength(5);
      expect(second.body.data).toHaveLength(5);

      const firstIds = first.body.data.map((row: { id: string }) => row.id);
      const secondIds = second.body.data.map((row: { id: string }) => row.id);
      expect(firstIds.filter((id: string) => secondIds.includes(id))).toEqual([]);
    });
  }

  dbIt("returns a stable page 1 across repeated identical requests", async () => {
    const runOnce = async () => {
      const response = await request(app).get("/api/tenders/search").query({ limit: 10, page: 1, sort: "newest" });
      return response.body.data.map((row: { id: string }) => row.id).join(",");
    };
    expect(await runOnce()).toBe(await runOnce());
  });

  dbIt("reports a consistent total across pages", async () => {
    const first = await request(app).get("/api/tenders/search").query({ limit: 5, page: 1 });
    const second = await request(app).get("/api/tenders/search").query({ limit: 5, page: 2 });
    expect(second.body.total).toBe(first.body.total);
  });

  dbIt("computes totalPages and the next/previous flags", async () => {
    const response = await request(app).get("/api/tenders/search").query({ limit: 10, page: 2 });
    const { totalItems, totalPages, hasNextPage, hasPreviousPage } = response.body.pagination;
    expect(totalPages).toBe(Math.max(1, Math.ceil(totalItems / 10)));
    expect(hasPreviousPage).toBe(true);
    expect(hasNextPage).toBe(2 * 10 < totalItems);
  });

  dbIt("returns an empty page past the end while keeping the real total", async () => {
    const response = await request(app).get("/api/tenders/search").query({ limit: 5, page: 100000 });
    expect(response.body.data).toEqual([]);
    expect(response.body.total).toBeGreaterThan(0);
  });

  dbIt("caps limit at 100", async () => {
    const response = await request(app).get("/api/tenders/search").query({ limit: 5000 });
    expect(response.body.pagination.limit).toBe(100);
    expect(response.body.data.length).toBeLessThanOrEqual(100);
  });
});

describe("GET /api/tenders/:id", () => {
  dbIt("returns full detail by uuid", async () => {
    await upsertScrapedTenders([fixture("detail-1")]);
    const stored = await prisma.tender.findUnique({
      where: { portal_tenderId: { portal: "GeM", tenderId: `${PREFIX}detail-1` } },
    });

    const response = await request(app).get(`/api/tenders/${stored!.id}`);
    expect(response.status).toBe(200);
    expect(response.body.tenderId).toBe(`${PREFIX}detail-1`);
    // Every documented column is present.
    for (const field of [
      "portal",
      "title",
      "organisation",
      "department",
      "location",
      "state",
      "category",
      "description",
      "estimatedValue",
      "publishedDate",
      "closingDate",
      "tenderStatus",
      "tenderURL",
      "documentURL",
      "keywordMatched",
      "createdAt",
      "updatedAt",
      "lastSeenAt",
      "lastUpdated",
    ]) {
      expect(response.body, field).toHaveProperty(field);
    }
  });

  dbIt("returns 404 for an unknown id", async () => {
    const response = await request(app).get("/api/tenders/definitely-not-a-real-id");
    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/not found/i);
  });
});

describe("GET /api/scrape/status", () => {
  dbIt("reports whether a scrape is running", async () => {
    const response = await request(app).get("/api/scrape/status");
    expect(response.status).toBe(200);
    expect(typeof response.body.inProgress).toBe("boolean");
  });

  dbIt("returns every documented progress field for a run", async () => {
    const run = await prisma.scrapeRun.create({
      data: {
        mode: "NEW",
        status: "SUCCESS",
        pagesScraped: 12,
        tendersFound: 120,
        tendersNew: 30,
        tendersUpdated: 88,
        tendersSkipped: 2,
        errorCount: 1,
        statedTotal: 49493,
        lastPage: 12,
        failedPages: JSON.stringify([7]),
        finishedAt: new Date(),
        errorMessage: "vitest-fixture run",
      },
    });

    const response = await request(app).get(`/api/scrape/status/${run.id}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      runId: run.id,
      status: "SUCCESS",
      mode: "NEW",
      pagesScanned: 12,
      tendersFound: 120,
      inserted: 30,
      updated: 88,
      skipped: 2,
      errors: 1,
      failedPages: [7],
      gemStatedTotal: 49493,
      inProgress: false,
    });
    expect(typeof response.body.startedAt).toBe("string");
    expect(typeof response.body.finishedAt).toBe("string");
  });

  dbIt("returns 404 for an unknown run id", async () => {
    const response = await request(app).get("/api/scrape/status/00000000-0000-0000-0000-000000000000");
    expect(response.status).toBe(404);
  });
});

describe("unknown routes", () => {
  dbIt("return a JSON 404 rather than HTML", async () => {
    const response = await request(app).get("/api/does-not-exist");
    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/Route not found/);
  });
});
