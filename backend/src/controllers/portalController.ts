import { NextFunction, Request, Response } from "express";
import { prisma } from "../config/db";
import {
  PortalScrapeInProgressError,
  PortalScrapeUnavailableError,
  startPortalScrape,
} from "../portals/portalScrapeRunner";
import { PORTALS } from "../portals/portalRegistry";
import {
  AssistedSessionError,
  cancelAssistedSession,
  getAssistedSessionStatus,
  importAssistedSession,
  startAssistedSession,
} from "../portals/assistedPortalSession";
import { getAllPortalJob, startAllPortalJob } from "../portals/allPortalRunner";

export async function listPortals(_req: Request, res: Response, next: NextFunction) {
  try {
    const counts = await prisma.tender.groupBy({
      by: ["portal"],
      _count: { _all: true },
      where: { tenderStatus: "LIVE" },
    });
    const countByPortal = new Map(counts.map((entry) => [entry.portal, entry._count._all]));

    const latestRuns = await prisma.scrapeRun.findMany({
      orderBy: { startedAt: "desc" },
      distinct: ["portal"],
      select: {
        portal: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        statedTotal: true,
        errorMessage: true,
      },
    });
    const runByPortal = new Map(latestRuns.map((run) => [run.portal, run]));

    res.json({
      data: PORTALS.map((portal) => ({
        ...portal,
        storedTenders: countByPortal.get(portal.shortName) ?? 0,
        latestRun: runByPortal.get(portal.shortName) ?? null,
      })),
      totalConfigured: PORTALS.length,
      procurementPortals: PORTALS.filter((portal) => portal.family !== "INFORMATIONAL").length,
      enabledScrapers: PORTALS.filter((portal) => portal.enabled && portal.supportsFullScrape).length,
    });
  } catch (error) {
    next(error);
  }
}

export function scrapeAllAutomaticPortals(req: Request, res: Response) {
  const mode = String(req.body?.mode ?? "NEW").toUpperCase() === "FULL" ? "FULL" : "NEW";
  const { job, alreadyRunning } = startAllPortalJob(mode);
  res.status(202).json({ ...job, alreadyRunning });
}

export function allPortalScrapeStatus(req: Request, res: Response) {
  const job = getAllPortalJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: `All-portal scrape job not found: ${req.params.jobId}` });
    return;
  }
  res.json(job);
}

export async function beginAssistedPortalSession(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await startAssistedSession(req.params.portalKey));
  } catch (error) {
    if (error instanceof AssistedSessionError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    next(error);
  }
}

export async function resumeAssistedPortalSession(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await importAssistedSession(req.params.sessionId));
  } catch (error) {
    if (error instanceof AssistedSessionError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    next(error);
  }
}

export async function assistedPortalSessionStatus(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getAssistedSessionStatus(req.params.sessionId));
  } catch (error) {
    if (error instanceof AssistedSessionError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    next(error);
  }
}

export async function stopAssistedPortalSession(req: Request, res: Response, next: NextFunction) {
  try {
    const cancelled = await cancelAssistedSession(req.params.sessionId);
    res.status(cancelled ? 200 : 404).json({ cancelled });
  } catch (error) {
    next(error);
  }
}

export async function scrapePortal(req: Request, res: Response, next: NextFunction) {
  try {
    const mode = String(req.body?.mode ?? "FULL").toUpperCase() === "NEW" ? "NEW" : "FULL";
    const started = await startPortalScrape(req.params.portalKey, mode);
    res.status(202).json({
      ...started,
      startedAt: started.startedAt.toISOString(),
      statusUrl: `/api/scrape/status/${started.runId}`,
    });
  } catch (error) {
    if (error instanceof PortalScrapeInProgressError) {
      res.status(409).json({
        error: error.message,
        runId: error.runId,
        statusUrl: `/api/scrape/status/${error.runId}`,
      });
      return;
    }
    if (error instanceof PortalScrapeUnavailableError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    next(error);
  }
}
