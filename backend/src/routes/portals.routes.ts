import { Router } from "express";
import { PORTAL_REGISTRY } from "../portals/portalRegistry";
import { PortalRegistryEntry } from "../portals/portal.types";
import { prisma } from "../services/prisma";
import { isPortalRunning } from "../services/portalScrapeService";
import { Prisma } from "@prisma/client";

export const portalsRouter = Router();

async function summarizePortal(entry: PortalRegistryEntry) {
  const { key, enabled, name, baseUrl, supportsAssistedScrape } = entry;
  const lastRun = await prisma.scrapeRun.findFirst({
    where: { portal: key },
    orderBy: { startedAt: "desc" },
  });
  const lastSuccess = await prisma.scrapeRun.findFirst({
    where: { portal: key, status: "success" },
    orderBy: { startedAt: "desc" },
  });
  const tenderCount = await prisma.tender.count({ where: { portal: key } });

  return {
    key,
    name,
    baseUrl,
    enabled,
    supportsAssistedScrape: supportsAssistedScrape ?? false,
    running: isPortalRunning(key),
    tenderCount,
    lastRun: lastRun
      ? {
          id: lastRun.id,
          status: lastRun.status,
          mode: lastRun.mode,
          startedAt: lastRun.startedAt,
          finishedAt: lastRun.finishedAt,
          errorMessage: lastRun.errorMessage,
          statedTotal: lastRun.statedTotal,
        }
      : null,
    lastSuccessfulScrapeAt: lastSuccess?.finishedAt ?? null,
  };
}

portalsRouter.get("/portals", async (_req, res, next) => {
  try {
    const [counts, latestRuns, latestSuccesses] = await Promise.all([
      prisma.tender.groupBy({ by: ["portal"], _count: { id: true } }),
      prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT DISTINCT ON (portal) id, portal, mode, status, "startedAt", "finishedAt", "errorMessage", "statedTotal"
        FROM "ScrapeRun"
        ORDER BY portal, "startedAt" DESC
      `),
      prisma.$queryRaw<{ portal: string; finishedAt: Date | null }[]>(Prisma.sql`
        SELECT DISTINCT ON (portal) portal, "finishedAt"
        FROM "ScrapeRun"
        WHERE status = 'success'
        ORDER BY portal, "startedAt" DESC
      `),
    ]);
    const countsByPortal = new Map(counts.map((row) => [row.portal, row._count.id]));
    const latestByPortal = new Map(latestRuns.map((row) => [row.portal, row]));
    const successByPortal = new Map(latestSuccesses.map((row) => [row.portal, row.finishedAt]));
    const summaries = PORTAL_REGISTRY.map((entry) => {
      const lastRun = latestByPortal.get(entry.key);
      return {
        key: entry.key,
        name: entry.name,
        baseUrl: entry.baseUrl,
        enabled: entry.enabled,
        supportsAssistedScrape: entry.supportsAssistedScrape ?? false,
        running: isPortalRunning(entry.key),
        tenderCount: countsByPortal.get(entry.key) ?? 0,
        lastRun: lastRun
          ? {
              id: lastRun.id,
              status: lastRun.status,
              mode: lastRun.mode,
              startedAt: lastRun.startedAt,
              finishedAt: lastRun.finishedAt,
              errorMessage: lastRun.errorMessage,
              statedTotal: lastRun.statedTotal,
            }
          : null,
        lastSuccessfulScrapeAt: successByPortal.get(entry.key) ?? null,
      };
    });
    res.json({ portals: summaries, count: summaries.length, source: "registry+scrape_runs", searchedAt: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

portalsRouter.get("/portals/:portalKey", async (req, res, next) => {
  try {
    const entry = PORTAL_REGISTRY.find((p) => p.key === req.params.portalKey);
    if (!entry) return res.status(404).json({ error: "not_found", message: "Unknown portal key" });

    const summary = await summarizePortal(entry);
    const recentRuns = await prisma.scrapeRun.findMany({
      where: { portal: entry.key },
      orderBy: { startedAt: "desc" },
      take: 10,
    });
    res.json({ ...summary, capabilities: {
      supportsFullScrape: entry.adapter.supportsFullScrape,
      supportsIncrementalScrape: entry.adapter.supportsIncrementalScrape,
    }, recentRuns });
  } catch (err) {
    next(err);
  }
});
