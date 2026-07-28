import { Router } from "express";
import {
  triggerFullScrape,
  triggerNewTenderScrape,
  scrapeRunStatus,
  scrapeStatus,
} from "../controllers/scrapeController";

const router = Router();

// POST /api/scrape/all            -> start a full GeM sweep, returns a run id
// POST /api/scrape/new            -> scrape newly published / changed tenders
// GET  /api/scrape/status/:runId  -> progress for one run
// GET  /api/scrape/status         -> is anything running, plus the latest run
router.post("/all", triggerFullScrape);
router.post("/new", triggerNewTenderScrape);
// Kept so the bare POST /api/scrape used by earlier builds still works.
router.post("/", triggerFullScrape);
router.get("/status/:runId", scrapeRunStatus);
router.get("/status", scrapeStatus);

export default router;
