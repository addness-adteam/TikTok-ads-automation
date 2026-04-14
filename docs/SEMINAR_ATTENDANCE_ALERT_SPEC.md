# セミナー着座CPOアラート機能 要件定義書

作成日: 2026-04-14
作成者: Claude (TikTok広告運用自動化)
方針: DDD + TDD

---

## 1. 目的・背景

TikTok広告のスキルプラス(セミナー)導線で、**配信開始から5日経過した広告のうち、セミナー着座CPOが月次KPIの許容値を超えているもの**を検知し、AI秘書LINEに通知する。

現状は手動でLステップからCSVをDLして着座者を集計、スプシと照合している。この工程を自動化し、不採算CRを早期に運用から除外する判断を支援する。

---

## 2. 用語定義

| 用語 | 定義 |
|---|---|
| **セミナー着座** | Lステップで「ウェビナー①_着座（滞在率25%以上）」タグがついた予約者 |
| **セミナー着座CPO** | 広告費 ÷ セミナー着座者数 |
| **予約者** | 予約者アンケートシートに回答した人 |
| **CR** | クリエイティブ（例: CR01200）。ad.name内の `LP{n}-CR{NNNNN}` 部分から抽出 |
| **配信期間** | 広告の配信開始日から現在日時点までの日数（JST） |
| **許容CPO** | 数値管理シートの当月行に記載された月次KPI値 |

---

## 3. スコープ

### In Scope
- スキルプラス(SEMINAR)導線のみ
  - 対象アカウント: SP1 (7474920444831875080), SP2 (7592868952431362066), SP3 (7616545514662051858)
- 広告単位での判定（同一CRが複数広告にまたがっていても個別に判定）
- Lステップからの着座CSV自動取得（ブラウザ自動操作）
- LINE (AI秘書)への通知
- 1日1回 11:00 JST 実行（GitHub Actions）

### Out of Scope
- AI / SNS 導線の同機能（スキルプラスのみ）
- オートリアクション（停止・予算変更などの自動アクション）
- 過去遡及の再集計

---

## 4. ビジネスルール

### 4.1 アラート発火条件（AND）
1. 対象アカウント（SP1/SP2/SP3）配下の広告であること
2. **配信開始日から5日以上経過**している
3. 以下いずれか満たす:
   - **(a) 着座あり: セミナー着座CPO > 当月許容CPO**
   - **(b) 着座0件: 広告費 ≥ 当月許容CPO**（許容値分使って1件も着座出ていない）
4. 同一広告に対して**過去に一度もアラート未送信**（重複抑止）

### 4.2 セミナー着座CPO計算
```
セミナー着座CPO = 広告の累計広告費 ÷ 広告経由の着座者数
```

- **広告費**: `Metric` テーブルの対象広告 × 全期間の spend 合計
- **着座者数**: 予約者アンケートの「メアド」が、Lステップ着座CSVの「メアド」に一致し、**かつ**当該広告の LP-CR コードが予約経路に含まれる件数
- **予約経路の突合**: 予約者のメアドを**オプトシート**(`APPEAL_SEMINAR_CV_SPREADSHEET_ID`等)の `登録元ページURL` と照合し、LP-CRコードを特定
  - **同メアドが複数回オプト登録している場合**: **回答日時(アクション実行日時)が最新の行**のLP-CRを採用
  - LP-CR を保持する広告tiktokIdに紐付け

### 4.3 許容CPO取得
- 数値管理シート: `1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA`
- シート: `スキルプラス（オートウェビナー用）`
- 月行（例: 2026/04の行）× KPI列の中から「セミナー着座CPO」の数値を取得
- **実装時に要確認**: 具体的な行番号・列番号。初回実装時にヘッダー走査で自動特定

### 4.4 配信開始日の取得
- **`AdGroup.schedule.startTime` を優先**（予約入稿を考慮、実配信日基準で正確）
- schedule.startTime が null / 不正の場合は `Ad.createdAt` にフォールバック
- JST変換して日付比較

### 4.5 重複抑止
- 通知済み広告を記録する新テーブル `SeminarAttendanceAlert` を追加
- キー: `adId + alertDate`（日次判定）
- 同一広告に対して1回送信したら以降は判定スキップ

---

## 5. ドメインモデル（DDD）

### 5.1 境界づけられたコンテキスト
**SeminarAttendanceAlerting** (セミナー着座CPO監視)

### 5.2 集約ルート・エンティティ・値オブジェクト

