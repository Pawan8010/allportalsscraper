import { randomUUID } from "node:crypto";
import { config } from "../config/env";
import { prisma } from "../config/db";
import { getScrapeRunStatus, startScrape } from "../scraper/scrapeRunner";
import { logger } from "../utils/logger";
import { startPortalScrape } from "./portalScrapeRunner";
import { PORTALS } from "./portalRegistry";

type JobStatus = "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";

export type AllPortalJob = {
  id: string;
  status: JobStatus;
  mode: "FULL" | "NEW";
  totalPortals: number;
  completedPortals: number;
  currentPortal: string | null;
  currentPortals: string[];
  successfulPortals: string[];
  failedPortals: Array<{ portal: string; error: string }>;
  startedAt: string;
  finishedAt: string | null;
};

const jobs = new Map<string, AllPortalJob>();
let activeJobId: string | null = null;

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForRun(runId: string) {
  while (true) {
    const run = await prisma.scrapeRun.findUnique({
      where: { id: runId },
      select: { status: true, errorMessage: true },
    });
    if (!run) throw new Error(`Scrape run disappeared: ${runId}`);
    if (run.status !== "RUNNING") return run;
    await wait(2_000);
  }
}

async function execute(job: AllPortalJob) {
  const storedCounts = await prisma.tender.groupBy({
    by: ["portal"],
    _count: { _all: true },
  });
  const countByPortal = new Map(storedCounts.map((entry) => [entry.portal, entry._count._all]));
  const automaticPortals = PORTALS.filter(
    (portal) => portal.enabled && portal.supportsFullScrape
  ).sort((left, right) => {
    if (left.key === "gem") return 1;
    if (right.key === "gem") return -1;
    return (countByPortal.get(left.shortName) ?? 0) - (countByPortal.get(right.shortName) ?? 0);
  });

  const gemPortal = automaticPortals.find((portal) => portal.key === "gem");
  const statePortals = automaticPortals.filter((portal) => portal.key !== "gem");

  const runPortal = async (portal: (typeof automaticPortals)[number]) => {
    job.currentPortals.push(portal.shortName);
    job.currentPortal = job.currentPortals.join(", ");
    try {
      const started = await startPortalScrape(portal.key, job.mode);
      const finished = await waitForRun(started.runId);
      if (!["SUCCESS", "PARTIAL"].includes(finished.status)) {
        throw new Error(finished.errorMessage ?? `Finished as ${finished.status}`);
      }
      job.successfulPortals.push(portal.shortName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      job.failedPortals.push({ portal: portal.shortName, error: message });
      logger.warn(`[allPortalRunner] ${portal.shortName} failed: ${message}`);
    } finally {
      job.currentPortals = job.currentPortals.filter((name) => name !== portal.shortName);
      job.currentPortal = job.currentPortals.join(", ") || null;
      job.completedPortals += 1;
    }
  };

  let nextPortalIndex = 0;
  const worker = async () => {
    while (nextPortalIndex < statePortals.length) {
      const portal = statePortals[nextPortalIndex];
      nextPortalIndex += 1;
      await runPortal(portal);
    }
  };

  const workerCount = Math.min(config.portalScraperConcurrency, statePortals.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (gemPortal) {
    job.currentPortals = [gemPortal.shortName];
    job.currentPortal = gemPortal.shortName;
    try {
      const started = await startScrape({ mode: job.mode, resume: true });
      const status = await getScrapeRunStatus(started.runId);
      if (!status) throw new Error("GeM run could not be read");
      const finished = await waitForRun(started.runId);
      if (!["SUCCESS", "PARTIAL"].includes(finished.status)) {
        throw new Error(finished.errorMessage ?? `Finished as ${finished.status}`);
      }
      job.successfulPortals.push(gemPortal.shortName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      job.failedPortals.push({ portal: gemPortal.shortName, error: message });
      logger.warn(`[allPortalRunner] ${gemPortal.shortName} failed: ${message}`);
    } finally {
      job.currentPortals = [];
      job.currentPortal = null;
      job.completedPortals += 1;
    }
  }

  job.currentPortal = null;
  job.finishedAt = new Date().toISOString();
  job.status =
    job.failedPortals.length === 0
      ? "SUCCESS"
      : job.successfulPortals.length === 0
        ? "FAILED"
        : "PARTIAL";
  activeJobId = null;
}

export function startAllPortalJob(mode: "FULL" | "NEW") {
  if (activeJobId) {
    const active = jobs.get(activeJobId);
    if (active) return { job: active, alreadyRunning: true };
  }

  const id = randomUUID();
  const totalPortals = PORTALS.filter((portal) => portal.enabled && portal.supportsFullScrape).length;
  const job: AllPortalJob = {
    id,
    status: "RUNNING",
    mode,
    totalPortals,
    completedPortals: 0,
    currentPortal: null,
    currentPortals: [],
    successfulPortals: [],
    failedPortals: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.set(id, job);
  activeJobId = id;
  void execute(job).catch((error) => {
    job.status = "FAILED";
    job.finishedAt = new Date().toISOString();
    job.failedPortals.push({ portal: job.currentPortal ?? "orchestrator", error: String(error) });
    activeJobId = null;
  });
  return { job, alreadyRunning: false };
}

export function getAllPortalJob(jobId: string) {
  return jobs.get(jobId) ?? null;
}
