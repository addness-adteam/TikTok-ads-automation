# Smart+広告 クロスアカウント横展開機能 要件定義書

## 1. 概要

### 背景
- 現在成果が出ている広告（AIまとめ、SNSまとめ、ClaudeCode解説等）はほぼ全てSmart+広告
- Smart+広告は1広告に複数動画（3〜20本）を含み、TikTokが自動で最適な組み合わせを配信
- TikTokの`video_id`はアカウント（advertiser_id）に紐づくため、別アカウントでは再アップロードが必要
- 現在のシステムにはSmart+の作成API（campaign/adgroup/ad create）が未実装
- LP URLの`ftid`パラメータはUTAGEで登録経路を作成して取得する必要がある

### ゴール
あるアカウントで成果が出ているSmart+広告を、別のアカウントにワンコマンドで横展開できるようにする。
UTAGE登録経路の自動生成→動画再アップロード→Smart+広告作成までを一気通貫で実行。

## 2. 機能要件

### 2.1 Smart+広告の完全データ取得

**入力**: 元アカウントのadvertiser_id + smart_plus_ad_id（横展開元の広告ID）

**取得する情報**:
| データ | 取得元 | 用途 |
|--------|--------|------|
| ad_name | `smart_plus/ad/get` | 広告名（日付部分を更新して再利用） |
| creative_list | `smart_plus/ad/get` | 動画一覧 |
| ad_text_list | `smart_plus/ad/get` | 広告文テンプレート |
| landing_page_url_list | `smart_plus/ad/get` | LP URL構造の参考 |
| ad_configuration | `smart_plus/ad/get` | 設定の引き継ぎ |
| 各動画のvideo_id | **下記の方法で取得** | 動画ダウンロード用 |

#### video_id取得の問題と解決策

**問題**: `smart_plus/ad/get`のcreative_list内のvideo_idがN/Aで返ってくることを確認済み。

**解決策（優先順に試行）**:
1. **creative_list内の`video_info.video_id`を確認** — ネスト構造が異なる可能性あり。実装時にcreative_listの完全JSONをログ出力して構造を特定する
2. **`/v1.3/ad/get/`（通常のad取得API）を使用** — entity syncはこのAPIでSmart+広告のvideo_idを取得してCreativeテーブルに保存している実績あり
3. **DBのCreativeテーブルから取得** — `tiktokVideoId`フィールドに保存済みの動画IDを利用（最も確実）
4. **`/v1.3/smart_plus/material_report/overview/`** — `main_material_id`フィールドにvideo_idが含まれる可能性

**実装方針**: まず方法1を試し、ダメなら方法2/3にフォールバック。実装前の最初のタスクとして、各APIのレスポンス構造を1回ずつ確認するスクリプトを作成する。

### 2.2 動画のダウンロード＆再アップロード

**フロー**:
```
1. video_idを取得（2.1の方法で）

2. /v1.3/file/video/ad/info/ で動画のメタ情報を取得
   → preview_url または video_url フィールドで動画ファイルのURLを取得
   ※ poster_url はサムネイル画像なので注意
   ※ URLが取れない場合: 元動画ファイルの所在確認が必要（後述）

3. 動画ファイルをダウンロード（Bufferに保持）
   → 複数アカウントへの横展開時はダウンロードは1回だけ、Bufferを使い回す

4. /v1.3/file/video/ad/upload/ で横展開先アカウントに動画をアップロード
   → 新しいvideo_idが発行される

5. /v1.3/file/video/ad/info/ で新動画の処理完了を待つ（サムネイル生成含む）
   → 最大5回リトライ、3秒×1.5倍の指数バックオフ
   → 既存のcreative.service.tsのリトライロジックを参考

6. video_idのマッピングテーブルを作成
   { 元video_id → 新video_id }
```

**動画ダウンロードの代替手段（video_urlが取得できない場合）**:
- TikTok APIで動画ファイル自体のダウンロードURLが提供されない可能性あり
- その場合の代替策:
  1. DBのCreativeテーブルの`url`フィールド（Vercel Blob URL）から取得
  2. ただし現在ほとんどのCreativeはurl=video_idで、実ファイルURLではない
  3. **最終手段**: 動画ファイルを手動で指定できるオプションを用意

