CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "Tender"
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(organisation, '') || ' ' || coalesce(department, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '') || ' ' || coalesce(category, '')), 'C')
  ) STORED;

DO $$
BEGIN
  IF to_regclass('public.tenders') IS NOT NULL THEN
    EXECUTE $backfill$
      INSERT INTO "Tender" (
        id,
        portal,
        "portalName",
        "tenderId",
        title,
        organisation,
        department,
        location,
        state,
        category,
        description,
        "estimatedValue",
        "emdAmount",
        "tenderFee",
        "publishedDate",
        "closingDate",
        "openingDate",
        status,
        "tenderURL",
        "documentURL",
        "sourceUrl",
        "sourceUpdatedAt",
        "lastSeenAt",
        "lastSeenRunId",
        "contentHash",
        "createdAt",
        "updatedAt"
      )
      SELECT
        id,
        CASE portal
          WHEN 'GeM' THEN 'gem'
          WHEN 'CPPP' THEN 'cppp'
          WHEN 'Defence' THEN 'defproc'
          WHEN 'Maharashtra' THEN 'maharashtra'
          WHEN 'Karnataka' THEN 'karnataka'
          WHEN 'Tamil Nadu' THEN 'tamilnadu'
          WHEN 'Telangana' THEN 'telangana'
          WHEN 'Andhra Pradesh' THEN 'andhrapradesh'
          WHEN 'Uttar Pradesh' THEN 'uttarpradesh'
          WHEN 'Rajasthan' THEN 'rajasthan'
          WHEN 'Madhya Pradesh' THEN 'madhyapradesh'
          WHEN 'Haryana' THEN 'haryana'
          WHEN 'Punjab' THEN 'punjab'
          WHEN 'Kerala' THEN 'kerala'
          WHEN 'West Bengal' THEN 'westbengal'
          WHEN 'Odisha' THEN 'odisha'
          WHEN 'Bihar' THEN 'bihar'
          WHEN 'Jharkhand' THEN 'jharkhand'
          WHEN 'Assam' THEN 'assam'
          WHEN 'IREPS' THEN 'ireps'
          WHEN 'Coal India' THEN 'coalindia'
          WHEN 'Gujarat' THEN 'gujarat_nprocure'
          ELSE lower(regexp_replace(portal, '[^a-zA-Z0-9]+', '', 'g'))
        END,
        portal,
        "tenderId",
        title,
        organisation,
        department,
        location,
        state,
        category,
        description,
        "estimatedValue",
        "emdAmount",
        "tenderFee",
        "publishedDate",
        "closingDate",
        "openingDate",
        lower("tenderStatus"::text),
        "tenderURL",
        "documentURL",
        "tenderURL",
        "lastUpdated",
        coalesce("lastSeenAt", "lastUpdated", "updatedAt", CURRENT_TIMESTAMP),
        "lastSeenRunId",
        coalesce(hash, md5(portal || ':' || "tenderId" || ':' || title)),
        "createdAt",
        "updatedAt"
      FROM tenders
      ON CONFLICT DO NOTHING
    $backfill$;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS tender_search_vector_idx ON "Tender" USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS tender_title_trgm_idx ON "Tender" USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tender_tenderid_trgm_idx ON "Tender" USING GIN ("tenderId" gin_trgm_ops);