```
集約: SeminarAttendanceAlertEvaluation
  ├─ Entity: AdUnderEvaluation
  │    - adId: string (tiktokId)
  │    - adName: string
  │    - advertiserId: string
  │    - lpCrCode: string (例: LP2-CR00500)
  │    - deliveryStartDate: Date
  │    - totalSpend: JPY (VO)
  │    - attendanceCount: number
  │    - seminarSeatCpo: JPY (VO, spend / attendanceCount)
  │
  ├─ VO: AllowableSeminarSeatCpo (月次許容値)
  │    - month: YearMonth
  │    - amount: JPY
  │
  ├─ VO: DeliveryPeriod
  │    - startDate: Date
  │    - evaluationDate: Date
  │    - elapsedDays: number
  │    - isLongEnough(): boolean (≥5日)
  │
  └─ VO: AlertDecision
      - shouldAlert: boolean
      - reason: string (「配信5日超過かつCPO超過」等)

Repository: AlertHistoryRepository (通知済み記録の永続化)
```

### 5.3 ドメインサービス
- `AdAttendanceCountService`: 予約者アンケート × オプトシート × Lステップ着座CSV を突合して広告×着座数を算出
- `AllowableCpoResolver`: 数値管理シートから当月の許容CPOを解決
- `AlertRuleEvaluator`: ビジネスルール適用 → `AlertDecision` を返す

### 5.4 インフラ
- `LStepScraper` (Playwright) — Lステップにログインして着座CSVをDL
- `GoogleSheetsReader` — 既存 `GoogleSheetsService` を拡張
- `LineNotifier` — 既存のAI秘書LINE通知経路を再利用
- `AlertHistoryRepository` (Prisma) — 新テーブル `SeminarAttendanceAlert`

---

## 6. データフロー

```
[GitHub Actions 11:00 JST]
    ↓
[1] LStepScraper.fetchAttendanceCsv() → 着座メアドリスト
    - login (メアド / パス / "機械じゃない"チェック)
    - 友だちリスト → CSV操作 → CSVエクスポート
    - 「ID・表示名・LINE登録名」+「ウェビナー①_着座」タグ指定
    - CSV DL
    ↓
[2] GoogleSheetsReader.readReservationSurvey() → 予約者メアドリスト
    - シート: 1iKwplhJwldYqnr89NFoF5z3WS4GqnFVKBNfOdTZMF9c
    - B列(回答日時), D列(回答者名), H列(メアド)
    ↓
[3] GoogleSheetsReader.readOptPaths() → メアド→LP-CRマップ
    - シート: APPEAL_SEMINAR_CV_SPREADSHEET_ID / TT_オプト
    ↓
[4] AdAttendanceCountService.compute()
    - 予約者 ∩ 着座者(by メアド) → 着座予約者リスト
    - 着座予約者 → LP-CR(オプトシートの登録元URLから)
    - LP-CR → 広告tiktokId (DB Ad.name 検索)
    - 集計: adId → attendanceCount
    ↓
[5] AllowableCpoResolver.resolve(今月) → 許容CPO
    - 数値管理シート / スキルプラス（オートウェビナー用）
    ↓
[6] AlertRuleEvaluator.evaluate(eachAd)
    - 配信5日経過 AND CPO > 許容 AND 未通知
    ↓
[7] 対象広告に対して LineNotifier.notify() + 履歴保存
```

---

## 7. 通知フォーマット（LINE AI秘書）

```
⚠️ セミナー着座CPOアラート

📢 広告: 260404/横展開/CR454_横展開/LP2-CR00500
🏢 アカウント: SP1
📅 配信期間: 4/8開始 (6日経過)
💰 広告費: ¥52,000
👥 予約: 12件
🪑 着座: 3件
📊 実CPO: ¥17,333
🎯 当月許容CPO: ¥15,000 (超過率 115.5%)

→ 手動で状況確認の上、停止判断を推奨
```

---

## 8. 新テーブル (Prisma)

```prisma
model SeminarAttendanceAlert {
  id            String   @id @default(cuid())
  adTiktokId    String
  adName        String
  advertiserId  String
  alertedAt     DateTime @default(now())
  deliveryDays  Int
  totalSpend    Int
  reservationCount Int
  attendanceCount  Int
  actualCpo     Int
  allowableCpo  Int
  overageRate   Float    // 実CPO / 許容CPO

  @@unique([adTiktokId])  // 1広告1アラート（重複抑止）
  @@index([alertedAt])
}
```

---

## 9. テスト戦略（TDD）

### 9.1 単体テスト (ドメイン層)
- `DeliveryPeriod.isLongEnough` : 4日→false / 5日→true
- `AlertRuleEvaluator.evaluate` :
  - CPO超過 + 5日未満 → false
  - CPO超過 + 5日以上 + 未通知 → true
  - CPO超過 + 5日以上 + 通知済み → false
  - CPO内 + 5日以上 → false
  - 着座0件 + spend ≥ 許容CPO + 5日以上 → true
  - 着座0件 + spend < 許容CPO + 5日以上 → false（まだ予算消化不十分）
