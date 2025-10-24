-- TikTok広告運用自動化システム - データモデル全体追加マイグレーション
-- 日付: 2025-10-22

-- ============================================================================
-- 1. Advertiserテーブル作成
-- ============================================================================
CREATE TABLE "advertisers" (
    "id" TEXT NOT NULL,
    "tiktokAdvertiserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advertisers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "advertisers_tiktokAdvertiserId_key" ON "advertisers"("tiktokAdvertiserId");

-- ============================================================================
-- 2. oauth_tokens テーブル更新（Advertiser外部キー追加）
-- ============================================================================
-- 既存のoauth_tokensテーブルにadvertiser外部キーを追加
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_advertiserId_fkey"
    FOREIGN KEY ("advertiserId") REFERENCES "advertisers"("tiktokAdvertiserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 3. campaigns テーブル更新
-- ============================================================================
-- advertiserIdをUUIDに変更する必要があるため、既存データの移行が必要
-- 一時的に新しいカラムを追加
ALTER TABLE "campaigns" ADD COLUMN "advertiserIdNew" TEXT;

-- advertiserIdNew に一時的にデータをコピー（この時点ではAdvertiserテーブルが空の可能性）
-- UPDATE "campaigns" SET "advertiserIdNew" = "advertiserId";

-- 古いカラムを削除
-- ALTER TABLE "campaigns" DROP COLUMN "advertiserId";

-- 新しいカラムをリネーム
-- ALTER TABLE "campaigns" RENAME COLUMN "advertiserIdNew" TO "advertiserId";

-- 外部キー制約を追加（Advertiserデータが準備できた後）
-- ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_advertiserId_fkey"
--     FOREIGN KEY ("advertiserId") REFERENCES "advertisers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 注意: 既存のキャンペーンデータがある場合、手動でAdvertiserレコードを作成してマッピングする必要があります

-- ============================================================================
-- 4. AdGroup テーブル作成
-- ============================================================================
CREATE TABLE "adgroups" (
    "id" TEXT NOT NULL,
    "tiktokId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "placementType" TEXT,
    "budgetMode" TEXT,
    "budget" DOUBLE PRECISION,
    "bidType" TEXT,
    "bidPrice" DOUBLE PRECISION,
    "targeting" JSONB,
    "schedule" JSONB,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adgroups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "adgroups_tiktokId_key" ON "adgroups"("tiktokId");

ALTER TABLE "adgroups" ADD CONSTRAINT "adgroups_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 5. Creative テーブル作成
-- ============================================================================
CREATE TABLE "creatives" (
    "id" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "tiktokVideoId" TEXT,
    "tiktokImageId" TEXT,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "filename" TEXT NOT NULL,
    "fileSize" INTEGER,
    "duration" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "aspectRatio" TEXT,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creatives_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "creatives" ADD CONSTRAINT "creatives_advertiserId_fkey"
    FOREIGN KEY ("advertiserId") REFERENCES "advertisers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 6. Ad テーブル作成
-- ============================================================================
CREATE TABLE "ads" (
    "id" TEXT NOT NULL,
    "tiktokId" TEXT NOT NULL,
    "adgroupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "creativeId" TEXT NOT NULL,
    "adText" TEXT,
    "callToAction" TEXT,
    "landingPageUrl" TEXT,
    "displayName" TEXT,
    "status" TEXT NOT NULL,
    "reviewStatus" TEXT,
    "reviewMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ads_tiktokId_key" ON "ads"("tiktokId");

ALTER TABLE "ads" ADD CONSTRAINT "ads_adgroupId_fkey"
    FOREIGN KEY ("adgroupId") REFERENCES "adgroups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ads" ADD CONSTRAINT "ads_creativeId_fkey"
    FOREIGN KEY ("creativeId") REFERENCES "creatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 7. metrics テーブル拡張
-- ============================================================================
-- 新しいカラムを追加
ALTER TABLE "metrics" ADD COLUMN "entityType" TEXT;
ALTER TABLE "metrics" ADD COLUMN "adgroupId" TEXT;
ALTER TABLE "metrics" ADD COLUMN "adId" TEXT;
ALTER TABLE "metrics" ADD COLUMN "videoViews" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "metrics" ADD COLUMN "videoWatched2s" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "metrics" ADD COLUMN "videoWatched6s" INTEGER NOT NULL DEFAULT 0;

-- 既存データのentityTypeをCAMPAIGNに設定
UPDATE "metrics" SET "entityType" = 'CAMPAIGN' WHERE "entityType" IS NULL;

-- entityTypeをNOT NULLに変更
ALTER TABLE "metrics" ALTER COLUMN "entityType" SET NOT NULL;

-- campaignIdをNullableに変更
ALTER TABLE "metrics" ALTER COLUMN "campaignId" DROP NOT NULL;

-- 既存のunique制約を削除
ALTER TABLE "metrics" DROP CONSTRAINT IF EXISTS "metrics_campaignId_statDate_key";

-- 新しいインデックスを追加
CREATE UNIQUE INDEX "metric_campaign_unique" ON "metrics"("entityType", "campaignId", "statDate");
CREATE INDEX "metric_adgroup_idx" ON "metrics"("entityType", "adgroupId", "statDate");
CREATE INDEX "metric_ad_idx" ON "metrics"("entityType", "adId", "statDate");
CREATE INDEX "metric_statdate_idx" ON "metrics"("statDate");

-- 外部キー制約を追加
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_adgroupId_fkey"
    FOREIGN KEY ("adgroupId") REFERENCES "adgroups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "metrics" ADD CONSTRAINT "metrics_adId_fkey"
    FOREIGN KEY ("adId") REFERENCES "ads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 8. User テーブル作成
-- ============================================================================
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- ============================================================================
-- 9. Role テーブル作成
-- ============================================================================
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- ============================================================================
-- 10. Permission テーブル作成
-- ============================================================================
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "permissions_name_key" ON "permissions"("name");

-- ============================================================================
-- 11. UserRole 中間テーブル作成
-- ============================================================================
CREATE TABLE "user_roles" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 12. RolePermission 中間テーブル作成
-- ============================================================================
CREATE TABLE "role_permissions" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey"
    FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 13. UserAdvertiser 中間テーブル作成
-- ============================================================================
CREATE TABLE "user_advertisers" (
    "userId" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_advertisers_pkey" PRIMARY KEY ("userId","advertiserId")
);

ALTER TABLE "user_advertisers" ADD CONSTRAINT "user_advertisers_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_advertisers" ADD CONSTRAINT "user_advertisers_advertiserId_fkey"
    FOREIGN KEY ("advertiserId") REFERENCES "advertisers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 14. ChangeLog テーブル作成
-- ============================================================================
CREATE TABLE "change_logs" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "beforeData" JSONB,
    "afterData" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "changelog_entity_idx" ON "change_logs"("entityType", "entityId");
CREATE INDEX "changelog_user_idx" ON "change_logs"("userId");
CREATE INDEX "changelog_created_idx" ON "change_logs"("createdAt");

ALTER TABLE "change_logs" ADD CONSTRAINT "change_logs_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- 15. Experiment テーブル作成
-- ============================================================================
CREATE TABLE "experiments" (
    "id" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT,
    "experimentType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "config" JSONB,
    "result" JSONB,
    "winner" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experiments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "experiments" ADD CONSTRAINT "experiments_advertiserId_fkey"
    FOREIGN KEY ("advertiserId") REFERENCES "advertisers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "experiments" ADD CONSTRAINT "experiments_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 16. WebhookEvent テーブル作成
-- ============================================================================
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signature" TEXT,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "webhook_events_eventId_key" ON "webhook_events"("eventId");
CREATE INDEX "webhook_event_type_idx" ON "webhook_events"("eventType");
CREATE INDEX "webhook_processed_idx" ON "webhook_events"("processed");

-- ============================================================================
-- 17. APILog テーブル作成
-- ============================================================================
CREATE TABLE "api_logs" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "requestBody" JSONB,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB,
    "duration" INTEGER NOT NULL,
    "advertiserId" TEXT,
    "userId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "apilog_endpoint_idx" ON "api_logs"("endpoint");
CREATE INDEX "apilog_status_idx" ON "api_logs"("responseStatus");
CREATE INDEX "apilog_created_idx" ON "api_logs"("createdAt");
