-- CreateEnum
CREATE TYPE "TenderStatus" AS ENUM ('LIVE', 'CLOSED', 'CANCELLED', 'AWARDED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "tenders" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "portal" TEXT NOT NULL DEFAULT 'GeM',
    "title" TEXT NOT NULL,
    "organisation" TEXT,
    "department" TEXT,
    "location" TEXT,
    "state" TEXT,
    "category" TEXT,
    "description" TEXT,
    "estimatedValue" DECIMAL(18,2),
    "emdAmount" DECIMAL(18,2),
    "tenderFee" DECIMAL(18,2),
    "publishedDate" TIMESTAMP(3),
    "closingDate" TIMESTAMP(3),
    "openingDate" TIMESTAMP(3),
    "keywordMatched" TEXT,
    "tenderStatus" "TenderStatus" NOT NULL DEFAULT 'UNKNOWN',
    "tenderURL" TEXT NOT NULL,
    "documentURL" TEXT,
    "searchVector" tsvector,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrape_runs" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "pagesScraped" INTEGER NOT NULL DEFAULT 0,
    "tendersFound" INTEGER NOT NULL DEFAULT 0,
    "tendersNew" INTEGER NOT NULL DEFAULT 0,
    "tendersUpdated" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "scrape_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (unique + query indexes)
CREATE UNIQUE INDEX "tenders_tenderId_key" ON "tenders"("tenderId");
CREATE INDEX "tenders_tenderId_idx" ON "tenders"("tenderId");
CREATE INDEX "tenders_publishedDate_idx" ON "tenders"("publishedDate");
CREATE INDEX "tenders_closingDate_idx" ON "tenders"("closingDate");
CREATE INDEX "tenders_portal_idx" ON "tenders"("portal");
CREATE INDEX "tenders_title_idx" ON "tenders"("title");
CREATE INDEX "tenders_organisation_idx" ON "tenders"("organisation");
CREATE INDEX "tenders_keywordMatched_idx" ON "tenders"("keywordMatched");
CREATE INDEX "tenders_state_idx" ON "tenders"("state");
CREATE INDEX "tenders_category_idx" ON "tenders"("category");
CREATE INDEX "tenders_tenderStatus_idx" ON "tenders"("tenderStatus");

-- Full text search: generated tsvector kept in sync via trigger, backed by a GIN index.
CREATE OR REPLACE FUNCTION tenders_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('english', coalesce(NEW."title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW."tenderId", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW."organisation", '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW."department", '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW."state", '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW."category", '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW."keywordMatched", '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW."description", '')), 'D');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenders_search_vector_trigger
  BEFORE INSERT OR UPDATE ON "tenders"
  FOR EACH ROW EXECUTE FUNCTION tenders_search_vector_update();

CREATE INDEX "tenders_search_vector_idx" ON "tenders" USING GIN ("searchVector");
