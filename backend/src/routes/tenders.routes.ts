import { Router } from "express";
import { searchTenders, getPortalCounts } from "../services/searchService";
import { PORTAL_REGISTRY } from "../portals/portalRegistry";
import { prisma } from "../services/prisma";

export const tendersRouter = Router();

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
    const totalTenders = await prisma.tender.count();
    const portalCounts = await getPortalCounts();

    // The portal's own reported total, per portal, from the most recent run
    // that actually captured one (most GePNIC listings never expose an
    // overall count, so those portals are simply absent from this sum, not
    // counted as zero).
    const reportedTotals = await Promise.all(
      PORTAL_REGISTRY.map(async (p) => {
        const lastRunWithTotal = await prisma.scrapeRun.findFirst({
          where: { portal: p.key, statedTotal: { not: null } },
          orderBy: { startedAt: "desc" },
        });
        return { portal: p.key, statedTotal: lastRunWithTotal?.statedTotal ?? null };
      })
    );
    const totalReported = reportedTotals.reduce((sum, p) => sum + (p.statedTotal ?? 0), 0);
    const portalsReportingCount = reportedTotals.filter((p) => p.statedTotal != null).length;
    const gemListedTotal = reportedTotals.find((p) => p.portal === "gem")?.statedTotal ?? 0;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const closingSoon = await prisma.tender.count({
      where: { closingDate: { gte: now, lte: sevenDaysOut } },
    });
    const newToday = await prisma.tender.count({ where: { createdAt: { gte: startOfToday } } });
    const keywordMatches = await prisma.tender.count({
      where: {
        AND: [
          { OR: STATS_KEYWORDS.map((k) => ({ title: { contains: k, mode: "insensitive" as const } })) },
          { OR: [{ closingDate: null }, { closingDate: { gte: now } }] },
        ],
      },
    });

    const lastRunOverall = await prisma.scrapeRun.findFirst({
      where: { status: { in: ["success", "partial"] } },
      orderBy: { finishedAt: "desc" },
    });

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
