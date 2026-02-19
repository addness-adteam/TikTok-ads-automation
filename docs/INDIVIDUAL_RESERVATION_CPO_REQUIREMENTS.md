# 個別予約CPO 要件定義書（確定版）

## 1. 概要

### 1.1 目的
予算調整V2のStage 2（過去7日間停止判定）に、**個別予約CPO**を新たな判定指標として追加する。
AI導線・SNS導線・スキルプラス導線の全導線で、既存のCPA/フロントCPO判定の**後に**個別予約CPOによる判定を行う。

### 1.2 個別予約CPOの定義

```
個別予約CPO = 過去7日間の対象広告の広告費 ÷ 過去7日間の対象広告の個別予約数
```

### 1.3 使用箇所
- **Stage 2（停止判定）のみ**で使用する
- Stage 1（増額判定）では使用しない

---

## 2. 個別予約数の計測方法

### 2.1 データソース

全導線共通のスプレッドシート:

| 項目 | 値 |
|------|-----|
| スプレッドシートID | `1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA` |

### 2.2 導線別のタブ・列設定

| 導線タイプ | タブ名 | 日付列 | 登録経路列 |
|-----------|--------|--------|-----------|
| スキルプラス（SEMINAR） | `スキルプラス（オートウェビナー用）` | A列（インデックス0） | AI列（インデックス34） |
| AI | `AI` | A列（インデックス0） | AU列（インデックス46） |
| SNS | `SNS` | A列（インデックス0） | AU列（インデックス46） |

### 2.3 日付フォーマット

A列の日付形式: `2026/2/1`（年/月/日、ゼロ埋めなし）

既存の `parseDate()` メソッドで対応可能（`/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/` パターン）。

### 2.4 カウントロジック

既存のオプト数やフロント販売数の計測（1行=1件）とは異なり、**1セルに複数件の登録経路が含まれる場合がある**。

#### セルのデータ例
```
TikTok広告-スキルプラス-LP2-CR00322
TikTok広告-スキルプラス-LP2-CR00322
```
↑ このセルは、同日にこの登録経路から **2件** の個別予約があったことを意味する。

#### カウント手順
1. A列の日付が過去7日間（当日含む7日間）に含まれる行を対象とする
2. 該当行の登録経路列（AI列 or AU列）のセル値を取得
3. セル値を改行（`\n`）で分割
4. 分割した各行を `trim()` して対象の登録経路と完全一致するかチェック
5. 一致した数をカウント（同一セル内に複数あればその分カウント）
6. 期間内の全行のカウントを合算して返却

### 2.5 登録経路のフォーマット（確定）

個別予約の登録経路は**広告単位（CR名を含む）**:

```
TikTok広告-{appealName}-{lpName}-{creativeName}
```

例: `TikTok広告-スキルプラス-LP2-CR00322`

※ 既存のオプト/フロント用登録経路（`TikTok広告-{appealName}-{lpName}`）とは異なり、CR名まで含む。

広告名フォーマット `YYMMDD/制作者名/CR名/LP名` の `parsedName` から生成:
```typescript
// 既存（オプト/フロント用）
generateRegistrationPath(lpName, appealName) → `TikTok広告-${appealName}-${lpName}`

// 新規（個別予約用）
generateIndividualReservationPath(lpName, creativeName, appealName)
  → `TikTok広告-${appealName}-${lpName}-${creativeName}`
```

---

## 3. 停止判定への組み込み（確定）

### 3.1 判定タイミング

既存のCPA/フロントCPO判定が**CONTINUE**と判定された場合に、追加で個別予約CPO判定を行う。
既存判定でPAUSEの場合は即PAUSE（個別予約CPO判定は不要）。

### 3.2 個別予約CPO判定ロジック

```
■ 全導線共通（既存判定でCONTINUEの場合に追加実行）

  前提: allowableIndividualReservationCPO がAppealに設定されている場合のみ判定

  ├─ 個別予約数 = 0 の場合
  │   ├─ 広告費 < 許容個別予約CPO → CONTINUE（配信継続）
  │   └─ 広告費 ≥ 許容個別予約CPO → PAUSE（配信停止）
  │
  └─ 個別予約数 ≥ 1 の場合
      ├─ 個別予約CPO ≤ 許容個別予約CPO → CONTINUE（配信継続）
      └─ 個別予約CPO > 許容個別予約CPO → BUDGET_DECREASE_20PCT（日予算20%ダウン）
```

### 3.3 新アクション: BUDGET_DECREASE_20PCT

個別予約CPOが許容値を超過した場合、広告を停止するのではなく**日予算を20%ダウン**する。

```
新日予算 = 現在の日予算 × 0.8（小数点以下切り捨て）
```

- TikTok APIの最低予算（¥2,000）を下回る場合は¥2,000に設定
- ChangeLogに記録する（source: `BUDGET_OPTIMIZATION_V2`, action: `DECREASE_BUDGET`）

