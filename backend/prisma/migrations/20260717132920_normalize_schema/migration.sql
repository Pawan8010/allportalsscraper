-- DropIndex
DROP INDEX "tenders_search_vector_idx";

-- AlterTable
ALTER TABLE "tenders" ADD COLUMN     "buyerId" TEXT,
ADD COLUMN     "eligibilityId" TEXT,
ADD COLUMN     "financialId" TEXT,
ADD COLUMN     "hash" TEXT,
ADD COLUMN     "locationId" TEXT;

-- CreateTable
CREATE TABLE "buyers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ministry" TEXT,
    "department" TEXT,
    "organisation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "state" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financials" (
    "id" TEXT NOT NULL,
    "estimatedValue" DECIMAL(18,2),
    "emdAmount" DECIMAL(18,2),
    "tenderFee" DECIMAL(18,2),
    "securityDeposit" DECIMAL(18,2),
    "performanceSecurity" DECIMAL(18,2),
    "paymentTerms" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eligibilities" (
    "id" TEXT NOT NULL,
    "experienceYears" INTEGER,
    "turnoverRequired" DECIMAL(18,2),
    "certificatesRequired" TEXT,
    "oemRequired" BOOLEAN DEFAULT false,
    "msmePreference" BOOLEAN DEFAULT false,
    "startupPreference" BOOLEAN DEFAULT false,
    "msePreference" BOOLEAN DEFAULT false,
    "technicalCriteria" TEXT,
    "financialCriteria" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eligibilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION,
    "unit" TEXT,
    "specifications" TEXT,
    "brandRestrictions" TEXT,
    "deliverySchedule" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "update_history" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "update_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "buyers_name_key" ON "buyers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "locations_state_city_country_key" ON "locations"("state", "city", "country");

-- CreateIndex
CREATE INDEX "products_tenderId_idx" ON "products"("tenderId");

-- CreateIndex
CREATE INDEX "attachments_tenderId_idx" ON "attachments"("tenderId");

-- CreateIndex
CREATE INDEX "update_history_tenderId_idx" ON "update_history"("tenderId");

-- AddForeignKey
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "buyers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_financialId_fkey" FOREIGN KEY ("financialId") REFERENCES "financials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_eligibilityId_fkey" FOREIGN KEY ("eligibilityId") REFERENCES "eligibilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "update_history" ADD CONSTRAINT "update_history_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
