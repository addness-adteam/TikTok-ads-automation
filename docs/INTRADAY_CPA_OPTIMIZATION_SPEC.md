# 日中CPA最適化機能 要件定義書

## 1. 概要

### 1.1 目的
LPのCVRの日ブレによるCPA悪化を防ぐため、日中（15時時点）での当日CPAをチェックし、パフォーマンスに応じて配信制御を行う。

### 1.2 背景
- 現行システムは過去7日間の累積データを基に判断
- 当日のCVRが極端に悪化してもリアルタイムで対応できない
- 結果として1日分の予算が無駄になるリスクがある

---

## 2. 機能要件

### 2.1 日中CPAチェック（15:00実行）

#### 2.1.1 判定ロジック

| 条件 | アクション |
|------|----------|
| 当日CPA ≤ 目標CPA | 配信継続（何もしない） |
| 目標CPA < 当日CPA ≤ 許容CPA | 予算50%削減 |
| 当日CPA > 許容CPA | 配信停止 |
| 当日CPA = 0（CV未発生） | 別途判定（後述） |

#### 2.1.2 CV未発生時の判定（当日CV=0の場合）

前日のCPAを参照し、以下のロジックで判定する：

| 前日CPA | アクション | 理由 |
|--------|----------|------|
| 前日CPA = 0（前日もCV未発生） | 配信継続 | 元々CVが発生しにくい広告なので、当日だけで判断しない |
| 前日CPA ≥ 1（前日はCV発生） | 配信停止 | 昨日はCVがあったのに今日はゼロ＝CVR悪化の兆候 |

**判定フロー図**:
```
当日CV = 0?
├─ Yes → 前日CPA確認
│        ├─ 前日CPA = 0 → 配信継続（元々CVが少ない広告）
│        └─ 前日CPA ≥ 1 → 配信停止（CVR悪化の兆候）
└─ No  → 通常判定（2.1.1参照）
```

#### 2.1.3 対象広告
- 配信中（status = 'ENABLE'）の広告のみ
- 広告名フォーマット（`日付/制作者/CR名/LP名`）が正しい広告のみ
- Smart+広告も対象に含める

### 2.2 深夜配信再開（23:59実行）

#### 2.2.1 再開対象
- **15時のチェックで停止した広告のみ**を再開
- 既存の最適化ロジック（過去7日間基準）で停止した広告は再開**しない**

#### 2.2.2 再開理由
- 翌日のCVR回復を見越して配信再開
- 深夜帯は配信量が少ないため、リスク限定的

### 2.3 予算復元（翌0:00実行）

#### 2.3.1 復元対象
- **15時のチェックで予算50%削減した広告**の予算を元に戻す

#### 2.3.2 復元ロジック
- `IntradayBudgetReductionLog`に記録された`originalBudget`に復元
- 復元後、ログの`restored`フラグをtrueに更新

---

## 3. データ要件

### 3.1 新規テーブル: IntradayPauseLog

15時に停止した広告を追跡し、23:59に再開するためのログテーブル

```prisma
model IntradayPauseLog {
  id              String    @id @default(uuid())
  adId            String                          // 広告ID（TikTok ID）
  advertiserId    String                          // 広告主ID
  pauseDate       DateTime                        // 停止日（日付のみ、時刻は00:00:00）
  pauseTime       DateTime                        // 停止実行時刻
  pauseReason     String                          // 停止理由（CPA_EXCEEDED, NO_CV_WITH_PREVIOUS_CV等）
  todaySpend      Float                           // 停止時点の当日消化額
  todayCPA        Float?                          // 停止時点の当日CPA（CV=0の場合null）
  yesterdayCPA    Float?                          // 前日CPA（CV=0判定時の参考）
  targetCPA       Float                           // 目標CPA（参考用）
  allowableCPA    Float                           // 許容CPA（参考用）
  resumed         Boolean   @default(false)       // 再開済みフラグ
  resumeTime      DateTime?                       // 再開実行時刻
  createdAt       DateTime  @default(now())

  @@index([pauseDate, resumed])
  @@index([adId, pauseDate])
  @@map("intraday_pause_logs")
}
```

