# 予算調整V2 要件定義書

## 1. 概要

現行の予算調整（1日1回 03:00 JST + 日中CPA 15:00 JST）を廃止し、**1時間に1回の定期実行**方式に変更する。

### 現行システムとの主な差分

| 項目 | 現行（V1） | 新（V2） |
|------|-----------|----------|
| 実行頻度 | 1日1回（03:00） + 日中CPA（15:00） | **1時間に1回**（01:00〜19:00） |
| 判定基準 | 過去7日間のCPA/フロントCPO | **当日CPA**（増額）+ **過去7日CPA/CPO**（停止、初回のみ） |
| 増額条件 | フロントCPO目標達成 → +30% | **当日CPA目標達成** + **オプト数条件** + **予算帯別ルール** |
| 対象CR | imp 5000以上の全配信中CR | **CV 1以上のCR**（当日CV基準） |
| 停止判定 | imp 5000以上でCPA/CPO超過 | **過去7日CPA/CPO超過**（初回01:00のみ） |
| 日中CPA | 15:00に別サービスで実行 | **V2に統合**（不要になる） |
| 予算復元 | 翌00:00に日中削減分を復元 | **不要**（日中削減がなくなるため） |
| クールダウン | 増額後3日間は再増額不可 | **廃止**（CV増加あれば毎時増額可能） |

---

## 2. 実行スケジュール

### 2.1 実行タイミング
- **開始**: 毎日 01:00 JST（第1回）
- **間隔**: 1時間ごと
- **終了**: 20:00 JST（最終回は19:00 JST開始分）
- **20:00以降**: 予算調整を行わない

つまり、実行回数は**1日19回**（01:00, 02:00, ..., 19:00）

### 2.2 TikTok APIレート制限への影響
- TikTok APIのレート制限: **10 QPS / 600リクエスト/分**（エンドポイントごと）
- 1回の予算調整で想定されるAPI呼び出し数: 各アカウント20〜50リクエスト
- 全アカウント合計でも200リクエスト/回程度
- **1時間に1回であれば全く問題なし**

---

## 3. 第1回予算調整（01:00 JST）

第1回は**2段階**で実行する。

### 3.1 第1段階：当日CPA基準の予算増額

#### 対象CR
- **配信中（ACTIVE）** のCR
- **当日CVが1以上**ついているCR
- CVの確認方法: 導線ごとのGoogleスプレッドシートを参照し、**当日の日付**と**登録経路**でフィルタ
  - 登録経路パターン: `TikTok広告-{訴求名}-{LP名}`

#### 判定ロジック

```
IF 当日CPA > 目標CPA:
    → そのまま配信を継続（予算変更なし）

IF 当日CPA ≤ 目標CPA:
    IF 日予算 < 8,000円:
        → 日予算を1.3倍に増額

    ELSE IF 8,000円 ≤ 日予算 ≤ 20,000円:
        IF 当日オプト数 ≥ 2:
            → 日予算を1.3倍に増額
        ELSE:
            → そのまま配信を継続

    ELSE IF 20,000円 < 日予算 ≤ 40,000円:
        IF 当日オプト数 ≥ 3:
            → 日予算を1.3倍に増額
        ELSE:
            → そのまま配信を継続

    ELSE IF 日予算 > 40,000円:
        → そのまま配信を継続（※上限到達、増額しない）
```

#### 補足
- **「当日CPA」**: 当日の広告費 ÷ 当日のCV数
- **「当日オプト数」**: 当日のCV数（スプレッドシートの登録数）
- **「目標CPA」**: Appealテーブルの `targetCPA`
- **「日予算」**: TikTok APIから取得するAdGroupまたはCampaignの日予算
- **クールダウンなし**: CV増加があれば毎時間増額可能

### 3.2 第2段階：過去7日間CPA/フロントCPOによる停止判定

第1段階の増額処理が完了した後、**全配信中CR**（CV有無問わず）を対象に停止判定を行う。
停止されたCRは**恒久停止**（手動Resumeのみ）。自動Resumeはなし。

#### データ取得元
- **過去7日間の広告費**: TikTok Report API（`/v1.3/report/integrated/get/`）から直接取得
- **過去7日間のCV数**: Googleスプレッドシートから取得
- **過去7日間のフロント販売数**: フロント用スプレッドシートから取得
- ※DB（Metricテーブル）は使用しない。全てAPIから取得する

