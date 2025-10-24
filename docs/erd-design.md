# TikTok広告運用自動化システム - ERD設計

## エンティティ一覧

### コア広告管理
1. **Advertiser** - 広告主（TikTok Advertiser Account）
2. **Campaign** - キャンペーン
3. **AdGroup** - 広告グループ
4. **Ad** - 広告
5. **Creative** - クリエイティブ（動画/画像）

### 認証・権限
6. **OAuthToken** - OAuth認証トークン
7. **User** - システムユーザー
8. **Role** - ロール（権限グループ）
9. **Permission** - 権限

### レポート・分析
10. **Metric** - パフォーマンスメトリクス
11. **Experiment** - A/Bテスト実験

### システム・ログ
12. **ChangeLog** - 変更履歴・監査ログ
13. **WebhookEvent** - Webhook受信イベント
14. **APILog** - API呼び出しログ

---

## エンティティ詳細とリレーション

### 1. Advertiser（広告主）
TikTok Advertiser Accountを表す。

| フィールド | 型 | 説明 |
|-----------|-----|------|
| id | UUID | Primary Key |
| tiktokAdvertiserId | String | TikTok Advertiser ID (Unique) |
| name | String | 広告主名 |
| timezone | String | タイムゾーン |
| currency | String | 通貨コード (USD, JPY等) |
| status | String | ステータス (ACTIVE, INACTIVE) |
| createdAt | DateTime | 作成日時 |
| updatedAt | DateTime | 更新日時 |

**リレーション:**
- 1:N → OAuthToken
- 1:N → Campaign
- 1:N → Creative
- N:M → User (ユーザーは複数の広告主にアクセス可能)

---

### 2. Campaign（キャンペーン）
既存モデルを拡張。

| フィールド | 型 | 説明 |
|-----------|-----|------|
| id | UUID | Primary Key |
| tiktokId | String | TikTok campaign_id (Unique) |
| advertiserId | UUID | FK: Advertiser |
| name | String | キャンペーン名 |
| objectiveType | String | 目的 (CONVERSIONS, APP_PROMOTION等) |
| budgetMode | String | 予算モード (BUDGET_MODE_DAY, BUDGET_MODE_TOTAL) |
| budget | Float | 予算 |
| status | String | ステータス (ENABLE, DISABLE, DELETE) |
| createdAt | DateTime | 作成日時 |
| updatedAt | DateTime | 更新日時 |

**リレーション:**
- N:1 → Advertiser
- 1:N → AdGroup
- 1:N → Metric

---

### 3. AdGroup（広告グループ）
キャンペーン配下の広告グループ。

| フィールド | 型 | 説明 |
|-----------|-----|------|
| id | UUID | Primary Key |
| tiktokId | String | TikTok adgroup_id (Unique) |
| campaignId | UUID | FK: Campaign |
| name | String | 広告グループ名 |
| placementType | String | 配置タイプ (PLACEMENT_TYPE_AUTOMATIC等) |
| budgetMode | String | 予算モード |
| budget | Float | 予算 |
| bidType | String | 入札タイプ (BID_TYPE_CUSTOM, BID_TYPE_NO_BID) |
| bidPrice | Float | 入札価格 |
| targeting | Json | ターゲティング設定（JSON） |
| schedule | Json | スケジュール設定（JSON） |
| status | String | ステータス |
| createdAt | DateTime | 作成日時 |
| updatedAt | DateTime | 更新日時 |

**リレーション:**
- N:1 → Campaign
- 1:N → Ad
- 1:N → Metric

---

### 4. Ad（広告）
広告グループ配下の個別広告。

| フィールド | 型 | 説明 |
|-----------|-----|------|
| id | UUID | Primary Key |
| tiktokId | String | TikTok ad_id (Unique) |
| adgroupId | UUID | FK: AdGroup |
| name | String | 広告名 |
| creativeId | UUID | FK: Creative |
| adText | String | 広告テキスト |
| callToAction | String | CTA (LEARN_MORE, DOWNLOAD等) |
| landingPageUrl | String | ランディングページURL |
| displayName | String | 表示名 |
| status | String | ステータス |
| reviewStatus | String | 審査ステータス (APPROVED, REJECTED等) |
| reviewMessage | String | 審査メッセージ |
| createdAt | DateTime | 作成日時 |
| updatedAt | DateTime | 更新日時 |

**リレーション:**
- N:1 → AdGroup
- N:1 → Creative
- 1:N → Metric

---

### 5. Creative（クリエイティブ）
動画・画像などのクリエイティブアセット。

