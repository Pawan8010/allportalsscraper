import { Router } from "express";
import { z } from "zod";
import {
  scrapePortal,
  startScrapeAllInBackground,
  getPortalScrapeStatus,
} from "../services/portalScrapeService";
import {
  startAssistedSession,
  getAssistedSessionStatus,
  importAssistedSession,
  cancelAssistedSession,
  AssistedSessionError,
} from "../services/assistedSessionService";
import { getPortalEntry } from "../portals/portalRegistry";
import { prisma } from "../services/prisma";
import { ApiError } from "../middleware/errorHandler";
import { scrapeTriggerLimiter } from "../middleware/rateLimit";

export const scrapeRouter = Router();

const modeSchema = z.object({
  mode: z.enum(["full", "incremental"]).default("full"),
  // Lets a caller request a deeper (or shallower) sweep than an adapter's
  // own default -- e.g. GeM defaults to 50 pages per run to avoid hammering
  // its public API by default; pass a larger value here for a full sweep.
  maxPages: z.number().int().positive().optional(),
});

scrapeRouter.post("/scrape/portal/:portalKey", scrapeTriggerLimiter, async (req, res, next) => {
  try {
    const entry = getPortalEntry(req.params.portalKey);
    if (!entry) throw new ApiError(404, "Unknown portal key");
    const { mode, maxPages } = modeSchema.parse(req.body ?? {});
    const result = await scrapePortal(entry.key, mode, maxPages);
    res.status(202).json(result);
  } catch (err) {
    next(err);
  }
});

// Both batch endpoints return as soon as the sweep is queued -- a full run
// takes tens of minutes, so awaiting it here just guaranteed a client
// timeout. Progress is read from GET /scrape/runs, which the dashboard polls.
scrapeRouter.post("/scrape/all-portals", scrapeTriggerLimiter, (_req, res, next) => {
  try {
    res.status(202).json(startScrapeAllInBackground("full"));
  } catch (err) {
    next(err);
  }
});

scrapeRouter.post("/scrape/new-all-portals", scrapeTriggerLimiter, (_req, res, next) => {
  try {
    res.status(202).json(startScrapeAllInBackground("incremental"));
  } catch (err) {
    next(err);
  }
});

scrapeRouter.get("/scrape/runs", async (req, res, next) => {
  try {
    const { portal, status, limit } = req.query;
    const runs = await prisma.scrapeRun.findMany({
      where: {
        ...(portal ? { portal: String(portal) } : {}),
        ...(status ? { status: String(status) } : {}),
      },
      orderBy: { startedAt: "desc" },
      take: limit ? Math.min(200, Number(limit)) : 50,
    });
    res.json({ runs, count: runs.length });
  } catch (err) {
    next(err);
  }
});

scrapeRouter.get("/scrape/status/:runId", async (req, res, next) => {
  try {
    const status = await getPortalScrapeStatus(req.params.runId);
    if (!status) throw new ApiError(404, "Unknown runId");
    res.json(status);
  } catch (err) {
    next(err);
  }
});

function handleAssistedError(err: unknown, next: (err: unknown) => void) {
  if (err instanceof AssistedSessionError) return next(new ApiError(err.status, err.message));
  next(err);
}

scrapeRouter.post("/scrape/assisted/:portalKey/start", scrapeTriggerLimiter, async (req, res, next) => {
  try {
    const session = await startAssistedSession(req.params.portalKey);
    res.status(202).json(session);
  } catch (err) {
    handleAssistedError(err, next);
  }
});

scrapeRouter.get("/scrape/assisted/:sessionId/status", async (req, res, next) => {
  try {
    const status = await getAssistedSessionStatus(req.params.sessionId);
    res.json(status);
  } catch (err) {
    handleAssistedError(err, next);
  }
});

scrapeRouter.post("/scrape/assisted/:sessionId/import", async (req, res, next) => {
  try {
    const result = await importAssistedSession(req.params.sessionId);
    res.status(202).json(result);
  } catch (err) {
    handleAssistedError(err, next);
  }
});

scrapeRouter.post("/scrape/assisted/:sessionId/cancel", async (req, res, next) => {
  try {
    const cancelled = await cancelAssistedSession(req.params.sessionId);
    res.json({ cancelled });
  } catch (err) {
    handleAssistedError(err, next);
  }
});
