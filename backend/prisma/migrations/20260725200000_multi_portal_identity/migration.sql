ALTER TABLE "tenders" DROP CONSTRAINT IF EXISTS "tenders_tenderId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "tenders_portal_tenderId_key"
  ON "tenders"("portal", "tenderId");

ALTER TABLE "scrape_runs"
  ADD COLUMN IF NOT EXISTS "portal" TEXT NOT NULL DEFAULT 'GeM';

CREATE INDEX IF NOT EXISTS "scrape_runs_portal_idx"
  ON "scrape_runs"("portal");