### 3.2 新規テーブル: IntradayBudgetReductionLog

15時に予算削減した広告を追跡し、翌0:00に復元するためのログテーブル

```prisma
model IntradayBudgetReductionLog {
  id              String    @id @default(uuid())
  adgroupId       String                          // 広告セットID（TikTok ID）
  campaignId      String?                         // キャンペーンID（CBO時）
  advertiserId    String                          // 広告主ID
  reductionDate   DateTime                        // 削減日（日付のみ、時刻は00:00:00）
  reductionTime   DateTime                        // 削減実行時刻
  originalBudget  Float                           // 削減前の予算
  reducedBudget   Float                           // 削減後の予算（50%）
  reductionRate   Float     @default(0.5)         // 削減率
  isCBO           Boolean   @default(false)       // CBO（キャンペーン予算）かどうか
  restored        Boolean   @default(false)       // 復元済みフラグ
  restoreTime     DateTime?                       // 復元実行時刻
  createdAt       DateTime  @default(now())

  @@index([reductionDate, restored])
  @@index([adgroupId, reductionDate])
  @@map("intraday_budget_reduction_logs")
}
```

### 3.3 当日メトリクス取得

15時時点で当日のメトリクスを取得するため、TikTok APIを呼び出す

- **取得期間**: 当日のみ（startDate = endDate = 今日）
- **データレベル**: `AUCTION_AD`
- **取得項目**: `spend`, `impressions`, `clicks`

**注意**: TikTok APIのメトリクスは数時間の遅延がある可能性があるため、15時時点では12〜13時頃までのデータが反映されている想定

### 3.4 CV数の取得

**Google Sheetsから取得（既存方式を使用）**

- 登録経路（`TikTok広告-{訴求名}-{LP名}`）でフィルタして当日CV数を取得
- 既存の`googleSheetsService.getCVCount()`を使用
- 当日データ取得用に期間を当日のみに設定

**取得するCV数**:
- **当日CV数**: 15時時点での当日のCV数
- **前日CV数**: CV未発生時の判定用に前日のCV数も取得

---

## 4. 処理フロー

### 4.1 15:00 日中CPAチェックジョブ

```
@Cron('0 15 * * *', { timeZone: 'Asia/Tokyo' })
┌─────────────────────────────────────────────────────────────┐
│ 1. ロック取得 (intraday-cpa-check)                          │
├─────────────────────────────────────────────────────────────┤
│ 2. 全Advertiserループ                                        │
│    ├─ Appeal設定取得（targetCPA, allowableCPA）             │
│    ├─ 当日メトリクス取得 (TikTok API: spend)                 │
│    ├─ 当日・前日CV数取得 (Google Sheets)                     │
│    ├─ 配信中広告ごとにループ                                 │
│    │   ├─ 当日CPA計算（spend / CV数）                       │
│    │   ├─ CV=0の場合、前日CPA確認                           │
│    │   ├─ 判定ロジック実行                                   │
│    │   ├─ PAUSE → pauseAd() + IntradayPauseLog記録          │
│    │   └─ REDUCE_BUDGET → reduceBudget(50%)                  │
│    │       + IntradayBudgetReductionLog記録                  │
│    └─ 結果ログ出力                                           │
├─────────────────────────────────────────────────────────────┤
│ 3. ロック解放                                                │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 23:59 深夜配信再開ジョブ

```
@Cron('59 23 * * *', { timeZone: 'Asia/Tokyo' })
┌─────────────────────────────────────────────────────────────┐
│ 1. ロック取得 (intraday-resume)                              │
├─────────────────────────────────────────────────────────────┤
│ 2. IntradayPauseLogから本日停止&未再開の広告を取得           │
│    WHERE pauseDate = today AND resumed = false               │
├─────────────────────────────────────────────────────────────┤
│ 3. 各広告に対して                                            │
│    ├─ resumeAd() 実行 (updateAdStatus → 'ENABLE')           │
│    ├─ IntradayPauseLog更新 (resumed=true, resumeTime=now)   │
│    └─ ChangeLog記録                                          │
├─────────────────────────────────────────────────────────────┤
│ 4. ロック解放                                                │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 0:00 予算復元ジョブ

