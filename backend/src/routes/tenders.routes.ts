import { Router } from "express";
import { searchTenders, getPortalCounts } from "../services/searchService";
import { PORTAL_REGISTRY } from "../portals/portalRegistry";
import { prisma } from "../services/prisma";
import { requireAdmin } from "../middleware/requireAdmin";
import { ApiError } from "../middleware/errorHandler";
import { Prisma } from "@prisma/client";

export const tendersRouter = Router();

tendersRouter.delete("/tenders/:id", requireAdmin, async (req, res, next) => {
  try {
    const tender = await prisma.tender.findUnique({
      where: { id: req.params.id },
      select: { id: true, portal: true, tenderId: true, closingDate: true },
    });
    if (!tender) return next(new ApiError(404, "Tender not found."));

    await prisma.$transaction(async (transaction) => {
      await transaction.expiredTender.upsert({
        where: { portal_tenderId: { portal: tender.portal, tenderId: tender.tenderId } },
        create: {
          portal: tender.portal,
          tenderId: tender.tenderId,
          closedAt: tender.closingDate ?? new Date(),
        },
        update: {},
      });
      await transaction.tender.delete({ where: { id: tender.id } });
    });

    res.json({ deleted: true, portal: tender.portal, tenderId: tender.tenderId, permanentlySuppressed: true });
  } catch (err) {
    next(err);
  }
});

// Mirrors the frontend's keyword chips (both are seeded from the "Specific
// Keywords" table in the uploaded PDF) so "Keyword Matches" on the stats bar
// counts the same thing a user gets by clicking every chip at once.
const STATS_KEYWORDS = [
  "Reflex Sight",
  "Thermal Weapon Sight",
  "Night Vision Goggles",
  "Image Intensifier",
  "Electro Optical Surveillance System",
  "PTZ Camera",
  "Border Surveillance System",
];

function parseListParam(v: unknown): string[] | undefined {
  if (!v) return undefined;
  if (Array.isArray(v)) return v.map(String);
  return String(v).split(",").map((s) => s.trim()).filter(Boolean);
}

tendersRouter.get("/tenders/search", async (req, res, next) => {
  try {
    const q = req.query.q ? String(req.query.q) : undefined;
    const portal = req.query.portal ? String(req.query.portal) : undefined;
    const portals = parseListParam(req.query.portals);
    const keywords = parseListParam(req.query.keywords);
    const status = req.query.status ? String(req.query.status) : undefined;
    const relevance = req.query.relevance ? String(req.query.relevance) : undefined;
    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const fromDate = req.query.fromDate ? String(req.query.fromDate) : undefined;
    const toDate = req.query.toDate ? String(req.query.toDate) : undefined;

    // Per-portal counts and freshness used to be computed here too, but
    // nothing in the frontend ever read them from this response -- both are
    // already available independently via /api/portals and
    // /api/tenders/stats. Every search request was paying for 1 + 22 extra
    // queries (getPortalCounts + one scrapeRun lookup per registry entry)
    // for data no one used.
    const { rows, total } = await searchTenders({
      q,
      portal,
      portals,
      keywords,
      status,
      relevance,
      page,
      limit,
      fromDate,
      toDate,
    });

    res.json({
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      totalMatching: total,
      source: "postgresql",
      searchedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

tendersRouter.get("/tenders/stats", async (_req, res, next) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const [totalTenders, portalCounts, reportedRows, closingSoon, newToday, keywordMatches, lastRunOverall] = await Promise.all([
      prisma.tender.count(),
      getPortalCounts(),
      prisma.$queryRaw<{ portal: string; statedTotal: number }[]>(Prisma.sql`
        SELECT DISTINCT ON (portal) portal, "statedTotal"
        FROM "ScrapeRun"
        WHERE "statedTotal" IS NOT NULL
        ORDER BY portal, "startedAt" DESC
      `),
      prisma.tender.count({ where: { closingDate: { gte: now, lte: sevenDaysOut } } }),
      prisma.tender.count({ where: { createdAt: { gte: startOfToday } } }),
      prisma.tender.count({
        where: {
          AND: [
            { OR: STATS_KEYWORDS.map((keyword) => ({ title: { contains: keyword, mode: "insensitive" as const } })) },
            { OR: [{ closingDate: null }, { closingDate: { gte: now } }] },
          ],
        },
      }),
      prisma.scrapeRun.findFirst({ where: { status: { in: ["success", "partial"] } }, orderBy: { finishedAt: "desc" } }),
    ]);
    const reportedByPortal = new Map(reportedRows.map((row) => [row.portal, row.statedTotal]));
    const reportedTotals = PORTAL_REGISTRY.map((portal) => ({ portal: portal.key, statedTotal: reportedByPortal.get(portal.key) ?? null }));
    const totalReported = reportedTotals.reduce((sum, portal) => sum + (portal.statedTotal ?? 0), 0);
    const portalsReportingCount = reportedTotals.filter((portal) => portal.statedTotal != null).length;
    const gemListedTotal = reportedByPortal.get("gem") ?? 0;

    res.json({
      totalTenders,
      totalReported,
      gemListedTotal,
      newToday,
      keywordMatches,
      portalsReportingCount,
      portalCounts,
      reportedTotals,
      portalsEnabled: PORTAL_REGISTRY.filter((p) => p.enabled).length,
      portalsTotal: PORTAL_REGISTRY.length,
      closingSoon,
      lastScrapeAt: lastRunOverall?.finishedAt ?? null,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});
