-- Full-text + trigram search support and richer scrape-run progress tracking.

-- Extensions used by the search pipeline.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- The 20260717132920_normalize_schema migration dropped the GIN index that
-- backs full text search. Recreate it (the trigger that maintains
-- "searchVector" was never dropped, so existing rows stay correct).
CREATE INDEX IF NOT EXISTS "tenders_search_vector_idx" ON "tenders" USING GIN ("searchVector");

-- Trigram indexes give prefix / typo tolerant matching on the fields users
-- actually type into the search box.
CREATE INDEX IF NOT EXISTS "tenders_title_trgm_idx" ON "tenders" USING GIN ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "tenders_tenderId_trgm_idx" ON "tenders" USING GIN ("tenderId" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "tenders_organisation_trgm_idx" ON "tenders" USING GIN ("organisation" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "tenders_department_trgm_idx" ON "tenders" USING GIN ("department" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "tenders_keywordMatched_trgm_idx" ON "tenders" USING GIN ("keywordMatched" gin_trgm_ops);

-- Plain btree indexes for the remaining filterable columns.
CREATE INDEX IF NOT EXISTS "tenders_department_idx" ON "tenders"("department");
CREATE INDEX IF NOT EXISTS "tenders_location_idx" ON "tenders"("location");

-- Scrape run progress / resumability columns.
ALTER TABLE "scrape_runs" ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'FULL';
ALTER TABLE "scrape_runs" ADD COLUMN IF NOT EXISTS "tendersSkipped" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "scrape_runs" ADD COLUMN IF NOT EXISTS "errorCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "scrape_runs" ADD COLUMN IF NOT EXISTS "statedTotal" INTEGER;
ALTER TABLE "scrape_runs" ADD COLUMN IF NOT EXISTS "lastPage" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "scrape_runs" ADD COLUMN IF NOT EXISTS "failedPages" TEXT;

CREATE INDEX IF NOT EXISTS "scrape_runs_status_idx" ON "scrape_runs"("status");
CREATE INDEX IF NOT EXISTS "scrape_runs_startedAt_idx" ON "scrape_runs"("startedAt");