```
@Cron('0 0 * * *', { timeZone: 'Asia/Tokyo' })
┌─────────────────────────────────────────────────────────────┐
│ 1. ロック取得 (intraday-budget-restore)                      │
├─────────────────────────────────────────────────────────────┤
│ 2. IntradayBudgetReductionLogから前日削減&未復元を取得       │
│    WHERE reductionDate = yesterday AND restored = false      │
├─────────────────────────────────────────────────────────────┤
│ 3. 各広告セット/キャンペーンに対して                         │
│    ├─ isCBO = true → updateCampaignBudget(originalBudget)   │
│    ├─ isCBO = false → updateAdGroupBudget(originalBudget)   │
│    ├─ Log更新 (restored=true, restoreTime=now)              │
│    └─ ChangeLog記録                                          │
├─────────────────────────────────────────────────────────────┤
│ 4. ロック解放                                                │
└─────────────────────────────────────────────────────────────┘
```

**注意**: このジョブは既存の`daily-entity-sync`（0:00実行）の**前**に実行する必要があるため、実際には`23:59:30`などに設定するか、`daily-entity-sync`の先頭で呼び出す形にする

---

## 5. 既存システムとの整合性

### 5.1 既存最適化ロジックとの棲み分け

| 機能 | 実行時刻 | 判定期間 | 停止した広告の扱い | 予算変更の扱い |
|------|---------|---------|------------------|---------------|
| 日中CPAチェック（新規） | 15:00 | 当日（〜15時） | 23:59に自動再開 | 翌0:00に自動復元 |
| 既存最適化 | 手動実行 | 過去7日間累積 | 手動再開が必要 | そのまま維持 |

### 5.2 停止判定の優先度

1. 既存最適化で停止された広告 → 日中チェックの対象外（既に停止中）
2. 日中チェックで停止 → 23:59に自動再開
3. 翌日の既存最適化で再度判定 → 必要に応じて停止

### 5.3 予算変更の競合回避

**予算削減時**:
- 日中チェックで予算50%削減 → `IntradayBudgetReductionLog`に元予算を記録
- 既存最適化の予算増額判定時:
  - 日中削減されていた場合 → **スキップ**（翌日復元後に判定）
  - `IntradayBudgetReductionLog`で`reductionDate = today AND restored = false`をチェック

**予算復元時**:
- 翌0:00に`originalBudget`に復元
- 復元後は通常どおり既存最適化の対象となる

### 5.4 DryRunモード対応

既存のdryRunモードと同様に、実際のAPI呼び出しを行わずにログのみ出力するモードを実装

---

## 6. 通知要件

### 6.1 新規通知タイプ

| タイプ | トリガー | 重要度 |
|-------|---------|-------|
| `INTRADAY_CPA_PAUSE` | 15時に配信停止した場合 | WARNING |
| `INTRADAY_BUDGET_REDUCED` | 15時に予算50%削減した場合 | INFO |
| `INTRADAY_RESUMED` | 23:59に配信再開した場合 | INFO |
| `INTRADAY_BUDGET_RESTORED` | 翌0:00に予算復元した場合 | INFO |

### 6.2 通知メッセージ例

**INTRADAY_CPA_PAUSE（CPA超過）**:
```
広告「241201/田中/SNS訴求CR01/LP-A」を一時停止しました
当日CPA: ¥8,500（許容CPA: ¥6,000を超過）
23:59に自動再開予定
```

**INTRADAY_CPA_PAUSE（CV未発生・前日CVあり）**:
```
広告「241201/田中/SNS訴求CR01/LP-A」を一時停止しました
当日CV: 0件（前日CPA: ¥4,200 → CVR悪化の兆候）
23:59に自動再開予定
```

**INTRADAY_BUDGET_REDUCED**:
```
広告「241201/田中/SNS訴求CR01/LP-A」の予算を50%削減しました
当日CPA: ¥5,200（目標CPA: ¥4,000超過、許容CPA: ¥6,000以内）
現在予算: ¥50,000 → ¥25,000
翌0:00に自動復元予定
```