#### 新規CR保護ルール
停止判定は以下の**いずれかの条件を満たすCR**のみ対象とする:
- **過去7日間の広告費合計 ≥ 許容CPA金額**（例: 許容CPA ¥2,500 → ¥2,500以上消化）
- **過去7日間のインプレッション ≥ 5,000**

上記いずれも満たさない場合（新規出稿などデータ不足） → **判定スキップ（配信継続）**

#### 導線による分岐

**A. SNS導線・AI導線の場合**（フロント商品が存在する）

```
// まず新規CR保護チェック
IF 過去7日間の広告費 < 許容CPA AND 過去7日間のimp < 5,000:
    → 判定スキップ（配信継続）

IF 過去7日間のフロント販売数 ≥ 1:
    IF 過去7日間（当日含む）のフロントCPO > 許容フロントCPO:
        → 配信を停止
    ELSE:
        → 配信を継続

IF 過去7日間のフロント販売数 = 0:
    IF 過去7日間のCV数 = 0:
        → 配信を停止
    ELSE:
        // フロント販売0件 → CPAで判定にフォールバック
        IF 過去7日間のCPA > 許容CPA:
            → 配信を停止
        ELSE:
            → 配信を継続
```

**B. スキルプラス（セミナー）導線の場合**

```
// まず新規CR保護チェック
IF 過去7日間の広告費 < 許容CPA AND 過去7日間のimp < 5,000:
    → 判定スキップ（配信継続）

IF 過去7日間のCV数 = 0:
    → 配信を停止

IF 過去7日間（当日含む）のCPA > 許容CPA:
    → 配信を停止
ELSE:
    → 配信を継続
```

#### 導線の判定方法
- Appeal（訴求）の名前で判定:
  - `SNS` を含む → SNS導線（フロントCPO判定）
  - `AI` を含む → AI導線（フロントCPO判定）
  - 上記以外（スキルプラス等） → セミナー導線（CPA判定）
- **許容フロントCPO**: Appealテーブルの `allowableFrontCPO`
- **許容CPA**: Appealテーブルの `allowableCPA`

#### フロントCPO / CPAの計算
- **フロントCPO** = 過去7日間の広告費合計 ÷ 過去7日間のフロント販売数
  - フロント販売数はフロント用スプレッドシート（`frontSpreadsheetUrl`）から取得
- **CPA** = 過去7日間の広告費合計 ÷ 過去7日間のCV数
  - CV数はCV用スプレッドシート（`cvSpreadsheetUrl`）から取得

---

## 4. 第2回以降の予算調整（02:00〜19:00 JST）

### 対象CR
- **配信中（ACTIVE）** のCR
- **前回の予算調整タイミングからCV数が増えている**CR
  - 例: 02:00実行時 → 01:00時点のCV数と比較し、増加しているCRが対象
- CVの確認方法: 同じくスプレッドシート参照

### 判定ロジック（第1回の第1段階と同一）

```
IF 当日CPA > 目標CPA:
    → そのまま配信を継続（予算変更なし）

IF 当日CPA ≤ 目標CPA:
    IF 日予算 < 8,000円:
        → 日予算を1.3倍に増額

    ELSE IF 8,000円 ≤ 日予算 ≤ 20,000円:
        IF 当日オプト数 ≥ 2:
            → 日予算を1.3倍に増額
        ELSE:
            → そのまま配信を継続

    ELSE IF 20,000円 < 日予算 ≤ 40,000円:
        IF 当日オプト数 ≥ 3:
            → 日予算を1.3倍に増額
        ELSE:
            → そのまま配信を継続

    ELSE IF 日予算 > 40,000円:
        → そのまま配信を継続
```

### 注意
- 第2回以降は**停止判定（第2段階）は行わない**
- 停止判定は**1日1回、第1回（01:00）のみ**

---

## 5. データ管理

### 5.1 前回CV数の記録（差分検出用）

第2回以降で「前回タイミングからCV数が増えたか」を判定するために、毎回の実行時にCR別のCV数を記録する。

#### 新テーブル `HourlyOptimizationSnapshot`

