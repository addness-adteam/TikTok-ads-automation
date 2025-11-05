/*
  Warnings:

  - You are about to drop the column `advertiserIdNew` on the `campaigns` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "public"."metrics_campaignId_statDate_key";

-- AlterTable
ALTER TABLE "advertisers" ADD COLUMN     "appealId" TEXT;

-- AlterTable
ALTER TABLE "campaigns" DROP COLUMN "advertiserIdNew";

-- CreateTable
CREATE TABLE "appeals" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetCPA" DOUBLE PRECISION,
    "allowableCPA" DOUBLE PRECISION,
    "targetFrontCPO" DOUBLE PRECISION,
    "allowableFrontCPO" DOUBLE PRECISION,
    "cvSpreadsheetUrl" TEXT,
    "frontSpreadsheetUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appeals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "appeals_name_key" ON "appeals"("name");

-- AddForeignKey
ALTER TABLE "advertisers" ADD CONSTRAINT "advertisers_appealId_fkey" FOREIGN KEY ("appealId") REFERENCES "appeals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "advertisers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "metric_campaign_unique" RENAME TO "metrics_entityType_campaignId_statDate_key";
