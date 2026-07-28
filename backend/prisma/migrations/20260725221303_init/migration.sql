-- CreateTable
CREATE TABLE "Tender" (
    "id" TEXT NOT NULL,
    "portal" TEXT NOT NULL,
    "portalName" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
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
    "status" TEXT,
    "tenderURL" TEXT NOT NULL,
    "documentURL" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenRunId" TEXT,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapeRun" (
    "id" TEXT NOT NULL,
    "portal" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "pagesScanned" INTEGER NOT NULL DEFAULT 0,
    "tendersFound" INTEGER NOT NULL DEFAULT 0,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "lastPage" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ScrapeRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tender_portal_idx" ON "Tender"("portal");

-- CreateIndex
CREATE INDEX "Tender_tenderId_idx" ON "Tender"("tenderId");

-- CreateIndex
CREATE INDEX "Tender_title_idx" ON "Tender"("title");

-- CreateIndex
CREATE INDEX "Tender_organisation_idx" ON "Tender"("organisation");

-- CreateIndex
CREATE INDEX "Tender_department_idx" ON "Tender"("department");

-- CreateIndex
CREATE INDEX "Tender_state_idx" ON "Tender"("state");

-- CreateIndex
CREATE INDEX "Tender_category_idx" ON "Tender"("category");

-- CreateIndex
CREATE INDEX "Tender_publishedDate_idx" ON "Tender"("publishedDate");

-- CreateIndex
CREATE INDEX "Tender_closingDate_idx" ON "Tender"("closingDate");

-- CreateIndex
CREATE INDEX "Tender_status_idx" ON "Tender"("status");

-- CreateIndex
CREATE INDEX "Tender_lastSeenAt_idx" ON "Tender"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tender_portal_tenderId_key" ON "Tender"("portal", "tenderId");

-- CreateIndex
CREATE INDEX "ScrapeRun_portal_idx" ON "ScrapeRun"("portal");

-- CreateIndex
CREATE INDEX "ScrapeRun_status_idx" ON "ScrapeRun"("status");

-- CreateIndex
CREATE INDEX "ScrapeRun_startedAt_idx" ON "ScrapeRun"("startedAt");