| フィールド | 型 | 説明 |
|-----------|-----|------|
| id | UUID | Primary Key |
| advertiserId | UUID | FK: Advertiser |
| tiktokVideoId | String | TikTok video_id (Nullable) |
| tiktokImageId | String | TikTok image_id (Nullable) |
| type | String | タイプ (VIDEO, IMAGE) |
| url | String | アセットURL（S3/GCS） |
| thumbnailUrl | String | サムネイルURL |
| filename | String | ファイル名 |
| fileSize | Int | ファイルサイズ (bytes) |
| duration | Int | 動画の長さ (秒、動画の場合) |
| width | Int | 幅 (px) |
| height | Int | 高さ (px) |
| aspectRatio | String | アスペクト比 (9:16, 1:1, 16:9) |
| metadata | Json | メタデータ（JSON） |
| status | String | ステータス (PROCESSING, COMPLETED, FAILED) |
| createdAt | DateTime | 作成日時 |
| updatedAt | DateTime | 更新日時 |

**リレーション:**
- N:1 → Advertiser
- 1:N → Ad

---

### 6. OAuthToken（OAuth認証トークン）
既存モデル - Advertiser参照を追加。

| フィールド | 型 | 説明 |
|-----------|-----|------|
| id | UUID | Primary Key |
| advertiserId | String | TikTok Advertiser ID (Unique) |
| accessToken | Text | アクセストークン |
| refreshToken | Text | リフレッシュトークン |
| expiresAt | DateTime | 有効期限 |
| scope | String | スコープ |
| createdAt | DateTime | 作成日時 |
| updatedAt | DateTime | 更新日時 |

**リレーション:**
- N:1 → Advertiser (tiktokAdvertiserIdで参照)

---

### 7. User（システムユーザー）
システムにログインするユーザー。

| フィールド | 型 | 説明 |
|-----------|-----|------|
| id | UUID | Primary Key |
| email | String | メールアドレス (Unique) |
| name | String | 名前 |
| passwordHash | String | パスワードハッシュ (Nullable) |
| status | String | ステータス (ACTIVE, INACTIVE) |
| lastLoginAt | DateTime | 最終ログイン日時 |
| createdAt | DateTime | 作成日時 |
| updatedAt | DateTime | 更新日時 |

**リレーション:**
- N:M → Role (UserRole経由)
- N:M → Advertiser (UserAdvertiser経由)

---

### 8. Role（ロール）
権限グループ。

| フィールド | 型 | 説明 |
|-----------|-----|------|
| id | UUID | Primary Key |
| name | String | ロール名 (Unique: ADMIN, OPERATOR, VIEWER等) |
| description | String | 説明 |
| createdAt | DateTime | 作成日時 |
| updatedAt | DateTime | 更新日時 |

**リレーション:**
- N:M → User (UserRole経由)
- N:M → Permission (RolePermission経由)

---

### 9. Permission（権限）
個別の権限。

| フィールド | 型 | 説明 |
|-----------|-----|------|
| id | UUID | Primary Key |
| name | String | 権限名 (Unique: campaign.create, campaign.update等) |
| resource | String | リソース (campaign, adgroup, ad等) |
| action | String | アクション (create, read, update, delete) |
| description | String | 説明 |
| createdAt | DateTime | 作成日時 |

**リレーション:**
- N:M → Role (RolePermission経由)

---

### 10. Metric（パフォーマンスメトリクス）
既存モデルを拡張 - AdGroup, Ad用のメトリクスも保存。

| フィールド | 型 | 説明 |
|-----------|-----|------|
| id | UUID | Primary Key |
| entityType | String | エンティティタイプ (CAMPAIGN, ADGROUP, AD) |
| campaignId | UUID | FK: Campaign (Nullable) |
| adgroupId | UUID | FK: AdGroup (Nullable) |
| adId | UUID | FK: Ad (Nullable) |
| statDate | DateTime | 統計日付 |
| impressions | Int | インプレッション数 |
| clicks | Int | クリック数 |
| spend | Float | 広告費 |
| conversions | Int | コンバージョン数 |
| ctr | Float | CTR (%) |
| cpc | Float | CPC |
| cpm | Float | CPM |
| cpa | Float | CPA |
| videoViews | Int | 動画視聴数 |
| videoWatched2s | Int | 2秒視聴数 |
| videoWatched6s | Int | 6秒視聴数 |
| createdAt | DateTime | 作成日時 |

