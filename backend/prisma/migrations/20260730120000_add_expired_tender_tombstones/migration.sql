CREATE TABLE "ExpiredTender" (
  "id" TEXT NOT NULL,
  "portal" TEXT NOT NULL,
  "tenderId" TEXT NOT NULL,
  "closedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExpiredTender_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExpiredTender_portal_tenderId_key"
  ON "ExpiredTender"("portal", "tenderId");

CREATE INDEX "ExpiredTender_closedAt_idx"
  ON "ExpiredTender"("closedAt");
