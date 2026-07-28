import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/config/db";
import { STALE_RUN_THRESHOLD_MS, markInterruptedScrapes, resolveResumePoint } from "../src/scraper/scrapeRunner";

/**
 * Resume semantics: a full or incremental sweep must continue from the last
 * stored page of the previous attempt *only if that attempt did not finish*.
 *
 * Fixture runs are tagged in errorMessage and removed afterwards.
 */

const TAG = "vitest-resume-fixture";
// A dedicated portal keeps these fixtures out of the way of real GeM runs, so
// the suite is hermetic even while a live scrape is writing to the same database.
const PORTAL = "VITEST-RESUME";

let databaseReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseReachable = true;
  } catch {
    databaseReachable = false;
  }
});

afterEach(async () => {
  if (!databaseReachable) return;
  await prisma.scrapeRun.deleteMany({ where: { portal: PORTAL } });
});

const dbIt = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!databaseReachable) {
      console.warn(`[skipped - PostgreSQL unreachable] ${name}`);
      return;
    }
    await fn();
  });

/** Creates a finished run of the given mode/status with an explicit start time. */
async function run(options: {
  mode: string;
  status: string;
  lastPage: number;
  minutesAgo: number;
  failedPages?: number[];
}) {
  return prisma.scrapeRun.create({
    data: {
      portal: PORTAL,
      mode: options.mode,
      status: options.status,
      lastPage: options.lastPage,
      failedPages: options.failedPages ? JSON.stringify(options.failedPages) : null,
      startedAt: new Date(Date.now() - options.minutesAgo * 60_000),
      finishedAt: new Date(Date.now() - (options.minutesAgo - 1) * 60_000),
      errorMessage: TAG,
    },
  });
}

describe("resolveResumePoint", () => {
  dbIt("resumes from an interrupted run's watermark", async () => {
    const interrupted = await run({ mode: "FULL", status: "INTERRUPTED", lastPage: 2104, minutesAgo: 10 });

    const point = await resolveResumePoint("FULL", 1, PORTAL);
    expect(point.startPage).toBe(2105);
    expect(point.resumedFromRunId).toBe(interrupted.id);
  });

  dbIt("re-queues the pages that failed in the interrupted run", async () => {
    await run({ mode: "FULL", status: "PARTIAL", lastPage: 500, minutesAgo: 10, failedPages: [12, 99] });

    const point = await resolveResumePoint("FULL", 1, PORTAL);
    expect(point.retryPages).toEqual([12, 99]);
  });

  dbIt("starts fresh from page 1 once a later run has completed", async () => {
    // This is the regression: an older INTERRUPTED run used to keep winning,
    // so every later sweep restarted mid-listing and pages 1..N were never
    // read again.
    await run({ mode: "FULL", status: "INTERRUPTED", lastPage: 2669, minutesAgo: 20 });
    await run({ mode: "FULL", status: "SUCCESS", lastPage: 4843, minutesAgo: 5 });

    const point = await resolveResumePoint("FULL", 1, PORTAL);
    expect(point.startPage).toBe(1);
    expect(point.resumedFromRunId).toBeNull();
    expect(point.retryPages).toEqual([]);
  });

  dbIt("does not let one mode's watermark leak into the other", async () => {
    await run({ mode: "NEW", status: "INTERRUPTED", lastPage: 40, minutesAgo: 5 });

    const full = await resolveResumePoint("FULL", 1, PORTAL);
    expect(full.startPage).toBe(1);
    expect(full.resumedFromRunId).toBeNull();

    const incremental = await resolveResumePoint("NEW", 1, PORTAL);
    expect(incremental.startPage).toBe(41);
  });

  dbIt("ignores an interrupted run that never stored a page", async () => {
    await run({ mode: "FULL", status: "FAILED", lastPage: 0, minutesAgo: 5 });

    const point = await resolveResumePoint("FULL", 1, PORTAL);
    expect(point.startPage).toBe(1);
    expect(point.resumedFromRunId).toBeNull();
  });

  dbIt("never moves the start page backwards from the configured floor", async () => {
    await run({ mode: "FULL", status: "INTERRUPTED", lastPage: 10, minutesAgo: 5 });

    const point = await resolveResumePoint("FULL", 900, PORTAL);
    expect(point.startPage).toBe(900);
  });
});

/** Creates a RUNNING row with an explicit heartbeat age. */
async function runningRun(heartbeatAgeMs: number | null) {
  return prisma.scrapeRun.create({
    data: {
      portal: PORTAL,
      mode: "FULL",
      status: "RUNNING",
      lastPage: 1200,
      startedAt: new Date(Date.now() - 10 * 60_000),
      heartbeatAt: heartbeatAgeMs === null ? null : new Date(Date.now() - heartbeatAgeMs),
      errorMessage: TAG,
    },
  });
}

describe("markInterruptedScrapes", () => {
  dbIt("leaves a run alone while its heartbeat is current", async () => {
    // The regression: booting a second backend against the same database used
    // to flip a healthy, actively-running scrape to INTERRUPTED.
    const live = await runningRun(2_000);

    await markInterruptedScrapes();

    const after = await prisma.scrapeRun.findUnique({ where: { id: live.id } });
    expect(after!.status).toBe("RUNNING");
    expect(after!.finishedAt).toBeNull();
  });

  dbIt("marks a run whose heartbeat has gone quiet", async () => {
    const abandoned = await runningRun(STALE_RUN_THRESHOLD_MS + 30_000);

    await markInterruptedScrapes();

    const after = await prisma.scrapeRun.findUnique({ where: { id: abandoned.id } });
    expect(after!.status).toBe("INTERRUPTED");
    expect(after!.finishedAt).not.toBeNull();
    // The watermark survives, so the next run of this mode can resume from it.
    expect(after!.lastPage).toBe(1200);
  });

  dbIt("marks an old run that never recorded a heartbeat at all", async () => {
    const legacy = await runningRun(null);

    await markInterruptedScrapes();

    const after = await prisma.scrapeRun.findUnique({ where: { id: legacy.id } });
    expect(after!.status).toBe("INTERRUPTED");
  });
});