```prisma
model HourlyOptimizationSnapshot {
  id            String   @id @default(uuid())
  advertiserId  String
  adId          String   // TikTok Ad ID
  adName        String
  executionTime DateTime // 実行日時（JST）
  todayCVCount  Int      // その時点での当日CV数
  todaySpend    Float    // その時点での当日広告費
  todayCPA      Float?   // その時点での当日CPA
  dailyBudget   Float    // その時点での日予算
  action        String   // INCREASE / CONTINUE / SKIP（対象外）
  reason        String?  // 判定理由
  newBudget     Float?   // 増額後の予算（増額した場合）
  createdAt     DateTime @default(now())

  @@index([advertiserId, executionTime])
  @@index([adId, executionTime])
  @@map("hourly_optimization_snapshots")
}
```

### 5.2 Snapshotデータ保持期間
- **730日間**（約2年）保持
- 730日を超えた古いレコードは定期的に削除（日次バッチまたはV2実行時に削除）
- 推定データ量: 50CR × 19回/日 × 730日 = 約69万行/アカウント（問題なし）

### 5.3 ChangeLog（既存テーブル）
- 予算変更・停止のログは既存の `ChangeLog` テーブルに記録
- `source` = `'BUDGET_OPTIMIZATION_V2'` で区別

---

## 6. 既存機能への影響

### 6.1 廃止する機能
| 機能 | ファイル | 理由 |
|------|---------|------|
| 現行予算調整（03:00） | `optimization.service.ts` | V2に置き換え |
| 日中CPA（15:00） | `intraday-optimization.service.ts` | V2に統合 |
| 日中Resume（23:59） | intraday workflow | 日中停止がなくなるため不要 |
| Budget Restore（00:00） | intraday workflow | 日中予算削減がなくなるため不要 |
| クールダウン（3日間） | optimization.service.ts | V2で廃止 |

### 6.2 維持する機能
| 機能 | 備考 |
|------|------|
| Entity Sync（00:00） | 変更なし |
| Daily Report（00:00） | 変更なし |
| Daily Ad Count Recording（03:30） | 変更なし |
| AdBudgetCap（上限日予算） | V2でも尊重する（※Q7で確認済み） |

### 6.3 GitHub Actionsスケジュール変更

**廃止:**
- `budget-optimization.yml`（03:00）
- `intraday-optimization.yml`（15:00, 23:59, 00:00 restore）

**新規:**
- `budget-optimization-v2.yml`
  - 毎時実行: `0 16-23,0-10 * * *`（UTC → JST 01:00〜19:00）
  - 全対象アカウントに対して実行
  - 第1回（01:00 JST = 16:00 UTC）かどうかはワークフロー内で判定

---

## 7. 全決定事項

| 項目 | 決定内容 |
|------|---------|
| Q1: クールダウン | **廃止**。CV増加があれば毎時間増額可能 |
| Q2: 日予算40,000円超 | **増額しない**（上限） |
| Q3: 過去7日CV=0のCR | **停止する** |
| Q3補足: フロント販売0件の場合 | **過去7日CPAが許容値超過なら停止** |
| Q4: Smart+広告 | **Smart+のみ対応**。通常キャンペーン・旧スマプラは不要。今後Smart+のみ作成されるため |
| Q5: CBO対応 | **対応する**。キャンペーン予算最適化時はキャンペーン単位で調整 |
| Q6: 対象アカウント | **スキルプラス1 (7474920444831875080)** から開始。他アカウントは後日追加 |
| Q7: AdBudgetCap | **維持する**。特定広告に個別の上限を設定するケースに対応 |
| Q8: 01:00のCV数 | 少なくてOK。第1回は実質的に第2段階（停止判定）がメイン |
| Q9: データ取得元 | **当日・過去7日とも全てTikTok Report APIから取得**（DBは使用しない） |
| Q10: 新規CR保護 | **広告費 ≥ 許容CPA金額 または imp ≥ 5,000** のCRのみ停止判定対象。それ以外はスキップ |
| Q11: Stage 2停止の復帰 | **恒久停止**（手動Resumeのみ）。自動Resumeなし。日中CPA一時停止は廃止 |
| Q12: Snapshot保持期間 | **730日間**。超過分は定期削除 |
| Q13: 既存ユーティリティ | `parseAdName()`, `generateRegistrationPath()`, `getCVCount()`, `getFrontSalesCount()` 等を**再利用** |