**INTRADAY_BUDGET_RESTORED**:
```
広告「241201/田中/SNS訴求CR01/LP-A」の予算を復元しました
予算: ¥25,000 → ¥50,000（元の予算に復元）
```

---

## 7. 設定・環境変数

### 7.1 フィーチャーフラグ

```env
# 日中CPAチェック機能の有効化
FEATURE_INTRADAY_CPA_CHECK_ENABLED=true

# 予算削減率（デフォルト50%）
INTRADAY_BUDGET_REDUCTION_RATE=0.5
```

### 7.2 除外設定

特定のAdvertiserを日中チェックから除外する機能

```env
# 除外する広告主ID（カンマ区切り）
INTRADAY_EXCLUDED_ADVERTISERS=7543540100849156112,7543540647266074641
```

---

## 8. ログ・監査

### 8.1 ChangeLogへの記録

既存の`ChangeLog`テーブルに記録

| action | source | 説明 |
|--------|--------|------|
| `INTRADAY_PAUSE` | `INTRADAY_OPTIMIZATION` | 15時停止 |
| `INTRADAY_RESUME` | `INTRADAY_OPTIMIZATION` | 23:59再開 |
| `INTRADAY_BUDGET_REDUCE` | `INTRADAY_OPTIMIZATION` | 予算50%削減 |
| `INTRADAY_BUDGET_RESTORE` | `INTRADAY_OPTIMIZATION` | 翌0:00予算復元 |

### 8.2 ログ出力例

```
[15:00:05] Starting intraday CPA check job
[15:00:06] Checking advertiser: 7543540647266074641 (AI訴求)
[15:00:07] Ad 1849212350625266: todayCV=0, yesterdayCPA=4200 → PAUSE (CVR悪化の兆候)
[15:00:08] Ad 1849212350625267: todayCPA=8500, allowableCPA=6000 → PAUSE (CPA超過)
[15:00:09] Ad 1849212350625268: todayCPA=5200, targetCPA=4000, allowableCPA=6000 → REDUCE_BUDGET
[15:00:10] Ad 1849212350625269: todayCV=0, yesterdayCPA=0 → CONTINUE (元々CVが少ない)
[15:00:11] Intraday CPA check completed. Paused: 2, Reduced: 1, Continued: 47
```

---

## 9. エラーハンドリング

### 9.1 エラーコード

| コード | 説明 | 対応 |
|-------|------|------|
| `IC-01` | 当日メトリクス取得失敗 | 該当Advertiserをスキップ、次へ進む |
| `IC-02` | Google Sheets CV取得失敗 | 該当Advertiserをスキップ、次へ進む |
| `IC-03` | 広告停止API失敗 | リトライ（3回）、失敗時は通知生成 |
| `IC-04` | IntradayPauseLog記録失敗 | ログ出力のみ（停止処理は続行） |
| `IR-01` | 再開対象取得失敗 | ジョブ全体を中断 |
| `IR-02` | 広告再開API失敗 | リトライ（3回）、失敗時は通知生成 |
| `IB-01` | 復元対象取得失敗 | ジョブ全体を中断 |
| `IB-02` | 予算復元API失敗 | リトライ（3回）、失敗時は通知生成 |

### 9.2 リトライ戦略

- TikTok API呼び出し: 3回リトライ、指数バックオフ（1秒、2秒、4秒）
- Google Sheets API呼び出し: 3回リトライ
- データベース操作: 既存の`withDatabaseRetry`を使用

---

## 10. テスト要件

### 10.1 単体テスト

- [ ] 当日CPA計算ロジック
- [ ] 判定ロジック（目標CPA以下、許容CPA以下、超過）
- [ ] CV未発生時の判定ロジック（前日CPAによる分岐）
- [ ] IntradayPauseLog記録・取得
- [ ] IntradayBudgetReductionLog記録・取得

### 10.2 統合テスト

