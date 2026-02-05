# 日次出稿数・停止数記録機能 要件定義書

## 1. 概要

TikTok広告の日次の**出稿数**と**停止数**を自動で集計し、既存のGoogle Sheetsに記録する機能。

## 2. 用語定義

| 用語 | 定義 |
|------|------|
| 出稿数 | 特定の日付に出稿された広告の数。広告名の先頭にあるYYMMDD形式の日付で判定する |
| 停止数 | 特定の日付に**予算最適化（Daily Budget Optimization）**で停止された広告の数。日中CPA最適化による停止は含めない |
| 広告名フォーマット | `YYMMDD/制作者名/CR名/LP名`（例: `260204/田中/新春CR/LP-A`） |

## 3. 対象アカウント

以下の5アカウントのみを対象とする。

| アカウント名 | Advertiser ID |
|-------------|---------------|
| AI_1 | `7468288053866561553` |
| AI_2 | `7523128243466551303` |
| AI_3 | `7543540647266074641` |
| スキルプラス1（セミナー導線） | `7474920444831875080` |
| スキルプラス2 | `7592868952431362066` |

対象外のアカウント（SNS_1: `7247073333517238273`、SNS1: `7543540381615800337` など）の広告はカウントしない。

## 4. 機能仕様

### 4.1 出稿数のカウントロジック

**データソース**: データベースの `ads` テーブル

**カウント方法**:
1. 対象5アカウントに紐づく広告のみを取得する
2. 広告名（`name`フィールド）の先頭がターゲット日付のYYMMDD形式で始まるものをカウントする
3. ステータス（ENABLE/DISABLE）は問わない（出稿された事実を記録するため）

**日付の判定ロジック**:
```
ターゲット日: 2026年2月3日 → YYMMDD = "260203"
広告名の例: "260203/山田/キャンペーンA/LP1" → 2/3の出稿としてカウント
```

**Prismaクエリ例**:
```typescript
const TARGET_ADVERTISER_IDS = [
  '7468288053866561553',  // AI_1
  '7523128243466551303',  // AI_2
  '7543540647266074641',  // AI_3
  '7474920444831875080',  // スキルプラス1
  '7592868952431362066',  // スキルプラス2
];

const targetDateStr = '260203'; // YYMMDD形式

const count = await prisma.ad.count({
  where: {
    name: { startsWith: targetDateStr + '/' },
    adgroup: {
      campaign: {
        advertiser: {
          tiktokAdvertiserId: { in: TARGET_ADVERTISER_IDS },
        },
      },
    },
  },
});
```

**補足事項**:
- `startsWith: 'YYMMDD/'` とスラッシュ付きで検索することで、`260203`で始まる別日付（例: `2602031`）との誤マッチを防ぐ
- Smart+広告のクリエイティブ名（拡張子付き）は広告名フォーマットに合致しないため自然に除外される
- データベースの広告データは毎日0:00 JSTのEntity Syncジョブで最新化されている
- スキルプラス2（`7592868952431362066`）は新規アカウントのため、Entity Sync対象に含まれているか確認が必要

### 4.2 停止数のカウントロジック

**データソース**: データベースの `change_logs` テーブル

**対象**: 予算最適化（Daily Budget Optimization: 3:00 JST）による停止のみ。日中CPA最適化（15:00 JST）による停止は含めない。

**推奨理由**（GitHub Actionsログよりも優れている点）:
1. **精度**: 構造化データのため正確にカウントできる（ログのパースが不要）
2. **実装容易性**: 単純なDBクエリで取得可能
3. **信頼性**: TikTok APIコール成功後にログが記録されるため、実際に停止された広告のみカウント

**カウント方法**:
```typescript
const pauseCount = await prisma.changeLog.count({
  where: {
    action: 'PAUSE',
    source: 'OPTIMIZATION',
    createdAt: {
      gte: startOfDay,  // ターゲット日 00:00:00 JST
      lt: endOfDay,     // ターゲット日+1 00:00:00 JST
    },
    // 対象アカウントのフィルタ: entityId（Ad TikTok ID）から
    // 対象アカウントに紐づく広告のみカウント
  },
});
```

