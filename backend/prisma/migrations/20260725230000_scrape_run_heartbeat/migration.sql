-- Heartbeat for in-flight scrape runs.
--
-- Startup marks leftover RUNNING rows as INTERRUPTED so a later scrape can
-- resume them. Without a heartbeat that sweep could not tell a run abandoned by
-- a dead process from one another live process was still advancing, so booting a
-- second backend against the same database flipped a healthy running scrape to
-- INTERRUPTED and corrupted the resume watermark.

ALTER TABLE "scrape_runs" ADD COLUMN IF NOT EXISTS "heartbeatAt" TIMESTAMP(3);

-- Existing RUNNING rows have no heartbeat, so they are treated as stale and
-- cleaned up on the next boot - which is the correct outcome for them.
CREATE INDEX IF NOT EXISTS "scrape_runs_heartbeatAt_idx" ON "scrape_runs"("heartbeatAt");
