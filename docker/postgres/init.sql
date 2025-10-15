-- TikTok広告運用自動化システム - PostgreSQL初期化スクリプト

-- データベースが存在しない場合は作成（docker-composeで自動作成されるため通常不要）
-- CREATE DATABASE tiktok_ads_automation;

-- 拡張機能の有効化
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";  -- UUID生成
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- テキスト検索高速化

-- タイムゾーン設定
SET timezone = 'Asia/Tokyo';

-- コメント
COMMENT ON DATABASE tiktok_ads_automation IS 'TikTok広告運用自動化システム - メインデータベース';

-- 初期化完了ログ
DO $$
BEGIN
  RAISE NOTICE 'TikTok Ads Automation Database initialized successfully';
END $$;