**リレーション:**
- N:1 → Campaign (Nullable)
- N:1 → AdGroup (Nullable)
- N:1 → Ad (Nullable)

**Unique制約:**
- (entityType, campaignId, statDate) for CAMPAIGN
- (entityType, adgroupId, statDate) for ADGROUP
- (entityType, adId, statDate) for AD

---

### 11. Experiment（A/Bテスト実験）
実験フレームワーク用。

| フィールド | 型 | 説明 |
|-----------|-----|------|
| id | UUID | Primary Key |
| advertiserId | UUID | FK: Advertiser |
| name | String | 実験名 |
| hypothesis | String | 仮説 |
| experimentType | String | タイプ (AB_TEST, MAB) |
| status | String | ステータス (DRAFT, RUNNING, COMPLETED) |
| startDate | DateTime | 開始日 |
| endDate | DateTime | 終了日 |
| config | Json | 実験設定（JSON） |
| result | Json | 実験結果（JSON） |
| winner | String | 勝者Arm |
| createdBy | UUID | FK: User |
| createdAt | DateTime | 作成日時 |
| updatedAt | DateTime | 更新日時 |

**リレーション:**
- N:1 → Advertiser
- N:1 → User (createdBy)

---

### 12. ChangeLog（変更履歴・監査ログ）
すべての変更操作を記録。

| フィールド | 型 | 説明 |
|-----------|-----|------|
| id | UUID | Primary Key |
| entityType | String | エンティティタイプ (CAMPAIGN, ADGROUP, AD等) |
| entityId | String | エンティティID |
| action | String | アクション (CREATE, UPDATE, DELETE) |
| userId | UUID | FK: User (Nullable) |
| source | String | ソース (MANUAL, AUTOMATION, API) |
| beforeData | Json | 変更前データ（JSON） |
| afterData | Json | 変更後データ（JSON） |
| reason | String | 変更理由 |
| createdAt | DateTime | 作成日時 |

**リレーション:**
- N:1 → User (Nullable)

**インデックス:**
- (entityType, entityId)
- (userId)
- (createdAt)

---

### 13. WebhookEvent（Webhook受信イベント）
TikTokからのWebhook受信記録。

| フィールド | 型 | 説明 |
|-----------|-----|------|
| id | UUID | Primary Key |
| eventId | String | イベントID (Unique - Idempotency用) |
| eventType | String | イベントタイプ (lead.create, ad.review_status_update等) |
| payload | Json | ペイロード（JSON） |
| signature | String | 署名 |
| processed | Boolean | 処理済みフラグ |
| processedAt | DateTime | 処理日時 |
| error | String | エラーメッセージ (Nullable) |
| createdAt | DateTime | 作成日時 |

**インデックス:**
- (eventId) - Unique
- (eventType)
- (processed)

---

### 14. APILog（API呼び出しログ）
TikTok API呼び出しの詳細ログ。

| フィールド | 型 | 説明 |
|-----------|-----|------|
| id | UUID | Primary Key |
| endpoint | String | エンドポイント (/v1.3/campaign/create/等) |
| method | String | HTTPメソッド (GET, POST等) |
| requestBody | Json | リクエストボディ（JSON） |
| responseStatus | Int | HTTPステータスコード |
| responseBody | Json | レスポンスボディ（JSON） |
| duration | Int | 実行時間 (ms) |
| advertiserId | UUID | FK: Advertiser (Nullable) |
| userId | UUID | FK: User (Nullable) |
| error | String | エラーメッセージ (Nullable) |
| createdAt | DateTime | 作成日時 |

**インデックス:**
- (endpoint)
- (responseStatus)
- (createdAt)

---

## 中間テーブル（N:M リレーション）

### UserRole（ユーザー ← → ロール）
| フィールド | 型 | 説明 |
|-----------|-----|------|
| userId | UUID | FK: User |
| roleId | UUID | FK: Role |
| assignedAt | DateTime | 割り当て日時 |

**Primary Key:** (userId, roleId)

---

### RolePermission（ロール ← → 権限）
| フィールド | 型 | 説明 |
|-----------|-----|------|
| roleId | UUID | FK: Role |
| permissionId | UUID | FK: Permission |
| assignedAt | DateTime | 割り当て日時 |

**Primary Key:** (roleId, permissionId)

---

### UserAdvertiser（ユーザー ← → 広告主）
| フィールド | 型 | 説明 |
|-----------|-----|------|
| userId | UUID | FK: User |
| advertiserId | UUID | FK: Advertiser |
| assignedAt | DateTime | 割り当て日時 |