**注意事項**:
- TikTok APIのレート制限: 1秒あたり10リクエスト程度。リクエスト間に100msのウェイトを入れる
- 動画アップロードは時間がかかる（1本あたり5〜30秒）
- 20本のまとめ広告の場合、アップロードだけで数分かかる想定
- アップロード失敗時のリトライ（3回、指数バックオフ: 1s→2s→4s）

### 2.3 UTAGE登録経路の自動生成

Meta広告自動化で実現済みのUTAGE登録経路自動生成をTikTok広告版として実装する。

#### フロー

```
Step 1: UTAGEにログイン（セッション取得）
  GET  /operator/login → CSRFトークン取得
  POST /operator/login → { _token, email, password } → セッションCookie取得
  ※ セッション切れは302リダイレクトで検知し、自動再ログイン

Step 2: 最新のCR番号を取得
  GET /funnel/{funnelId}/tracking → HTMLパース
  → "TikTok広告-{訴求}-{LP名}-CR{5桁番号}" のパターンでマッチ
  → 最大のCR番号を返す

Step 3: 新しい登録経路を作成
  GET  /funnel/{funnelId}/tracking/create → CSRFトークン取得
  POST /funnel/{funnelId}/tracking → {
    _token: csrfToken,
    name: "TikTok広告-{訴求}-{LP名}-CR{新番号}",
    group_id: "{groupId}",
    step_id: "{stepId}"
  }
  GET /funnel/{funnelId}/tracking → 作成された経路を探索
  → 遷移先URL取得: https://school.addness.co.jp/p/{stepId}?ftid={trackingId}
```

#### 命名規則
```
TikTok広告-{訴求名}-{LP名}-CR{5桁連番}
例: TikTok広告-AI-LP1-CR01235
例: TikTok広告-SNS-LP2-CR00048
例: TikTok広告-スキルプラス-LP2-CR00501
```

#### ファネル設定マッピング

訴求×LP番号ごとにUTAGEのファネル情報が必要:

```typescript
interface FunnelConfig {
  funnelId: string;   // UTAGEのファネルID
  groupId: string;    // グループID
  stepId: string;     // ステップID（LP先）
}

// 訴求×LP → FunnelConfig のマッピング
const TIKTOK_FUNNEL_MAP: Record<string, FunnelConfig> = {
  'AI-LP1': { funnelId: '要確認', groupId: '要確認', stepId: '要確認' },
  'AI-LP2': { funnelId: '要確認', groupId: '要確認', stepId: '要確認' },
  'SNS-LP1': { funnelId: '要確認', groupId: '要確認', stepId: '要確認' },
  'SNS-LP2': { funnelId: '要確認', groupId: '要確認', stepId: '要確認' },
  'スキルプラス-LP2': { funnelId: '要確認', groupId: '要確認', stepId: '要確認' },
  // ... 追加分はUTAGE管理画面で確認して埋める
};
```

※ Meta広告自動化の`FUNNEL_MAP_FALLBACK`と同様に、ハードコード + UTAGEから動的検出のハイブリッド。
※ 実装時にMeta広告自動化の`meta-ads-automation/lib/utage-api.ts`の`createRegistrationPathAndGetUrl()`を参考にする。

#### 環境変数・定数
```
# apps/backend/.env に設定済み
UTAGE_EMAIL=（設定済み）
UTAGE_PASSWORD=（設定済み）

# ハードコード定数（Meta側と共通）
OPERATOR_LOGIN_URL = 'https://school.addness.co.jp/operator/GYbKT7Y9d0eR/login'
UTAGE_BASE_URL = 'https://school.addness.co.jp'
```

#### LP番号の決定ルール

横展開時のLP番号は**元広告のad_nameから抽出したLP番号をそのまま使う**。
- 元広告名: `260304/AI/AIまとめ/LP1-CR01002` → LP番号 = 1
- 横展開先でも同じLP1を使用
- UTAGE登録経路: `TikTok広告-AI-LP1-CR{新番号}`

#### 依存パッケージ

UTAGEのHTMLパースに`cheerio`が必要（インストール済み）:
```
npm install cheerio
```

#### Smart+広告は複数動画だがCR番号は1つ

Smart+広告1つ（例: 5本の動画入り）に対してUTAGE登録経路は**1つだけ**作成する。
→ 動画ごとではなく、広告ごとにCR番号を1つ発番。

### 2.4 Smart+キャンペーン作成

**API**: `POST /v1.3/smart_plus/campaign/create/`

