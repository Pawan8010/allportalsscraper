-- Add "location" to the full-text search vector.
--
-- The search pipeline matches short fields with ILIKE only where a GIN trigram
-- index exists (title, keywordMatched, organisation, department); every other
-- text column is reached through "searchVector". "location" was in neither, so
-- it was effectively unsearchable. Weight C puts it alongside state/category.

CREATE OR REPLACE FUNCTION public.tenders_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('english', coalesce(NEW."title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW."tenderId", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW."organisation", '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW."department", '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW."keywordMatched", '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW."state", '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW."category", '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW."location", '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW."description", '')), 'D');
  RETURN NEW;
END
$function$;

-- Backfill existing rows through the trigger. "lastUpdated" is set to itself so
-- no business column changes value; only "searchVector" is recomputed.
UPDATE "tenders" SET "lastUpdated" = "lastUpdated";