- [ ] 15時ジョブの正常実行
- [ ] 23:59ジョブの正常実行
- [ ] 0:00予算復元ジョブの正常実行
- [ ] 停止→再開の一連の流れ
- [ ] 予算削減→復元の一連の流れ
- [ ] DryRunモードでの動作確認

### 10.3 エッジケース

- [ ] 対象広告がゼロの場合
- [ ] 全広告が既に停止中の場合
- [ ] メトリクス遅延で当日データがない場合
- [ ] Google Sheetsにデータがない場合
- [ ] 前日データがない広告（新規広告）の場合
- [ ] 15時ジョブ実行中に23:59を迎えた場合（ロック競合）

---

## 11. 実装ファイル構成（予定）

```
apps/backend/src/
├── intraday-optimization/
│   ├── intraday-optimization.module.ts
│   ├── intraday-optimization.service.ts    # メインロジック
│   ├── intraday-optimization.scheduler.ts  # Cronジョブ定義
│   └── dto/
│       └── intraday-check-result.dto.ts
├── prisma/
│   └── schema.prisma                       # IntradayPauseLog, IntradayBudgetReductionLog追加
└── jobs/
    └── scheduler.service.ts                # 既存（変更なし）
```

---

## 12. 実装優先度

### Phase 1（MVP）
1. IntradayPauseLog / IntradayBudgetReductionLog テーブル作成
2. 15:00ジョブ実装（停止のみ）
3. 23:59ジョブ実装（再開）

### Phase 2
4. 予算50%削減ロジック追加
5. 0:00予算復元ジョブ実装
6. 通知機能追加

### Phase 3
7. DryRunモード対応
8. 除外Advertiser設定
9. 設定のUI化（フロントエンド）
10. レポート・ダッシュボード

---

## 13. 決定事項

| 項目 | 決定内容 |
|------|---------|
| CV取得方式 | **Google Sheets**（既存方式を使用） |
| CV未発生時の停止判定 | **前日CPA ≥ 1 なら停止、前日CPA = 0 なら継続** |
| 再開時刻 | **23:59** |
| 予算削減後の翌日処理 | **翌0:00に元の予算に自動復元** |

---

## 付録: 既存システムとの関連図