**リクエストボディ**:
```json
{
  "advertiser_id": "横展開先のadvertiser_id",
  "campaign_name": "YYMMDD/制作者名/CR名/LP名-CR{5桁番号}",
  "objective_type": "LEAD_GENERATION",
  "budget_mode": "BUDGET_MODE_INFINITE",
  "budget_optimize_on": false,
  "request_id": "uuid-v4"
}
```

**注意**:
- `budget_optimize_on: false` — CBO（Campaign Budget Optimization）は使わない。予算は広告グループレベルで設定する方針
- `request_id` — 冪等性のためUUID v4を毎回生成
- エンドポイントは `/v1.3/smart_plus/campaign/create/` と `/v1.3/ad/smart_plus_create/` の2つがSDK上に存在。実装前に正確なパスを確認する

**レスポンス**: `campaign_id`

### 2.5 Smart+広告グループ作成

**API**: `POST /v1.3/smart_plus/adgroup/create/`

**リクエストボディ**:
```json
{
  "advertiser_id": "横展開先のadvertiser_id",
  "campaign_id": "上で作成したcampaign_id",
  "adgroup_name": "YYMMDD ノンタゲ",
  "budget_mode": "BUDGET_MODE_DYNAMIC_DAILY_BUDGET",
  "budget": 3000,
  "billing_event": "元広告のad_configurationから引き継ぎ",
  "optimization_goal": "CONVERT",
  "optimization_event": "ON_WEB_REGISTER",
  "pixel_id": "アカウントのピクセルID",
  "schedule_start_time": "配信開始時刻（JSTで15時前なら即日、以降なら翌日0時）",
  "schedule_type": "SCHEDULE_FROM_NOW",
  "targeting_spec": {
    "location_ids": ["1861060"],
    "age_groups": ["AGE_18_24", "AGE_25_34", "AGE_35_44", "AGE_45_54", "AGE_55_100"],
    "gender": "GENDER_UNLIMITED",
    "languages": ["ja"]
  },
  "promotion_type": "WEBSITE",
  "request_id": "uuid-v4"
}
```

**デフォルト日予算**:
| 導線 | デフォルト予算 |
|------|-------------|
| AI | ¥3,000 |
| SNS | ¥3,000 |
| スキルプラス | ¥5,000 |

### 2.6 Smart+広告作成

**API**: `POST /v1.3/smart_plus/ad/create/` （正確なパスは実装時確認）

**リクエストボディ**:
```json
{
  "advertiser_id": "横展開先のadvertiser_id",
  "adgroup_id": "上で作成したadgroup_id",
  "ad_name": "YYMMDD/制作者名/CR名/LP名-CR{5桁番号}",
  "creative_list": [
    {
      "creative_info": {
        "ad_format": "SINGLE_VIDEO",
        "video_info": { "video_id": "新video_id_1" },
        "identity_id": "アカウントのidentity_id",
        "identity_type": "TT_USER"
      }
    },
    {
      "creative_info": {
        "ad_format": "SINGLE_VIDEO",
        "video_info": { "video_id": "新video_id_2" },
        "identity_id": "アカウントのidentity_id",
        "identity_type": "TT_USER"
      }
    }
  ],
  "ad_text_list": [
    { "ad_text": "元広告と同じ広告文" }
  ],
  "landing_page_url_list": [
    {
      "landing_page_url": "https://school.addness.co.jp/p/{stepId}?ftid={trackingId}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid"
    }
  ],
  "operation_status": "ENABLE"
}
```

## 3. 実装設計

### 3.1 新規モジュール構成

```
apps/backend/src/
  smart-plus-deploy/
    smart-plus-deploy.module.ts
    smart-plus-deploy.service.ts      # メインオーケストレーション
    smart-plus-deploy.controller.ts   # APIエンドポイント
    types.ts                          # 型定義
  utage/
    utage.module.ts
    utage.service.ts                  # UTAGE認証・登録経路作成
    utage.types.ts                    # ファネルマッピング等
```

### 3.2 TikTokServiceへの追加メソッド

```typescript
// 動画情報取得（ダウンロードURL含む）
async getVideoInfo(advertiserId: string, accessToken: string, videoIds: string[]): Promise<VideoInfo[]>

// 動画ダウンロード（URLからBufferへ）
async downloadVideo(videoUrl: string): Promise<Buffer>

// Smart+キャンペーン作成
async createSmartPlusCampaign(advertiserId: string, accessToken: string, params: SmartPlusCampaignCreateParams): Promise<string>

// Smart+広告グループ作成
async createSmartPlusAdGroup(advertiserId: string, accessToken: string, params: SmartPlusAdGroupCreateParams): Promise<string>

// Smart+広告作成
async createSmartPlusAd(advertiserId: string, accessToken: string, params: SmartPlusAdCreateParams): Promise<string>
```

