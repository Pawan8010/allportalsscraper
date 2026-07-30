-- AlterTable
-- (the auto-generated diff also wanted to DROP search_vector and its trigram
-- indexes here, because they're applied via manual_sql/001_search_support.sql
-- rather than declared in schema.prisma, so Prisma's diff sees them as drift
-- to remove -- stripped out by hand; only the actual intended change (Google
-- account support) remains.)
ALTER TABLE "User" ADD COLUMN "googleId" TEXT,
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");