### 3.4 更新後の完全なStage 2判定フロー

```
■ SNS/AI導線（usesFrontCPO = true）
  ┌─ 新規CR保護チェック（広告費 < 許容CPA かつ imp < 5,000 → SKIP）
  │
  ├─ フロントCPO判定（既存）
  │   ├─ フロント販売 ≥ 1 → フロントCPO > 許容フロントCPO → PAUSE
  │   ├─ フロント販売 = 0, CV = 0 → PAUSE
  │   ├─ フロント販売 = 0, CV > 0, 広告費 ≥ 許容フロントCPO → PAUSE
  │   └─ フロント販売 = 0, CV > 0, CPA > 許容CPA → PAUSE
  │
  ├─ ここまでCONTINUEの場合 → 個別予約CPO判定（★新規追加）
  │   ├─ allowableIndividualReservationCPO 未設定 → CONTINUE
  │   ├─ 個別予約 = 0, 広告費 < 許容個別予約CPO → CONTINUE
  │   ├─ 個別予約 = 0, 広告費 ≥ 許容個別予約CPO → PAUSE
  │   ├─ 個別予約 ≥ 1, 個別予約CPO ≤ 許容個別予約CPO → CONTINUE
  │   └─ 個別予約 ≥ 1, 個別予約CPO > 許容個別予約CPO → BUDGET_DECREASE_20PCT
  │
  └─ CONTINUE

■ スキルプラス（SEMINAR）導線
  ┌─ 新規CR保護チェック（既存）
  │
  ├─ CPA判定（既存）
  │   ├─ CV = 0 → PAUSE
  │   └─ CPA > 許容CPA → PAUSE
  │
  ├─ ここまでCONTINUEの場合 → 個別予約CPO判定（★新規追加）
  │   ├─ allowableIndividualReservationCPO 未設定 → CONTINUE
  │   ├─ 個別予約 = 0, 広告費 < 許容個別予約CPO → CONTINUE
  │   ├─ 個別予約 = 0, 広告費 ≥ 許容個別予約CPO → PAUSE
  │   ├─ 個別予約 ≥ 1, 個別予約CPO ≤ 許容個別予約CPO → CONTINUE
  │   └─ 個別予約 ≥ 1, 個別予約CPO > 許容個別予約CPO → BUDGET_DECREASE_20PCT
  │
  └─ CONTINUE
```

---

## 4. データモデル変更

### 4.1 Appealモデル（Prisma）

```prisma
model Appeal {
  // 既存フィールド
  id                    String      @id @default(uuid())
  name                  String      @unique
  targetCPA             Float?
  allowableCPA          Float?
  targetFrontCPO        Float?
  allowableFrontCPO     Float?
  cvSpreadsheetUrl      String?
  frontSpreadsheetUrl   String?
  createdAt             DateTime    @default(now())
  updatedAt             DateTime    @updatedAt

  // ★ 新規追加
  allowableIndividualReservationCPO   Float?    // 許容個別予約CPO

  advertisers           Advertiser[]
  adTextTemplates       AdTextTemplate[]
  @@map("appeals")
}
```

- `allowableIndividualReservationCPO` のみ追加（`target` は不要、増額判定では使わないため）
- スプレッドシートIDは全導線共通固定のため、環境変数またはコード定数で管理

### 4.2 PauseAction型の拡張

```typescript
// 既存
export type PauseAction = 'PAUSE' | 'CONTINUE' | 'SKIP_NEW_CR';

// 変更後
export type PauseAction = 'PAUSE' | 'CONTINUE' | 'SKIP_NEW_CR' | 'BUDGET_DECREASE_20PCT';
```

### 4.3 PauseDecision型の拡張

```typescript
export interface PauseDecision {
  // 既存フィールド
  adId: string;
  adName: string;
  action: PauseAction;
  reason: string;
  channelType: ChannelType;
  last7DaysSpend: number;
  last7DaysImpressions: number;
  last7DaysCVCount: number;
  last7DaysFrontSalesCount: number;
  last7DaysCPA: number | null;
  last7DaysFrontCPO: number | null;

  // ★ 新規追加
  last7DaysIndividualReservationCount: number;
  last7DaysIndividualReservationCPO: number | null;
  newBudgetAfterDecrease?: number;  // BUDGET_DECREASE_20PCT時の新予算
}
```

---

## 5. 実装の影響範囲

### 5.1 バックエンド変更

| ファイル | 変更内容 |
|---------|---------|
| `prisma/schema.prisma` | Appealモデルに `allowableIndividualReservationCPO` 追加 |
| `src/google-sheets/google-sheets.service.ts` | `getIndividualReservationCount()` メソッド追加 |
| `src/budget-optimization-v2/types.ts` | PauseAction/PauseDecisionに個別予約フィールド追加 |
| `src/budget-optimization-v2/budget-optimization-v2.service.ts` | Stage 2に個別予約CPO判定 + 予算20%ダウン実行追加 |
| `src/appeal/appeal.service.ts` | 新フィールドのCRUD対応 |
| `src/appeal/appeal.controller.ts` | 新フィールドのDTO対応（必要に応じて） |

