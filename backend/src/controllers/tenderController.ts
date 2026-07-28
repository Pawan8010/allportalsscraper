import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/db";
import {
  getTenderById,
  getTenderByBidNumber,
  getTenderStats,
  getDistinctValues,
} from "../services/tenderService";
import { extractBidNumber } from "../search/normalize";

/**
 * GET /api/tenders/:id
 * Accepts either the internal uuid or the GeM bid number.
 */
export async function getTender(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id;
    let tender = await getTenderById(id);

    if (!tender) {
      // Bid numbers contain slashes, so they arrive URL-encoded.
      const bidNumber = extractBidNumber(decodeURIComponent(id)) ?? decodeURIComponent(id);
      tender = await getTenderByBidNumber(bidNumber);
    }

    if (!tender) {
      res.status(404).json({ error: `Tender not found: ${id}` });
      return;
    }

    res.json(tender);
  } catch (err) {
    next(err);
  }
}

/** GET /api/tenders/stats - dashboard counters, all real database values. */
export async function getStats(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getTenderStats());
  } catch (err) {
    next(err);
  }
}

/** GET /api/tenders/recent - most recently stored tenders. */
export async function getRecentTenders(req: Request, res: Response, next: NextFunction) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? req.query.pageSize) || 10));
    const skip = (page - 1) * limit;

    const [data, totalItems] = await Promise.all([
      prisma.tender.findMany({ orderBy: { createdAt: "desc" }, skip, take: limit }),
      prisma.tender.count(),
    ]);

    res.json({
      data,
      total: totalItems,
      pagination: {
        page,
        limit,
        pageSize: limit,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / limit)),
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getBuyers(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await prisma.buyer.findMany({ orderBy: { name: "asc" } }));
  } catch (err) {
    next(err);
  }
}

export async function getCategories(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getDistinctValues("category"));
  } catch (err) {
    next(err);
  }
}