### 3.3 UtageServiceのメソッド

```typescript
// セッション管理
async login(): Promise<void>
async ensureSession(): Promise<void>  // セッション切れ自動検知＆再ログイン

// CR番号管理
async getLatestCrNumber(appeal: string, lpName: string): Promise<number>

// 登録経路作成
async createRegistrationPath(appeal: string, lpName: string, crNumber: number): Promise<{
  registrationPath: string;    // "TikTok広告-AI-LP1-CR01235"
  destinationUrl: string;      // "https://school.addness.co.jp/p/xxx?ftid=yyy"
  crNumber: number;            // 1235
}>
```

### 3.4 SmartPlusDeployServiceのメインメソッド

```typescript
async crossDeploy(input: {
  sourceAdvertiserId: string;     // 元アカウント
  sourceSmartPlusAdId: string;    // 元広告ID
  targetAdvertiserIds: string[];  // 横展開先アカウント（複数可）
  adNameOverride?: string;        // 広告名を上書きする場合
  dailyBudget?: number;           // 日予算（デフォルト: 導線別）
}): Promise<CrossDeployResult[]>
```

※ `landingPageUrl`はUTAGEで自動生成するためインプット不要。

### 3.5 APIエンドポイント

```
POST /api/smart-plus-deploy/cross-deploy
Body: {
  sourceAdvertiserId: string,
  sourceSmartPlusAdId: string,
  targetAdvertiserIds: string[],
  dailyBudget?: number
}

GET /api/smart-plus-deploy/preview
Query: sourceAdvertiserId, sourceSmartPlusAdId
→ 横展開前のプレビュー（動画数、広告文、LP等を表示）

POST /api/smart-plus-deploy/dry-run
Body: （cross-deployと同じ）
→ 動画アップロードまで実行するが、campaign/ad作成はスキップ
→ 「何が作られるか」のバリデーション用
```

## 4. 処理フロー（シーケンス）

```
1. [preview] 元Smart+広告の完全データを取得
   ├── smart_plus/ad/get で広告情報取得
   ├── creative_listからvideo_id一覧を抽出（2.1の解決策で）
   ├── file/video/ad/info で各動画のメタ情報取得
   └── 結果を返却（動画数、広告文、LP、設定情報）

2. [cross-deploy]
   ├── 2a. 全動画をダウンロード（Bufferに保持。1回だけ）
   │
   ├── 2b. 横展開先アカウントごとに以下を実行:
   │   ├── i.   全動画を横展開先にアップロード（新video_id取得）
   │   │        └── アップロード完了を待機（リトライ付き）
   │   ├── ii.  UTAGE登録経路を作成（UtageService経由）
   │   │        ├── 最新CR番号を取得
   │   │        ├── 新規登録経路を作成
   │   │        └── ftid付きURLを取得
   │   ├── iii. Smart+キャンペーン作成
   │   ├── iv.  Smart+広告グループ作成（予算=導線別デフォルトorオーバーライド）
   │   ├── v.   Smart+広告作成（新video_id + UTAGE URL）
   │   ├── vi.  DBにCampaign/AdGroup/Adレコード保存
   │   ├── vii. ChangeLogに記録
   │   └── viii.成功/失敗ステータスを記録
   │
   └── 2c. Entity Syncを1回実行（横展開先アカウント分のみ）
           → DB同期を確認し、予算最適化V2が正しく拾えるようにする

3. [結果] 各アカウントの作成結果を返却
   ├── 成功: campaign_id, adgroup_id, smart_plus_ad_id, utage_path, destination_url
   └── 失敗: エラー内容とどのステップで失敗したか
```

## 5. アカウント別の設定情報

### アクセストークン
| アカウント | トークン |
|-----------|---------|
| AI_1, AI_2, AI_3, SP1, SNS1, SNS2, SNS3 | `fe895508...`（DB: OAuthTokenテーブルから取得） |
| AI_4, SP2 | `2092744b...`（DB: OAuthTokenテーブルから取得） |

※ 実装時はDBのOAuthTokenテーブルからadvertiser_idをキーに自動取得する。ハードコードしない。

