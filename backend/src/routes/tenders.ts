import { Router } from "express";
import {
  getTender,
  getStats,
  getRecentTenders,
  getBuyers,
  getCategories,
} from "../controllers/tenderController";
import { searchTenders } from "../controllers/searchController";

const router = Router();

// GET /api/tenders/stats   -> dashboard counters
// GET /api/tenders/search  -> the single normalized search pipeline
// GET /api/tenders         -> same pipeline with no search terms (browse everything)
// GET /api/tenders/:id     -> full tender detail by uuid or GeM bid number
//
// Static segments are registered before "/:id" so they are not swallowed by it.
router.get("/stats", getStats);
router.get("/search", searchTenders);
router.get("/recent", getRecentTenders);
router.get("/buyers", getBuyers);
router.get("/categories", getCategories);
router.get("/", searchTenders);
router.get("/:id", getTender);

export default router;