**Primary Key:** (userId, advertiserId)

---

## ERD図（テキスト表現）

```
                                    ┌──────────────┐
                                    │   User       │
                                    │--------------│
                                    │ id (PK)      │
                                    │ email        │
                                    │ name         │
                                    └──────┬───────┘
                                           │
                         ┌─────────────────┼─────────────────┐
                         │                 │                 │
                    ┌────▼────┐      ┌────▼────┐      ┌────▼──────┐
                    │UserRole │      │ChangeLog│      │Experiment │
                    └────┬────┘      └─────────┘      └───────────┘
                         │
                    ┌────▼────┐
                    │  Role   │
                    └────┬────┘
                         │
                  ┌──────▼─────────┐
                  │ RolePermission │
                  └──────┬─────────┘
                         │
                    ┌────▼────────┐
                    │ Permission  │
                    └─────────────┘

┌────────────┐        ┌─────────────┐
│OAuthToken  │◄───────│ Advertiser  │
└────────────┘        │-------------│
                      │ id (PK)     │
                      │ tiktokId    │
                      └──────┬──────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
         ┌────▼────┐    ┌───▼────┐    ┌───▼────────┐
         │Campaign │    │Creative│    │Experiment  │
         │---------│    └────┬───┘    └────────────┘
         │ id (PK) │         │
         │tiktokId │         │
         └────┬────┘         │
              │              │
         ┌────▼────┐         │
         │AdGroup  │         │
         │---------│         │
         │ id (PK) │         │
         │tiktokId │         │
         └────┬────┘         │
              │              │
         ┌────▼────┐         │
         │   Ad    │◄────────┘
         │---------│
         │ id (PK) │
         │tiktokId │
         │creativeId│
         └────┬────┘
              │
         ┌────▼────┐
         │ Metric  │
         │---------│
         │entityType│
         │campaignId│
         │adgroupId │
         │adId      │
         └─────────┘

┌──────────────┐        ┌─────────────┐
│WebhookEvent  │        │   APILog    │
└──────────────┘        └─────────────┘
```

---

## インデックス戦略

### パフォーマンス最適化用インデックス

1. **Metric テーブル**
   - `(entityType, campaignId, statDate)` - Campaign別レポート
   - `(entityType, adgroupId, statDate)` - AdGroup別レポート
   - `(entityType, adId, statDate)` - Ad別レポート
   - `(statDate)` - 日付範囲検索

2. **ChangeLog テーブル**
   - `(entityType, entityId)` - エンティティ別履歴
   - `(userId)` - ユーザー別操作履歴
   - `(createdAt)` - 時系列検索

3. **APILog テーブル**
   - `(endpoint)` - エンドポイント別分析
   - `(responseStatus)` - エラー分析
   - `(createdAt)` - 時系列検索

4. **WebhookEvent テーブル**
   - `(eventId)` - Unique、Idempotency
   - `(eventType)` - イベントタイプ別検索
   - `(processed)` - 未処理イベント検索

---

## マイグレーション順序

1. **Phase 1: コアエンティティ**
   - Advertiser
   - AdGroup
   - Ad
   - Creative

2. **Phase 2: 認証・権限**
   - User
   - Role
   - Permission
   - 中間テーブル (UserRole, RolePermission, UserAdvertiser)

3. **Phase 3: 拡張機能**
   - Metric拡張 (AdGroup, Ad対応)
   - ChangeLog
   - Experiment

4. **Phase 4: 統合機能**
   - WebhookEvent
   - APILog

---

## データ整合性ルール

### Foreign Key制約
- すべての外部キーに制約を設定
- 削除時の動作:
  - Advertiser削除 → Cascade (Campaign, Creative等)
  - Campaign削除 → Cascade (AdGroup, Metric)
  - AdGroup削除 → Cascade (Ad, Metric)
  - Ad削除 → Cascade (Metric)
  - Creative削除 → Restrict (使用中のAd確認)
  - User削除 → Set NULL (ChangeLog等の履歴は残す)

### Unique制約
- tiktokId系フィールド（Campaign, AdGroup, Ad, Creative）
- email (User)
- eventId (WebhookEvent)
- name (Role, Permission)

---

## 備考

このERD設計は以下のフェーズで段階的に実装します：
- **Phase 1 (MVP)**: Advertiser, AdGroup, Ad, Creative, User, Role, Permission, ChangeLog
- **Phase 2 (機能拡張)**: Experiment, WebhookEvent
- **Phase 3 (最適化)**: APILog拡張、パフォーマンス最適化