### アカウント別設定（初回実行前にTikTok APIから取得してDBに保存）

| アカウント | 導線 | pixel_id | identity_id | LP URL | 広告文 | デフォルト日予算 |
|-----------|------|----------|-------------|--------|-------|---------------|
| AI_1 | AI | 要取得 | 要取得 | school.addness.co.jp/p/r2RHcL0PdGIY | AI活用術テキスト | ¥3,000 |
| AI_2 | AI | 要取得 | 要取得 | 同上 | 同上 | ¥3,000 |
| AI_3 | AI | 要取得 | 要取得 | 同上 | 同上 | ¥3,000 |
| AI_4 | AI | 要取得 | 要取得 | 同上 | 同上 | ¥3,000 |
| SP1 | セミナー | 要取得 | 要取得 | 要確認 | 要確認 | ¥5,000 |
| SP2 | セミナー | 要取得 | 要取得 | 要確認 | 要確認 | ¥5,000 |
| SNS1 | SNS | 要取得 | 要取得 | school.addness.co.jp/p/AhTvtpaeXyj6 | SNSマーケテキスト | ¥3,000 |
| SNS2 | SNS | 要取得 | 要取得 | 同上 | 同上 | ¥3,000 |
| SNS3 | SNS | 要取得 | 要取得 | 同上 | 同上 | ¥3,000 |

**pixel_id/identity_idの取得方法**:
既存の稼働中広告から`/v1.3/ad/get/`で取得し、Advertiserテーブルに新カラムとして保存。
初回セットアップスクリプトで一括取得する。

### UTAGEファネルマッピング（確定値）

TikTok広告用のファネルはMeta広告用とは別IDで管理されている。

```typescript
const TIKTOK_FUNNEL_DEFINITIONS = [
  { funnelId: 'a09j9jop95LF', appeal: 'AI' },
  { funnelId: 'dZNDzwCgHNBC', appeal: 'SNS' },
  { funnelId: '3lS3x3dXa6kc', appeal: 'スキルプラス' },  // セミナー導線
  { funnelId: 'EYHSSYtextak', appeal: 'スキルプラス' },  // LP1
];

const TIKTOK_FUNNEL_MAP: Record<string, Record<number, { funnelId: string; groupId: string; stepId: string }>> = {
  'AI': {
    1: { funnelId: 'a09j9jop95LF', groupId: 'EFnsGw3gAdba', stepId: 'r2RHcL0PdGIY' },  // LP1 メイン用
    2: { funnelId: 'a09j9jop95LF', groupId: 'bvnhWMTjQAPU', stepId: 'EnFeDysozIui' },  // LP1 サブ → group=オプト2
    3: { funnelId: 'a09j9jop95LF', groupId: 'EZL6dqvMuop6', stepId: 'A65xiRBl9HCD' },  // LP3 AI4専用
    4: { funnelId: 'a09j9jop95LF', groupId: 'hEwR9BcvprDu', stepId: 'T8RHcXJVzGtY' },  // LP4
    5: { funnelId: 'a09j9jop95LF', groupId: 'ND7cXzKmeiqG', stepId: 'EIQBI7HAVxgd' },  // LP5
    6: { funnelId: 'a09j9jop95LF', groupId: 'FNFK0iB3rIzl', stepId: 'U8Ba9qy5m0us' },  // LP6
  },
  'SNS': {
    1: { funnelId: 'dZNDzwCgHNBC', groupId: '32FwkcHtFSuj', stepId: 'wZhilaQY1Huv' },  // LP1 メイン用
    2: { funnelId: 'dZNDzwCgHNBC', groupId: 'dLrB2E7U7tq8', stepId: 'AhTvtpaeXyj6' },  // LP2 サブ
    3: { funnelId: 'dZNDzwCgHNBC', groupId: 'L9JO3krgnNYD', stepId: '5UKZIXOKSyV4' },  // LP3 TTO専用
  },
  'スキルプラス': {
    // セミナー導線（オートウェビナー）
    2: { funnelId: '3lS3x3dXa6kc', groupId: 'sOiiROJBAVIu', stepId: 'doc7hffUAVTv' },  // LP2 セミナー導線
  },
};
```

※ groupId→stepIdの対応はLP番号ベースで推定（オプト1=LP1, オプト2=LP2...）。実装時にgetLatestCrNumber()で既存登録経路が正しく取得できるか確認する。
※ LP番号の実際の対応が異なる場合は、fetchFunnelMapFromUtage()の動的検出ロジックで自動補正する。

