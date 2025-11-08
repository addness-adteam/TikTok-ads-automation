-- DropIndex
DROP INDEX IF EXISTS "public"."metric_ad_idx";

-- DropIndex
DROP INDEX IF EXISTS "public"."metric_adgroup_idx";

-- DropIndex
DROP INDEX IF EXISTS "public"."metrics_entityType_campaignId_statDate_key";

-- DropIndex (drop old unique constraints if they exist)
DROP INDEX IF EXISTS "public"."metric_campaign_unique";
DROP INDEX IF EXISTS "public"."metric_adgroup_unique";
DROP INDEX IF EXISTS "public"."metric_ad_unique";

-- CreateIndex: Partial unique indexes for metrics
-- これらのインデックスはNULL値を除外し、ON CONFLICTが正しく動作するようにします
CREATE UNIQUE INDEX "metric_campaign_unique" ON "public"."metrics" ("entityType", "campaignId", "statDate") WHERE "campaignId" IS NOT NULL;
CREATE UNIQUE INDEX "metric_adgroup_unique" ON "public"."metrics" ("entityType", "adgroupId", "statDate") WHERE "adgroupId" IS NOT NULL;
CREATE UNIQUE INDEX "metric_ad_unique" ON "public"."metrics" ("entityType", "adId", "statDate") WHERE "adId" IS NOT NULL;