- `AllowableSeminarSeatCpo` 計算ロジック

### 9.2 Infra層テスト
- `LStepScraper.fetchAttendanceCsv` : モックHTMLでパース可能か
- `GoogleSheetsReader` : 固定サンプルスプシで列解釈が正しいか
- `AlertHistoryRepository` : 重複防止のunique制約動作

### 9.3 結合テスト
- フィクスチャ広告×フィクスチャ着座CSV×モック許容CPO で E2E 1回走らせる
- dry-run モード (DB書き込み・LINE送信をスキップ) で安全確認

### 9.4 手動確認
- 実LステップログインのsmokeTest（1回）
- 初回実行は dry-run で通知内容を目視確認後、本番配信

---

## 10. 非機能要件

| 項目 | 要件 |
|---|---|
| 実行環境 | GitHub Actions (Node.js + Playwright) |
| 実行時刻 | 毎日 11:00 JST (= UTC 02:00) |
| タイムアウト | Lステップスクレイピング 3分、全体10分 |
| シークレット | GitHub Secrets: `LSTEP_EMAIL`, `LSTEP_PASSWORD` |
| ログ保持 | GitHub Actionsデフォルト (90日) |
| 失敗通知 | Jobが失敗したらAI秘書LINEに失敗通知送信 |

---

## 11. 実装順序（TDDサイクル）

1. **ドメイン層**
   - [ ] VO `AllowableSeminarSeatCpo` / `DeliveryPeriod` / `JPY` 実装 + テスト
   - [ ] Entity `AdUnderEvaluation` 実装 + テスト
   - [ ] `AlertRuleEvaluator` 実装 + テスト (ビジネスルール全組合せ)

2. **インフラ層**
   - [ ] `GoogleSheetsReader` 拡張（数値管理シート、予約者アンケート読取）+ テスト
   - [ ] `LStepScraper` (Playwright) 実装 + スモークテスト
   - [ ] Prismaマイグレーション `SeminarAttendanceAlert`
   - [ ] `AlertHistoryRepository` + テスト
   - [ ] `LineNotifier` 既存再利用ラッパー

3. **アプリ層**
   - [ ] `AdAttendanceCountService`（突合ロジック）+ テスト
   - [ ] `SeminarAttendanceAlertUseCase`（ユースケース）+ テスト

4. **エンドポイント & ジョブ**
   - [ ] NestJS エンドポイント `POST /jobs/seminar-attendance-alert` (手動実行用)
   - [ ] GitHub Actions ワークフロー `seminar-attendance-alert.yml`

5. **リリース**
   - [ ] dry-run で1回検証
   - [ ] 本番有効化

---

## 12. 未確定事項（実装時に要確認）

| 項目 | 解決方法 |
|---|---|
| 数値管理シート内 月次KPI の行・列位置 | 実装初期にシート実物を走査して自動特定ロジックを書く |
| 予約者アンケートシートのタブ名 | 実装時にlistSheetsで確認 |
| ~~広告の「配信開始日」の採用基準~~ | **決定済**: AdGroup.schedule.startTime 優先、null時Ad.createdAtフォールバック |
| Lステップスクレイピングのセレクタ | 実装時に実画面で特定 |
| Playwright on GitHub Actions のheadlessモード動作確認 | スモークテストで確認 |

---

## 13. リスク・考慮事項

- **Lステップ側のUI変更**: セレクタが変わるとスクレイピングが壊れる。失敗時に明確なエラーログ + LINE通知で早期検知
- **reCAPTCHA化のリスク**: 現状「機械じゃない」チェックボックスだが、将来reCAPTCHA v2/v3化されると自動化困難に。ユーザーに手動介入依頼する運用切替が必要
- **メアド突合の取りこぼし**: 予約者アンケートとLステップでメアドの大文字小文字・全半角が異なる場合。正規化処理必須
- **LP-CR → 広告tiktokId の多対多**: 同じLP-CRコードが複数アカウントの複数広告で使われている。アカウント絞込(SP1/SP2/SP3のみ)で多くは解消されるが、同アカ内でも複数広告あり得る → CR単位でなく**ad.name部分一致**で引き当てて広告単位で按分
- ~~**按分ロジック**~~: **決定済**: 1予約者の複数オプト登録は**最新の登録経路(アクション実行日時が最も新しい行)**のLP-CRを採用。按分しない。

---

## 14. 参考

- 既存メモ: `feedback_seminar_attendance_cpo_method.md` (従来の手動計算方法)
- 既存スクリプト: `apps/backend/sp-seminar-cpo.ts`（近い処理あり、要確認）
- 既存の LINE 通知ルート: `src/notifications/ai-secretary.service.ts`（推定、実装時要確認）
