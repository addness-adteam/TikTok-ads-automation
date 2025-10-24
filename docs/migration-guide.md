# データベースマイグレーション実行ガイド

## 概要

Task 1.1で作成したデータモデルをデータベースに適用する手順です。

## 作成されたモデル

### コア広告管理
- **Advertiser** - 広告主
- **Campaign** - キャンペーン（既存モデルを拡張）
- **AdGroup** - 広告グループ
- **Ad** - 広告
- **Creative** - クリエイティブ（動画/画像）
- **Metric** - パフォーマンスメトリクス（既存モデルを拡張）

### 認証・権限
- **OAuthToken** - OAuth認証トークン（既存モデルを拡張）
- **User** - システムユーザー
- **Role** - ロール
- **Permission** - 権限
- **UserRole** - ユーザー ←→ ロール（中間テーブル）
- **RolePermission** - ロール ←→ 権限（中間テーブル）
- **UserAdvertiser** - ユーザー ←→ 広告主（中間テーブル）

### システム・ログ
- **ChangeLog** - 変更履歴・監査ログ
- **Experiment** - A/Bテスト実験
- **WebhookEvent** - Webhook受信イベント
- **APILog** - API呼び出しログ

---

## 前提条件

1. Neon PostgreSQLアカウントが作成されていること
2. `.env`ファイルに`DATABASE_URL`（Neon接続URL）が設定されていること

---

## 実行手順

### 1. Neon PostgreSQL接続確認

`.env`ファイルを開いて、`DATABASE_URL`が設定されていることを確認:

```env
DATABASE_URL=postgresql://neondb_owner:...@ep-xxx.neon.tech/neondb?sslmode=require
```

### 2. マイグレーション実行（推奨: db push）

```bash
cd apps/backend

# Prisma Clientを生成
npx prisma generate

# マイグレーションを適用（開発環境）
npx prisma db push

# または本番環境の場合
npx prisma migrate deploy
```

**db push vs migrate deploy:**
- `db push`: 開発環境向け、スキーマを直接同期
- `migrate deploy`: 本番環境向け、マイグレーション履歴を記録

### 3. Seedデータ投入

マイグレーション完了後、初期データ（Role, Permission, デフォルトユーザー）を投入します。

```bash
cd apps/backend

# Seedスクリプト実行
npx prisma db seed
```

**Seedデータ内容:**
- ロール: ADMIN, OPERATOR, APPROVER, VIEWER
- 権限: 各リソースのCRUD権限（campaign.create, ad.read等）
- デフォルトユーザー: `admin@example.com`（ADMINロール）

### 4. マイグレーション確認

```bash
cd apps/backend

# マイグレーション状態確認
npx prisma migrate status

# Prisma Studioで確認（GUI）
npx prisma studio
```

Prisma Studioが起動したら、ブラウザで http://localhost:5555 にアクセスして、テーブルとデータを確認できます。

---

## トラブルシューティング

### エラー: "Can't reach database server"

**原因:** Neon PostgreSQLに接続できない。

**解決策:**
1. `.env`ファイルの`DATABASE_URL`を確認
2. Neon Dashboard（https://console.neon.tech/）でデータベースが稼働しているか確認
3. インターネット接続を確認
4. `?sslmode=require` パラメータが含まれているか確認

### エラー: "unique constraint" 違反

**原因:** 既存データとの重複。

**解決策:**
1. 開発環境の場合、データベースをリセット:
   ```bash
   cd apps/backend
   npx prisma migrate reset
   ```
   **警告:** すべてのデータが削除されます。

2. 本番環境の場合、マイグレーションSQLを手動で調整。

### エラー: "Prisma schema has been updated"

**原因:** Prisma Clientが古い。

**解決策:**
```bash
cd apps/backend
npx prisma generate
```

---

## 既存データがある場合の注意点

### Campaignテーブルの`advertiserId`変更

既存のCampaignデータがある場合、`advertiserId`のデータ型変更が必要です。

**手順:**
1. 既存のCampaign → Advertiserレコードを作成
2. CampaignのadvertiserIdを新しいAdvertiser.idに更新
3. 外部キー制約を追加

**スクリプト例:**
```sql
-- 1. 既存のadvertiserIdからAdvertiserレコードを作成
INSERT INTO "advertisers" ("id", "tiktokAdvertiserId", "name", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  "advertiserId",
  'Advertiser ' || "advertiserId",
  NOW(),
  NOW()
FROM "campaigns"
WHERE "advertiserId" NOT IN (SELECT "tiktokAdvertiserId" FROM "advertisers")
GROUP BY "advertiserId";

-- 2. CampaignのadvertiserIdを更新
UPDATE "campaigns" c
SET "advertiserId" = a."id"
FROM "advertisers" a
WHERE c."advertiserId" = a."tiktokAdvertiserId";

-- 3. 外部キー制約を追加
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_advertiserId_fkey"
    FOREIGN KEY ("advertiserId") REFERENCES "advertisers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

---

## マイグレーション後の確認項目

### 1. テーブル作成確認

```sql
-- すべてのテーブルを確認
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
```

期待されるテーブル数: 18個

### 2. リレーション確認

```sql
-- 外部キー制約を確認
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
ORDER BY tc.table_name;
```

### 3. インデックス確認

```sql
-- インデックスを確認
SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

### 4. Seedデータ確認

```sql
-- ロールの確認
SELECT * FROM "roles" ORDER BY "name";

-- 権限の確認
SELECT COUNT(*) FROM "permissions";

-- デフォルトユーザーの確認
SELECT u.email, u.name, r.name as role
FROM "users" u
JOIN "user_roles" ur ON u.id = ur."userId"
JOIN "roles" r ON ur."roleId" = r.id
WHERE u.email = 'admin@example.com';
```

---

## ロールバック

マイグレーションに問題がある場合、ロールバックできます。

```bash
cd apps/backend

# 開発環境: データベース全体をリセット
npx prisma migrate reset

# 本番環境: 特定のマイグレーションをロールバック（手動）
# マイグレーションSQLの逆操作を実行する必要があります
```

---

## 次のステップ

マイグレーション完了後、以下のタスクに進みます：

- **Task 1.2**: Creative Management実装
- **Task 1.3**: AdGroup & Ad 作成実装
- **Task 1.4**: キャンペーン自動作成フロー

---

## 参考リンク

- [Prisma Migrate ドキュメント](https://www.prisma.io/docs/concepts/components/prisma-migrate)
- [ERD設計書](./erd-design.md)
- [Prismaスキーマ](../apps/backend/prisma/schema.prisma)
