ALTER TABLE "tenders" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "tenders" ADD COLUMN IF NOT EXISTS "lastSeenRunId" TEXT;

CREATE INDEX IF NOT EXISTS "tenders_lastSeenRunId_idx" ON "tenders"("lastSeenRunId");
CREATE INDEX IF NOT EXISTS "tenders_lastSeenAt_idx" ON "tenders"("lastSeenAt");