**対象アカウントのフィルタ方法**:
ChangeLogには`advertiserId`フィールドがないため、以下のいずれかの方法で絞り込む:
1. **方法A（推奨）**: 対象アカウントの広告IDリストを先に取得し、`entityId: { in: adIds }` でフィルタ
2. **方法B**: ChangeLogのentityId（= Ad tiktokId）をAdsテーブルとJOINし、アカウントで絞り込む

```typescript
// 方法A: 対象アカウントの広告IDを先に取得
const targetAdIds = await prisma.ad.findMany({
  where: {
    adgroup: {
      campaign: {
        advertiser: {
          tiktokAdvertiserId: { in: TARGET_ADVERTISER_IDS },
        },
      },
    },
  },
  select: { tiktokId: true },
});

const adIdSet = new Set(targetAdIds.map(a => a.tiktokId));

const allPauses = await prisma.changeLog.findMany({
  where: {
    action: 'PAUSE',
    source: 'OPTIMIZATION',
    createdAt: { gte: startOfDay, lt: endOfDay },
  },
});

const pauseCount = allPauses.filter(p => adIdSet.has(p.entityId)).length;
```

### 4.3 記録先 Google Sheets

| 項目 | 値 |
|------|-----|
| スプレッドシートID | `1lJ2mwmBhRiJKak9yoXPM93rC-WCglO2MSZVCdRxa-5Y` |
| タブ名 | `TikTok広告` |
| ヘッダー行 | 1行目（データは2行目から） |
| A列 | 日付（形式: `M/D`、例: `2/3`） |
| B列 | 出稿数 |
| C列 | 停止数 |

**書き込みロジック**:
1. A列（2行目以降）を走査して、ターゲット日付に一致する行を探す
2. 一致する行が見つかった場合 → B列・C列を更新
3. 一致する行が見つからない場合 → 最終行の次に新規行を追加

**日付フォーマット変換**:
```
ターゲット日: 2026-02-03
→ A列の形式: "2/3"（先頭ゼロなし、月/日）
```

## 5. 実行タイミング

### 5.1 スケジュール

| 項目 | 値 |
|------|-----|
| 実行トリガー | Daily Budget Optimization 完了後 |
| 実行時刻 | 3:30 JST（18:30 UTC前日）※予算最適化の完了を待つため30分のバッファ |
| 記録対象日 | **前日**（実行日が2/4なら、2/3の出稿数・停止数を記録） |

**前日を対象とする理由**:
- 出稿数: 朝3:30 JSTに実行する時点では、当日出稿の広告はまだ作成されていない可能性があるため、前日分のみ確定している
- 停止数: 前日の予算最適化（3:00 JST）の結果が確定している

### 5.2 GitHub Actions ワークフロー

独立したワークフローとして新規作成する。

**ファイル**: `.github/workflows/daily-ad-count-recording.yml`

```yaml
name: Daily Ad Count Recording
on:
  schedule:
    - cron: '30 18 * * *'  # 3:30 JST = 18:30 UTC前日
  workflow_dispatch:
    inputs:
      target_date:
        description: '記録対象日（YYYY-MM-DD形式、空欄で前日）'
        required: false
        type: string
```

**独立ワークフローとする理由**: 予算最適化とは独立した責務のため、障害時の影響範囲を限定できる。

## 6. 実装設計

### 6.1 新規作成が必要なもの

#### 6.1.1 サービス: `AdCountRecordingService`

**場所**: `apps/backend/src/ad-count-recording/`

**責務**:
- 対象アカウントの出稿数のカウント
- 対象アカウントの停止数のカウント
- Google Sheetsへの書き込み

