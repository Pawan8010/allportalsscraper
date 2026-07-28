DROP INDEX IF EXISTS "tenders_tenderId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "tenders_portal_tenderId_key"
  ON "tenders"("portal", "tenderId");
