-- Keep search latency stable while scrapes are inserting rows.
--
-- GIN indexes buffer newly inserted entries in an unordered "pending list"
-- rather than merging them into the tree on every insert. Reads must scan that
-- pending list linearly, so after a large scrape every search pays for it. On
-- the live corpus this was the single largest source of search latency:
-- "thermal camera" measured 0.49s with flushed indexes and 2.7s once a scrape
-- had filled the pending lists; a three-keyword search went from 1.3s to 6.6s.
--
-- The default gin_pending_list_limit is 4MB per index. Lowering it to 512kB
-- makes the accumulating writer flush far sooner, which bounds how slow a read
-- can get. Bulk inserts pay slightly more, which is the right trade here: the
-- scrape is a background job while search is interactive.
--
-- The scrape runners also VACUUM (ANALYZE) "tenders" when a run finishes, which
-- drains these lists completely and refreshes planner statistics.

ALTER INDEX "tenders_search_vector_idx" SET (gin_pending_list_limit = 512);
ALTER INDEX "tenders_title_trgm_idx" SET (gin_pending_list_limit = 512);
ALTER INDEX "tenders_organisation_trgm_idx" SET (gin_pending_list_limit = 512);
ALTER INDEX "tenders_department_trgm_idx" SET (gin_pending_list_limit = 512);
ALTER INDEX "tenders_keywordMatched_trgm_idx" SET (gin_pending_list_limit = 512);
ALTER INDEX "tenders_tenderId_trgm_idx" SET (gin_pending_list_limit = 512);
