import { Router } from "express";
import {
  beginAssistedPortalSession,
  assistedPortalSessionStatus,
  allPortalScrapeStatus,
  listPortals,
  resumeAssistedPortalSession,
  scrapeAllAutomaticPortals,
  scrapePortal,
  stopAssistedPortalSession,
} from "../controllers/portalController";

const router = Router();

router.get("/", listPortals);
router.post("/scrape-all", scrapeAllAutomaticPortals);
router.get("/scrape-all/:jobId", allPortalScrapeStatus);
router.post("/:portalKey/assisted/start", beginAssistedPortalSession);
router.get("/assisted/:sessionId/status", assistedPortalSessionStatus);
router.post("/assisted/:sessionId/import", resumeAssistedPortalSession);
router.delete("/assisted/:sessionId", stopAssistedPortalSession);
router.post("/:portalKey/scrape", scrapePortal);

export default router;