### 5.2 フロントエンド変更

| ファイル | 変更内容 |
|---------|---------|
| `apps/frontend/app/appeals/page.tsx` | Appeal型に `allowableIndividualReservationCPO` 追加、フォームに入力欄追加 |

フォームに追加する入力欄:
```
許容個別予約CPO (Allowable Individual Reservation CPO)
  - 数値入力（¥）
  - 任意項目
  - プレースホルダ: "例: 50000"
```

### 5.3 GoogleSheetsServiceの新メソッド

```typescript
/**
 * 個別予約数を取得
 *
 * 既存のcountRegistrationPathとは異なるロジック:
 * - 列位置はchannelTypeで固定（ヘッダー検出不要）
 * - 1セル内に改行区切りで複数の登録経路が含まれる場合があり、
 *   各行をカウントする
 *
 * @param channelType 導線タイプ（タブ名・列の決定に使用）
 * @param spreadsheetId スプレッドシートID
 * @param registrationPath 登録経路（例: TikTok広告-スキルプラス-LP2-CR00322）
 * @param startDate 開始日
 * @param endDate 終了日
 * @returns 個別予約件数
 */
async getIndividualReservationCount(
  channelType: ChannelType,
  spreadsheetId: string,
  registrationPath: string,
  startDate: Date,
  endDate: Date,
): Promise<number>
```

#### 導線タイプ → タブ名・列のマッピング定数

```typescript
const INDIVIDUAL_RESERVATION_CONFIG = {
  SEMINAR: {
    sheetName: 'スキルプラス（オートウェビナー用）',
    dateColumnIndex: 0,        // A列
    pathColumnIndex: 34,       // AI列
  },
  AI: {
    sheetName: 'AI',
    dateColumnIndex: 0,        // A列
    pathColumnIndex: 46,       // AU列
  },
  SNS: {
    sheetName: 'SNS',
    dateColumnIndex: 0,        // A列
    pathColumnIndex: 46,       // AU列
  },
} as const;
```

### 5.4 予算20%ダウン実行メソッド

```typescript
/**
 * 広告の日予算を20%ダウンする
 * - CBO: キャンペーン予算を20%ダウン
 * - 非CBO: AdGroup予算を20%ダウン
 * - 最低¥2,000を下回らない
 */
private async executeBudgetDecrease(
  ad: V2SmartPlusAd,
  reason: string,
  advertiserId: string,
  accessToken: string,
): Promise<number>  // 新予算を返す
```

---

## 6. 処理フロー図

```
executeStage2()
  │
  ├── 各広告ループ
  │     │
  │     ├── 広告名パースチェック
  │     ├── 新規CR保護チェック
  │     ├── スプレッドシートからCV数取得（既存）
  │     ├── スプレッドシートからフロント販売数取得（SNS/AIのみ、既存）
  │     ├── ★ スプレッドシートから個別予約数取得（新規）
  │     ├── CPA / フロントCPO / ★個別予約CPO 計算
  │     │
  │     ├── evaluatePauseDecision()（既存ロジック）
  │     │     └── PAUSE or CONTINUE を返す
  │     │
  │     ├── ★ CONTINUEの場合 → evaluateIndividualReservationCPO()（新規）
  │     │     ├── 未設定 → CONTINUE
  │     │     ├── 予約0 + 広告費 < 許容値 → CONTINUE
  │     │     ├── 予約0 + 広告費 ≥ 許容値 → PAUSE
  │     │     ├── 予約≥1 + CPO ≤ 許容値 → CONTINUE
  │     │     └── 予約≥1 + CPO > 許容値 → BUDGET_DECREASE_20PCT
  │     │
  │     ├── PAUSE → executeAdPause()（既存）
  │     └── ★ BUDGET_DECREASE_20PCT → executeBudgetDecrease()（新規）
  │
  └── 結果返却
```

---

## 7. ログ出力

個別予約CPO判定の結果は、既存のログと同じ形式で出力する:

```
[V2] Ad {adId} ({adName}): 個別予約CPO判定
  - 過去7日間個別予約数: {count}件
  - 過去7日間広告費: ¥{spend}
  - 個別予約CPO: ¥{cpo} (許容: ¥{allowable})
  - 判定: CONTINUE / PAUSE / BUDGET_DECREASE_20PCT
```

予算20%ダウン時の追加ログ:
```
[V2] Budget decrease for ad {adId}: ¥{oldBudget} → ¥{newBudget} (20% down, 個別予約CPO超過)
```
