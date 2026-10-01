-- Full-text + trigram search support for the Tender table.
-- Run this once, after `prisma migrate deploy`, against the same database.
-- It is written as a separate manual step (rather than inside schema.prisma)
-- because Prisma's declarative schema does not model PostgreSQL generated
-- tsvector columns or extensions cleanly. This file is idempotent — safe to
-- re-run.
--
-- IMPORTANT: this step is NOT tracked by Prisma's migration history at all.
-- If the database schema is ever rebuilt from the tracked migrations alone
-- (a fresh `prisma migrate deploy` against an empty database, restoring
-- from a backup that only captured table data, etc.), search_vector and
-- these indexes will silently be missing and every full-text/keyword search
-- request will 500 with `column "search_vector" does not exist` -- this is
-- not hypothetical, it happened for real on 29 Jul 2026 after the database
-- was accidentally wiped and rebuilt. Re-run this file by hand any time the
-- schema is rebuilt from scratch.

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