```
┌─────────────────────────────────────────────────────────────────────┐
│                      日次処理タイムライン                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  0:00  ──┬── 【新規】intraday-budget-restore（予算復元）           │
│          │   └── 前日15時に削減した予算を元に戻す                   │
│          │                                                          │
│  0:00  ──┼── daily-entity-sync（広告データ同期）                    │
│          │                                                          │
│  0:05  ──┼── daily-report-fetch（過去7日メトリクス取得）            │
│          │   └── AdPerformance分析                                  │
│          │                                                          │
│ 〜14:59  │   ※既存の手動最適化実行可能時間帯                       │
│          │                                                          │
│  15:00 ──┼── 【新規】intraday-cpa-check                            │
│          │   ├── 当日メトリクス取得（TikTok API）                   │
│          │   ├── 当日・前日CV数取得（Google Sheets）                │
│          │   ├─ CPA判定                                            │
│          │   │   ├─ CPA > 許容CPA → 停止                           │
│          │   │   ├─ 目標CPA < CPA ≤ 許容CPA → 予算50%削減          │
│          │   │   ├─ CV=0 & 前日CPA≥1 → 停止                        │
│          │   │   └─ CV=0 & 前日CPA=0 → 継続                        │
│          │   └── ログ記録                                           │
│          │                                                          │
│ 15:01〜  │   ※停止広告は配信停止中、削減広告は50%予算で配信        │
│          │                                                          │
│  23:59 ──┴── 【新規】intraday-resume                               │
│              ├── 15時停止広告を再開                                 │
│              └── IntradayPauseLog更新                               │
│                                                                     │
│  翌0:00  ── （次の日次処理サイクル開始 → 予算復元から）            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 14. 既存システムへの影響分析

### 14.1 影響なし（完全に独立）

| 既存機能 | 理由 |
|---------|------|
| daily-entity-sync (0:00) | 広告データ同期のみ、判定ロジックなし |
| daily-report-fetch (0:05) | メトリクス取得のみ、判定ロジックなし |
| AdPerformance分析 | CPA乖離検出のみ、配信制御なし |
| 上限日予算機能 (AdBudgetCap) | 予算増額時のみ適用、日中チェックとは独立 |
| 通知システム (Notification) | 既存の仕組みをそのまま利用 |
| ChangeLog記録 | 既存の仕組みをそのまま利用 |

### 14.2 競合リスクと対策

#### 競合1: 0:00の予算復元とdaily-entity-sync

| 項目 | 内容 |
|-----|------|
| **リスク** | 両ジョブが0:00に同時実行され、予算復元前にentity-syncが走る可能性 |
| **対策** | 予算復元ジョブを`23:59:30`に設定し、0:00のdaily-entity-syncより先に完了させる |
| **代替案** | daily-entity-syncの先頭で予算復元処理を呼び出す |

#### 競合2: 既存の手動最適化との予算変更競合

| 項目 | 内容 |
|-----|------|
| **リスク** | 15時に予算50%削減後、ユーザーが既存最適化を手動実行した場合、削減後の予算で判定される |
| **対策** | **運用ルールで対応**（15:00〜翌0:00は手動最適化を実行しない） |

#### 競合3: 広告再開の競合（既存停止 vs 日中停止）

| 項目 | 内容 |
|-----|------|
| **リスク** | 既存最適化で停止した広告を23:59に誤って再開してしまう |
| **対策** | `IntradayPauseLog`に記録された広告**のみ**を再開対象とする設計により回避済み |
| **確認事項** | 23:59の再開ジョブはIntradayPauseLogのみを参照し、広告テーブルのstatusは見ない |

#### 競合4: ロック機構の競合

| 項目 | 内容 |
|-----|------|
| **リスク** | 複数ジョブが同時実行されてAPIレート制限に達する |
| **対策** | 各ジョブに専用のロック名を使用（既存の`batchJobLock`を使用） |

```typescript
// 新規ジョブのロック名（既存と重複しない）
'intraday-cpa-check'      // 15:00
'intraday-resume'         // 23:59
'intraday-budget-restore' // 23:59:30（または0:00直前）
```

### 14.3 運用ルール

日中CPA最適化機能を運用する上でのルール：

| ルール | 内容 |
|-------|------|
| **手動最適化の実行時間** | 15:00〜翌0:00の間は手動最適化を実行しない |
| **理由** | 日中チェックで予算削減された広告セットに対して、手動最適化が予算を変更してしまうことを防ぐため |

### 14.4 既存機能への影響サマリー

| 機能 | 影響 | 対応 |
|------|------|------|
| 日次同期ジョブ | なし | - |
| 手動最適化 | なし | 運用ルールで対応 |
| 上限日予算 | なし | - |
| 通知 | なし（追加のみ） | - |
| ChangeLog | なし（追加のみ） | - |
| Google Sheets連携 | なし（既存を使用） | - |
| TikTok API連携 | なし（既存を使用） | - |

**既存コードの修正は不要です。**

### 14.5 ロールバック手順

機能に問題が発生した場合のロールバック：

1. **即座停止**: 環境変数 `FEATURE_INTRADAY_CPA_CHECK_ENABLED=false` に設定
2. **Cronジョブ停止**: scheduler.service.ts の該当@Cronをコメントアウト
3. **予算復元**: IntradayBudgetReductionLogから`restored=false`のレコードを手動で復元
4. **広告再開**: IntradayPauseLogから`resumed=false`のレコードを手動で再開

```sql
-- 緊急時の手動復元クエリ例
UPDATE adgroups SET budget = (
  SELECT original_budget FROM intraday_budget_reduction_logs
  WHERE adgroup_id = adgroups.tiktok_id AND restored = false
) WHERE tiktok_id IN (
  SELECT adgroup_id FROM intraday_budget_reduction_logs WHERE restored = false
);
```

---

*作成日: 2025-12-27*
*バージョン: 1.3*
*更新: 既存コード修正を削除、運用ルールで対応に変更*
