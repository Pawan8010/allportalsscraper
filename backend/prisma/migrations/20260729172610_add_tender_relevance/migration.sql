-- AlterTable
-- (the auto-generated diff also wanted to DROP search_vector and its trigram
-- indexes here, because they're applied via manual_sql/001_search_support.sql
-- rather than declared in schema.prisma, so Prisma's diff sees them as drift
-- to remove -- stripped out by hand; only the actual intended change (the
-- new relevance column) remains.)
ALTER TABLE "Tender" ADD COLUMN "relevance" TEXT;

-- CreateIndex
CREATE INDEX "Tender_relevance_idx" ON "Tender"("relevance");