## 6. DB変更

### Advertiserテーブルに追加するカラム
```prisma
model Advertiser {
  // ...既存フィールド...
  pixelId     String?   // TikTokピクセルID
  identityId  String?   // TikTokアイデンティティID
}
```

### CrossDeployLogテーブル（新規）
横展開の実行履歴と途中失敗時のリカバリ用。

```prisma
model CrossDeployLog {
  id                    String    @id @default(uuid())
  sourceAdvertiserId    String
  sourceSmartPlusAdId   String
  targetAdvertiserId    String
  status                String    // PENDING, VIDEOS_UPLOADED, UTAGE_CREATED, CAMPAIGN_CREATED, ADGROUP_CREATED, AD_CREATED, COMPLETED, FAILED
  failedStep            String?   // 失敗したステップ名
  errorMessage          String?
  videoMapping          Json?     // { 元video_id: 新video_id } のマッピング
  campaignId            String?   // 作成されたキャンペーンID
  adgroupId             String?   // 作成された広告グループID
  smartPlusAdId         String?   // 作成された広告ID
  utagePath             String?   // 作成されたUTAGE登録経路
  destinationUrl        String?   // ftid付きLP URL
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  @@index([sourceSmartPlusAdId, targetAdvertiserId])
  @@map("cross_deploy_logs")
}
```

途中失敗時、このテーブルのstatusとvideoMappingを見て、失敗したステップから再開できる。

## 7. エラーハンドリング

| エラー | 対応 |
|--------|------|
| video_id取得失敗 | 方法1→2→3の順にフォールバック（2.1参照） |
| 動画ダウンロードURL取得失敗 | file/video/ad/infoを再取得。3回失敗でエラー返却 |
| 動画ダウンロードURL期限切れ | URLを再取得してから再ダウンロード |
| 動画アップロード失敗 | 3回リトライ（指数バックオフ: 1s→2s→4s） |
| 動画処理未完了 | 最大5回ポーリング（3s×1.5倍バックオフ） |
| UTAGEセッション切れ | 302検知で自動再ログイン |
| UTAGE登録経路作成失敗 | 3回リトライ。失敗時はCrossDeployLogに記録してスキップ |
| TikTok APIレート制限(429) | 1秒待機してリトライ（最大3回） |
| キャンペーン作成失敗 | CrossDeployLogに記録。再実行時に新規作成 |
| 広告グループ作成失敗 | 同上 |
| 広告作成失敗 | 同上（孤児キャンペーン/広告グループが残るが害はない） |
| 途中失敗からの再実行 | CrossDeployLogのstatusとvideoMappingを見て、失敗ステップから再開 |

## 8. 実装の優先順とフェーズ

### Phase 0: API確認スクリプト（実装前の調査）
- [ ] smart_plus/ad/getのcreative_listの完全JSONをダンプ → video_idの所在確認
- [ ] file/video/ad/infoのレスポンスから動画ダウンロードURLが取れるか確認
- [ ] smart_plus/campaign/createの正確なエンドポイントとリクエスト形式を確認
- [ ] smart_plus/adgroup/createの正確なエンドポイントとリクエスト形式を確認
- [ ] smart_plus/ad/createの正確なエンドポイントとリクエスト形式を確認
- [ ] 各アカウントのpixel_id, identity_idを取得

### Phase 1: コア機能
- [ ] TikTokServiceに動画情報取得・ダウンロード・アップロードメソッド追加
- [ ] TikTokServiceにSmart+作成メソッド（campaign/adgroup/ad）追加
- [ ] UtageServiceの実装（ログイン・CR番号取得・登録経路作成）
- [ ] SmartPlusDeployServiceの実装（crossDeployメソッド）
- [ ] CrossDeployLogテーブルの追加（マイグレーション）
- [ ] AdvertiserテーブルにpixelId/identityIdカラム追加

### Phase 2: エンドポイント＆運用
- [ ] Controller（preview, cross-deploy, dry-run）
- [ ] 途中失敗からの再開ロジック
- [x] UTAGEファネルマッピングの設定 → **確定済み**（AI/SNS/スキルプラスの全funnelId/groupId/stepId取得完了）

### Phase 3: 将来拡張
- フロントエンド画面での横展開操作
- 横展開結果の自動モニタリング（X日後に成績を自動レポート）
- 勝ちCRの自動検出→横展開先の自動提案
