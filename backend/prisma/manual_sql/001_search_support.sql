-- Full-text + trigram search support for the Tender table.
-- Run this once, after `prisma migrate deploy`, against the same database.
-- It is written as a separate manual step (rather than inside schema.prisma)
-- because Prisma's declarative schema does not model PostgreSQL generated
-- tsvector columns or extensions cleanly. This file is idempotent — safe to
-- re-run.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "Tender"
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(organisation, '') || ' ' || coalesce(department, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '') || ' ' || coalesce(category, '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS tender_search_vector_idx ON "Tender" USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS tender_title_trgm_idx ON "Tender" USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tender_tenderid_trgm_idx ON "Tender" USING GIN ("tenderId" gin_trgm_ops);