**メソッド**:
```typescript
class AdCountRecordingService {
  // 対象アカウントID定数
  private readonly TARGET_ADVERTISER_IDS = [
    '7468288053866561553',  // AI_1
    '7523128243466551303',  // AI_2
    '7543540647266074641',  // AI_3
    '7474920444831875080',  // スキルプラス1
    '7592868952431362066',  // スキルプラス2
  ];

  // メインエントリポイント: 前日の出稿数・停止数を記録
  async recordDailyCounts(targetDate?: Date): Promise<RecordResult>

  // 出稿数カウント: 広告名のYYMMDD prefixで判定（対象アカウントのみ）
  private async countLaunchedAds(targetDate: Date): Promise<number>

  // 停止数カウント: ChangeLogテーブルから取得（OPTIMIZATIONのみ、対象アカウントのみ）
  private async countPausedAds(targetDate: Date): Promise<number>

  // Google Sheetsへの書き込み
  private async writeToSheet(
    date: string,       // "M/D" 形式
    launchCount: number,
    pauseCount: number
  ): Promise<void>
}
```

#### 6.1.2 APIエンドポイント

**場所**: `apps/backend/src/jobs/jobs.controller.ts` に追加

```
POST /jobs/record-daily-ad-counts?targetDate=2026-02-03
```

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| targetDate | No | 記録対象日（YYYY-MM-DD形式）。省略時は前日 |

**レスポンス例**:
```json
{
  "success": true,
  "data": {
    "targetDate": "2026-02-03",
    "launchCount": 12,
    "pauseCount": 5,
    "sheetUpdated": true
  }
}
```

#### 6.1.3 GitHub Actions ワークフロー

**ファイル**: `.github/workflows/daily-ad-count-recording.yml`

### 6.2 既存コードの変更が必要なもの

#### 6.2.1 Google Sheets サービスの書き込み対応

**ファイル**: `apps/backend/src/google-sheets/google-sheets.service.ts`

現在は読み取り専用（`spreadsheets.readonly`スコープ）のため、以下の変更が必要:

1. **スコープの変更**:
```typescript
// 変更前
scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
// 変更後
scopes: ['https://www.googleapis.com/auth/spreadsheets']
```

2. **書き込みメソッドの追加**:
```typescript
// 指定範囲の値を取得
async getValues(spreadsheetId: string, range: string): Promise<string[][]>

// 指定範囲に値を書き込み（既存行の更新）
async updateValues(
  spreadsheetId: string,
  range: string,
  values: string[][]
): Promise<void>

// 最終行の次に行を追加
async appendValues(
  spreadsheetId: string,
  range: string,
  values: string[][]
): Promise<void>
```

3. **サービスアカウントの権限**: 対象スプレッドシートに編集者権限を付与済み ✅

## 7. エラーハンドリング

| エラーケース | 対処 |
|-------------|------|
| Google Sheetsへの書き込み失敗 | リトライ（3回）後、エラーログ出力。次回実行で再試行可能 |
| データベース接続エラー | リトライ（3回）後、エラーログ出力 |
| 該当日付の行がシートに存在しない | 新規行として追加 |
| 出稿数・停止数が両方0 | 0として記録する（データの欠損と区別するため） |
| 同日に重複実行された場合 | 既存行を上書き更新（冪等性を保証） |

## 8. 確認事項

- [x] 日中CPA最適化の停止数は含めない → **予算最適化の停止数のみ**
- [x] 対象アカウント → **AI_1, AI_2, AI_3, スキルプラス1, スキルプラス2 の5アカウント**
- [x] ヘッダー行あり → **データは2行目から**
- [x] サービスアカウントの編集権限 → **付与済み**
- [ ] スキルプラス2（`7592868952431362066`）がEntity Sync対象に含まれているか（OAuthトークン登録・Advertiserレコード作成が必要な場合あり）

## 9. 将来的な拡張性

- アカウント別の出稿数・停止数の内訳記録
- 週次・月次のサマリー自動生成
- Slack通知との連携