---

## 9. 処理フロー図

```
毎時実行（01:00〜19:00 JST）
│
├─ 01:00（第1回）
│   │
│   ├─【第1段階】当日CPA基準の予算増額
│   │   ├─ 配信中CRを取得
│   │   ├─ スプレッドシートから当日CV数を取得
│   │   ├─ CV ≥ 1のCRを抽出
│   │   ├─ 当日CPA = 当日広告費 ÷ 当日CV数
│   │   ├─ 目標CPA比較 + 予算帯別ルール適用
│   │   └─ 増額実行 → ChangeLog + Snapshot記録
│   │
│   └─【第2段階】過去7日間CPA/CPOによる停止判定
│       ├─ 配信中の全CRを対象
│       ├─ 導線判定（SNS/AI → フロントCPO、スキルプラス → CPA）
│       ├─ 過去7日CV=0 → 停止
│       ├─ SNS/AI: フロント販売0 → CPAフォールバック判定
│       ├─ 過去7日間のCPA/フロントCPOを計算
│       ├─ 許容値と比較
│       └─ 停止実行 → ChangeLog記録
│
├─ 02:00〜19:00（第2回以降）
│   ├─ 配信中CRを取得
│   ├─ スプレッドシートから当日CV数を取得
│   ├─ 前回Snapshotと当日CV数を比較
│   ├─ CV数が増加したCRのみ対象
│   ├─ 当日CPA = 当日広告費 ÷ 当日CV数
│   ├─ 目標CPA比較 + 予算帯別ルール適用
│   ├─ 増額実行 → ChangeLog記録
│   └─ Snapshot記録
│
└─ 20:00以降
    └─ 実行しない
```

---

## 10. 実装方針（概要）

### Smart+専用設計
V2は**Smart+キャンペーンのみ**を対象とする。通常キャンペーンや旧Smart+（レガシー）の処理は不要。

**使用するTikTok API:**
- 広告取得: `/v1.3/smart_plus/ad/get/`
- 予算更新（AdGroup）: `/v1.3/smart_plus/ad/update/`
- 予算更新（Campaign/CBO）: `/v1.3/smart_plus/campaign/update/`
- 広告停止: `/v1.3/ad/status/update/`（Smart+でも共通）
- メトリクス取得: `/v1.3/report/integrated/get/`

### 初期対象アカウント
- **スキルプラス1**: 7474920444831875080（セミナー導線 → CPA判定）
- 他アカウントは後日GitHub Actions設定で追加

### 新サービス構成
```
apps/backend/src/
├── budget-optimization-v2/
│   ├── budget-optimization-v2.module.ts
│   ├── budget-optimization-v2.service.ts    # メインロジック
│   ├── budget-optimization-v2.controller.ts # APIエンドポイント
│   └── types.ts                              # 型定義
```

### 主要メソッド
1. `executeHourlyOptimization(advertiserId, accessToken)` - メインエントリ（毎時実行）
2. `executeFirstRoundStage1(ads, appeal)` - 第1回第1段階（当日CPA増額）
3. `executeFirstRoundStage2(ads, appeal)` - 第1回第2段階（停止判定）
4. `executeSubsequentRound(ads, appeal)` - 第2回以降（差分CV増額）
5. `evaluateBudgetIncrease(ad, todayCPA, todayCV, dailyBudget, targetCPA)` - 増額判定共通ロジック

### CBO対応
- Smart+でCBO有効時はキャンペーン単位で日予算を調整
- CBO無効時はAdGroup単位で日予算を調整
- CBO判定はキャンペーン情報から自動検出

### AdBudgetCap対応
- 増額前にAdBudgetCapテーブルを確認
- 個別の上限が設定されている場合、その金額を超えない
- 40,000円上限ルールとAdBudgetCapの**小さい方**を適用

### APIエンドポイント
- `POST /budget-optimization-v2/execute/:advertiserId` - 手動実行（テスト用）
- `POST /budget-optimization-v2/execute-all` - 全アカウント実行
- `GET /budget-optimization-v2/snapshots/:advertiserId` - スナップショット閲覧
- `POST /budget-optimization-v2/dry-run/:advertiserId` - ドライラン
