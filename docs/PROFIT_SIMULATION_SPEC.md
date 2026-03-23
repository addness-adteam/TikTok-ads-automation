# 利益最大化シミュレーション＆ボトルネック特定 要件定義書

## 1. 概要

### 1.1 目的
中長期的に利益（粗利）を最大化するために、現状数値をスプレッドシートから取得し、月次利益のシミュレーション→目標到達判定→ボトルネック特定→TODO生成→自動実行を一気通貫で行う機能。

### 1.2 利益の定義
```
利益（粗利） = 着金売上 − 広告費
```
- **着金売上**: フロント商品 + 秘密の部屋（アップセル） + バックエンド商品のすべてを含む
- **広告費**: TikTok広告の消化金額（税抜）

### 1.3 設計方針
- **DDD（ドメイン駆動設計）**: ビジネスロジックをドメイン層に集約
- **TDD（テスト駆動開発）**: ドメインロジックをテストファーストで実装
- **既存の運用OSとの統合**: `daily-ops-todo.ts` / `daily-ops-rules.md` の拡張として位置づけ

---

## 2. ユースケースフロー

```
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: 現状数値取得（スプレッドシート）                        │
│   → 当月の日別実績を取得                                       │
├─────────────────────────────────────────────────────────────────┤
│ Step 2: 月次利益シミュレーション（日割り計算）                  │
│   → 当月実績から月末着地を推定                                 │
├─────────────────────────────────────────────────────────────────┤
│ Step 3: 目標到達判定                                           │
│   → 目標粗利に対して到達見込みがあるか判定                     │
├─────────────────────────────────────────────────────────────────┤
│ Step 4: 改善方向の判定                                         │
│   → ROASを上げるのか / 集客数を上げるのか / 両方か             │
├─────────────────────────────────────────────────────────────────┤
│ Step 5: 変数の洗い出し（導線ごと）                             │
│   → 選択した改善方向に応じて、操作可能な変数を列挙             │
├─────────────────────────────────────────────────────────────────┤
│ Step 6: ボトルネック特定                                       │
│   → 各変数の現状 vs KPI を比較し、最大乖離のステージを特定     │
├─────────────────────────────────────────────────────────────────┤
│ Step 7: TODO生成                                               │
│   → ボトルネックに対する具体的アクションを生成                 │
├─────────────────────────────────────────────────────────────────┤
│ Step 8: 承認フロー                                             │
│   → TODOをユーザーに提示し、承認/却下/FBを受け付ける           │
├─────────────────────────────────────────────────────────────────┤
│ Step 9: フィードバック→ナレッジ蓄積                            │
│   → 承認時の判断基準やFBをルールとして蓄積                     │
│   → TODO生成ロジックの精度を継続的に向上                       │
├─────────────────────────────────────────────────────────────────┤
│ Step 10: 実行                                                  │
│   → 承認されたTODOのうち自動実行可能なものを実行               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. ドメインモデル

### 3.1 導線別ファネルモデル（FunnelModel）

各導線はファネルステージの連鎖として定義される。ステージ間の転換率がボトルネック特定の対象。

#### AI導線（AI合宿）
```
広告表示 → クリック → オプトイン → フロント購入(¥2,980) → 秘密の部屋購入(¥9,800)
  → LINE登録 → 個別予約 → 個別着座 → バックエンド購入（成約）
```

#### SNS導線（ダイナマイト合宿）
```
広告表示 → クリック → オプトイン → フロント購入(¥2,980) → 秘密の部屋購入(¥9,800)
  → LINE登録 → 個別予約 → 個別着座 → バックエンド購入（成約）
```

#### スキルプラス導線（セミナー型）
```
広告表示 → クリック → オプトイン → LINE登録（リストイン）
  → セミナー予約 → セミナー着座 → 個別予約 → 個別着座 → バックエンド購入（成約）
```

**ドメインオブジェクト:**
```typescript
interface FunnelStage {
  name: string;               // ステージ名（例: 'オプトイン', 'フロント購入'）
  count: number;              // 当月実績数
  revenue?: number;           // そのステージで発生する売上（あれば）
}

interface FunnelModel {
  channelType: 'AI' | 'SNS' | 'SKILL_PLUS';
  stages: FunnelStage[];
  adSpend: number;            // 当月広告費
  totalRevenue: number;       // 当月着金売上（全ステージ合計）
}

// 転換率は隣接ステージ間で自動算出
// conversionRate = stages[i+1].count / stages[i].count
```

### 3.2 利益シミュレーション（ProfitSimulation）

日割り計算で月末着地を推定する。

```typescript
interface ProfitSimulation {
  channelType: 'AI' | 'SNS' | 'SKILL_PLUS';
  period: { year: number; month: number };

  // 実績（当月1日〜本日）
  actualDays: number;                  // 実績日数
  actualAdSpend: number;               // 実績広告費
  actualRevenue: number;               // 実績着金売上
  actualProfit: number;                // 実績粗利 = 着金売上 - 広告費

  // 推定（月末着地）
  totalDaysInMonth: number;            // 当月の総日数
  projectedAdSpend: number;            // 推定月末広告費
  projectedRevenue: number;            // 推定月末着金売上
  projectedProfit: number;             // 推定月末粗利

  // 目標との比較
  targetProfit: number;                // 目標粗利
  gapToTarget: number;                 // 目標との差分
  isOnTrack: boolean;                  // 到達見込みあり？
}
```

**日割り計算ロジック:**
```
推定月末値 = (実績値 / 実績日数) × 当月総日数
推定月末粗利 = 推定月末着金売上 − 推定月末広告費
到達見込み = 推定月末粗利 >= 目標粗利
```

**制約事項:**
- 月初（実績日数が少ない段階）は推定精度が低い。特に着金売上はラグが大きい（オプトから成約まで数週間〜1ヶ月）。
- 月初に個別予約CPOがゼロ近くや異常に高くなることがあるが、これはデータ不足によるもので正常。

**全導線サマリー:**
```typescript
interface TotalProfitSummary {
  period: { year: number; month: number };
  channels: ProfitSimulation[];         // AI, SNS, SKILL_PLUS 各導線
  totalActualProfit: number;            // 実績合計粗利
  totalProjectedProfit: number;         // 推定月末合計粗利
  totalTargetProfit: number;            // 目標合計粗利
  totalGapToTarget: number;             // 合計目標差分
  isOnTrack: boolean;                   // 全体として到達見込みあり？
}
```

### 3.3 改善方向の判定ロジック（ImprovementDirection）

目標未達の場合、ROASと集客数のどちらを改善すべきか判定する。

```typescript
type ImprovementDirection = 'ON_TRACK' | 'IMPROVE_ROAS' | 'INCREASE_ACQUISITION' | 'BOTH';

interface DirectionJudgment {
  direction: ImprovementDirection;
  reason: string;
  currentROAS: number;          // 現状ROAS = 着金売上 / 広告費
  targetROAS: number;           // 目標ROAS（目標粗利から逆算）
  currentAcquisition: number;   // 現状集客数（オプト数）
  requiredAcquisition: number;  // 目標達成に必要な集客数
}
```

**判定ロジック:**
```
ROAS = 着金売上 / 広告費

if (ROAS >= 目標ROAS && 集客数 >= 必要集客数):
  → ON_TRACK（目標到達見込み。現状維持）

if (ROAS < 目標ROAS && 集客数 < 必要集客数):
  → BOTH（ROASも集客数も不足）

if (ROAS < 目標ROAS && 集客数 >= 必要集客数):
  → IMPROVE_ROAS（集客は足りているがROASが低い = ファネル効率の問題）

if (ROAS >= 目標ROAS && 集客数 < 必要集客数):
  → INCREASE_ACQUISITION（ROASは健全だが量が足りない = スケーリングの問題）
```

**必要集客数（requiredAcquisition）の算出:**
```
オプト1件あたりの利益 = 単月オプトLTV − CPA
必要オプト数 = 目標粗利 / オプト1件あたりの利益
```
- 単月オプトLTV: スプシ AK列(AI/SNS) / AC列(SP) から取得
- CPA: スプシの当月実績から算出（広告費 / オプト数）

**目標ROASの算出:**
```
目標ROAS = (目標粗利 + 推定月末広告費) / 推定月末広告費
```

### 3.4 変数の洗い出し（VariableIdentification）

改善方向に応じて、操作可能な変数を導線ごとに列挙する。

#### ROAS改善の変数（ファネル効率）
導線ごとのステージ間転換率すべてが対象。

| 導線 | 変数（転換率） |
|------|---------------|
| **AI/SNS** | LP CVR（クリック→オプト）、オプト→フロント購入率、フロント→秘密の部屋購入率、LINE登録率、個別予約率、個別着座率、成約率 |
| **スキルプラス** | LP CVR（クリック→オプト）、オプト→リストイン率、リストイン→セミナー予約率、セミナー予約→着座率、着座→個別予約率、個別予約→着座率、成約率 |

加えて、CPA（広告費/オプト数）もROAS変数に含む。CPAが下がれば同じ着金売上でもROASが上がる。

#### 集客数増加の変数（ボリューム）
| 変数 | 説明 |
|------|------|
| 広告費（日予算） | 予算を増やせば集客数が増える前提 |
| CPC | CPCが下がればクリック数が増える |
| LP CVR | CVRが上がれば同じクリック数でオプト数が増える |
| 配信CR数 | 勝ちCRの本数を増やす（横展開・再出稿） |
| アカウント数 | 新規アカウントでの配信追加 |

### 3.5 ボトルネック特定ロジック（BottleneckDetection）

各ステージの転換率を現状 vs KPI **許容値** で比較し、最大乖離のステージを特定する。
- **許容値**（最低ライン）を基準に判定する。許容を下回っていればボトルネック。
- KPIに定義されている転換率が主な比較対象だが、KPIに含まれないステージ（秘密の部屋購入率、LINE登録率）もデータが取得できる場合は補助的に確認する。
  - 理由: KPIから外れているステージは重要度が低いが、数値が極端に悪化した場合はボトルネックになりうる。

```typescript
interface BottleneckResult {
  stage: string;                        // ボトルネックのステージ名
  currentRate: number;                  // 現状転換率
  targetRate: number;                   // KPI目標転換率
  gapPoints: number;                    // 乖離（ポイント差）
  profitImpact: number;                 // 改善した場合の粗利インパクト（円）
  rank: number;                         // 影響度順位
}
```

**特定ロジック:**
1. 各ステージの転換率を算出
2. KPI目標との差分（ポイント差）を算出
3. **粗利インパクト**を算出: 「このステージをKPI通りに改善した場合、月末着地の粗利がいくら増えるか」
4. 粗利インパクトの大きい順にランキング

**粗利インパクトの算出例（スキルプラスの場合）:**
```
現状: オプト191件 × リストイン率52.9% = リスト101件
KPI: オプト191件 × リストイン率76.1% = リスト145件
差分: +44件のリスト

44件 × セミナー予約率63.4% × 着座率57.8% × 個別予約率67.6% × 成約率X%
× バックエンド単価 = 粗利インパクト
```

### 3.6 取得すべき数値の定義（MetricsDefinition）

**ドメインとして定義する理由:** 何を取得するかはビジネスの核心。取得方法はインフラだが、取得項目はドメイン。

#### 共通指標（全導線）
| 指標 | ソース | 用途 |
|------|--------|------|
| インプレッション | TikTok API or スプシ | ファネル入口 |
| クリック数 | TikTok API or スプシ | CTR算出 |
| CPC | 算出（広告費/クリック数） | トラフィック品質判定 |
| 広告費（税抜） | TikTok API or スプシ | 利益算出 |
| オプト数 | スプシ（UTAGE） | ファネル中間 |
| 着金売上 | スプシ | 利益算出 |

#### AI/SNS導線追加指標
| 指標 | ソース | 備考 |
|------|--------|------|
| フロント購入数 | スプシ V列(index 21) | |
| 秘密の部屋購入数 | スプシ Y列(index 24) | |
| LINE登録数 | スプシ N列(index 13) | |
| 個別予約数 | スプシ AM列(index 38) | |
| 個別着座数 | **スプシにカラムなし** | 必要時に運用者に確認。常に取得する項目ではない |
| 成約数 | スプシ AB列(index 27) | 「その他成約数(個別、直)」 |

#### スキルプラス導線追加指標
| 指標 | ソース | 備考 |
|------|--------|------|
| リストイン数（LINE登録数） | スプシ J列(index 9) | |
| セミナー予約数 | スプシ O列(index 14) | |
| セミナー着座数 | スプシ R列(index 17) | |
| 個別予約数 | スプシ X列(index 23) | |
| 個別着座数 | スプシにカラムなし | 必要時に運用者に確認 |
| 成約数 | スプシ Z列(index 25) | |

### 3.7 TODO生成ロジック（TodoGeneration）

ボトルネックに対して具体的なアクションを生成する。

```typescript
interface GeneratedTodo {
  id: string;
  bottleneck: BottleneckResult;         // 対象ボトルネック
  action: string;                       // アクション内容
  actionType: TodoActionType;           // アクション種別
  isAutoExecutable: boolean;            // 自動実行可能か
  expectedImpact: number;               // 期待粗利インパクト（円）
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}

type TodoActionType =
  | 'CROSS_DEPLOY'       // 横展開（自動実行可能）
  | 'REDEPLOY'           // 再出稿（自動実行可能）
  | 'PAUSE_AD'           // 広告停止（予算調整V2に委譲）
  | 'BUDGET_CHANGE'      // 予算変更（自動実行可能）
  | 'CREATIVE_REQUEST'   // クリエイティブ制作依頼（手動）
  | 'LP_IMPROVEMENT'     // LP改善（手動）
  | 'FUNNEL_FIX'         // 導線改善（手動）
  | 'TARGETING_CHANGE'   // ターゲティング変更（自動実行可能）
  | 'INVESTIGATION'      // 調査・分析（手動）
  ;
```

**生成ルール例:**

| ボトルネック | 生成されるTODO |
|-------------|---------------|
| LP CVR低い | LP改善提案（手動）+ CPC ¥100未満なら配信設定確認 |
| オプト→リストイン率低い | 導線（サンクスページ→LINE）の確認（手動）+ CPC相関チェック |
| リストイン→セミナー予約率低い | セミナー訴求の見直し（手動） |
| 集客数不足 + 勝ちCRあり | 横展開実行（自動）/ 再出稿実行（自動） |
| 集客数不足 + 勝ちCRなし | クリエイティブ制作依頼（手動） |
| CPA高い + CPC ¥100未満のCRあり | CPC低すぎるCRの停止提案 or 配信設定確認 |

---

## 4. インフラ層

### 4.1 データ取得（SpreadsheetDataSource）

**スプレッドシートID:** `1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA`

**シート構成:**
| シート名 | sheetId | 用途 |
|----------|---------|------|
| SNS | 1349660100 | SNS導線の日別実績＋KPI |
| AI | 89597559 | AI導線の日別実績＋KPI |
| スキルプラス（オートウェビナー用） | 1023692144 | スキルプラス導線の日別実績＋KPI |
| シュミレーション | 963192127 | 導線別の日次集客シミュレーション |
| 推移 | 82141897 | 集客数の日次推移 |

#### 4.1.1 シート構造（AI/SNSシート共通）

**Row構造:**
- Row 1: グループヘッダー（結合セル）
- Row 2: カラムヘッダー
- 月ブロック: 月ラベル行（"3月"等 = 月次集計）→ 日別データ行 → "返金"行 → 次の月

**月ラベル行の特定方法:**
A列を走査し、"1月"〜"12月"のテキストに一致する行を検出。同じ月名が複数回出現する場合は年で判別（日別データの日付から推定）。

**「返金」行の扱い:**
月ブロック末尾の「返金」行は無視する。着金売上からの差し引きは不要。

**カラムマッピング（AI/SNSシート Row 2 ヘッダー）:**

| カラム | index | ヘッダー名 | 用途 |
|--------|-------|-----------|------|
| C | 2 | インプレッション | ファネル入口 |
| D | 3 | リーチ数 | |
| F | 5 | クリック数（ユニーク） | CTR/CPC算出 |
| L | 11 | ①オプト獲得数 UTAGE | ファネル中間（オプト） |
| M | 12 | オプト獲得率 | クリック→オプト転換率 |
| N | 13 | ②リスト獲得数 | LINE登録数 |
| P | 15 | リスト獲得率 | オプト→リスト転換率 |
| Q | 16 | CPM | |
| R | 17 | CPC（税込計算） | トラフィック品質判定 |
| S | 18 | オプト実CPA（税込計算） | |
| T | 19 | CV（¥2,980）(one time offer) | フロント購入数（OTO） |
| U | 20 | CV（¥2,980）(メルマガ) | フロント購入数（メルマガ） |
| V | 21 | CV (合宿全体) | フロント購入数合計 |
| W | 22 | CVR (合宿全体) | オプト→フロント転換率 |
| X | 23 | CPO (合宿全体) | フロントCPO |
| Y | 24 | CV（9,800円）(秘密全体) | 秘密の部屋購入数 |
| Z | 25 | CVR (秘密全体) | フロント→秘密の部屋転換率 |
| AA | 26 | CPA (秘密全体) | 秘密の部屋CPO |
| AB | 27 | その他成約数(個別、直) | |
| AD | 29 | 売上合計（合宿） | フロント売上 |
| AE | 30 | 売上合計（秘密の部屋） | アップセル売上 |
| AF | 31 | 売上合計(分割＋一括） | バックエンド売上 |
| AG | 32 | 売上合計（バックエンド） | バックエンド売上 |
| AH | 33 | 売上合計(フロント) | フロント合計売上 |
| **AI** | **34** | **④単月売上** | **着金売上（フロント+バック全含む）** |
| AJ | 35 | ⑤売上合計(全て) | 累計売上 |
| AK | 36 | 単月オプトLTV | |
| AL | 37 | 単月リストLTV | |
| AM | 38 | ③個別相談予約（センサーズLINE経由） | 個別予約数 |
| AN | 39 | 個別相談予約率（対オプト） | |
| AO | 40 | 個別予約CPO | |
| AP | 41 | フロントROAS | |
| AQ | 42 | 単月ROAS | |
| AS | 44 | コスト(税別) | **広告費（税抜）** |
| AT | 45 | コスト（税込） | 広告費（税込） |

#### 4.1.2 カラムマッピング（スキルプラスシート）

**AI/SNSとの違い:** フロント商品がないためカラム構成が異なる。

| カラム | index | ヘッダー名 | 用途 |
|--------|-------|-----------|------|
| C | 2 | インプレッション | |
| F | 5 | クリック数（ユニーク） | |
| G | 6 | クリック率 | |
| H | 7 | ①オプト獲得数 | オプト数 |
| I | 8 | オプトイン率（対クリック数） | |
| J | 9 | ②リスト獲得数（クロス分析） | リストイン数 |
| K | 10 | リストイン率（対オプト数） | |
| L | 11 | CPM | |
| M | 12 | CPC | |
| N | 13 | オプトCPA | |
| O | 14 | セミナー予約数 | |
| P | 15 | セミナー予約率 | |
| Q | 16 | セミナー予約CPO | |
| R | 17 | セミナー着座数 | |
| S | 18 | セミナー着座率 | |
| T | 19 | セミナー着座CPO | |
| X | 23 | 個別予約数 | |
| Y | 24 | 個別CPO | |
| Z | 25 | 成約数 | |
| **AA** | **26** | **着金売上** | **着金売上** |
| AB | 27 | 売上合計 | |
| AE | 30 | 単月ROAS | |
| **AG** | **32** | **コスト（税抜）** | **広告費（税抜）** |
| AH | 33 | コスト（税込） | |

### 4.2 KPI目標値の取得

**管理場所:** スプレッドシート内、各月の日別データ行に埋め込まれている。

#### KPIの位置特定方法

KPIは月の日別データ行の右側に「許容」「目標」のヘッダー付きで記載されている。

**特定アルゴリズム:**
1. 対象月の日別データ範囲を特定（月ラベル行+1 〜 次の月ラベル行-1）
2. KPIヘッダー列（下記参照）を走査し、「許容」「目標」テキストを含む行を検出
3. その行以降のKPI項目行を順に読み取る

**KPIカラム位置（シート別）:**

| シート | 項目名列 | 許容値列 | 目標値列 |
|--------|---------|---------|---------|
| **AI** | AV (index 47) | AW (index 48) | AX (index 49) |
| **SNS** | AV (index 47) | AW (index 48) | AX (index 49) |
| **スキルプラス** | AK (index 36) | AL (index 37) | AM (index 38) |

#### KPI項目一覧

**AI導線（2026年3月 Row 453-464）:**
| Row | 項目名 | 許容 | 目標 |
|-----|--------|------|------|
| 453 | (ヘッダー) | 許容 | 目標 |
| 454 | ROAS | 300% | 400% |
| 455 | オプト→フロント率 | 5.88% | 5.88% |
| 456 | フロント→個別率 | 200.0% | 200.0% |
| 457 | 個別→着座率 | 58% | 58% |
| 458 | 着座→成約率 | 38.00% | 38% |
| 459 | 商品単価（平均着金額） | 732,236 | 732,236 |
| 460 | バックCPO | 244,079 | 183,059 |
| 461 | 個別CPO | 53,795 | 40,346 |
| 462 | フロントCPO | 39,378 | 29,533 |
| 463 | CPA | 4,032 | 3,024 |
| 464 | 目標粗利額 | (記入予定) | (記入予定) |

**SNS導線（2026年3月 Row 457-468）:**
| Row | 項目名 | 許容 | 目標 |
|-----|--------|------|------|
| 458 | ROAS | 300% | 400% |
| 459 | オプト→フロント率 | 7.9% | 7.9% |
| 460 | フロント→個別率 | 83.8% | 83.8% |
| 461 | 個別→着座率 | 97% | 97% |
| 462 | 着座→成約率 | 17.9% | 17.9% |
| 463 | 商品単価（平均着金額） | 652,306 | 652,306 |
| 464 | バックCPO | 217,435 | 163,077 |
| 465 | 個別CPO | 37,753 | 28,315 |
| 466 | フロントCPO | 31,637 | 23,728 |
| 467 | CPA | 2,499 | 1,875 |
| 468 | 目標粗利額 | (記入予定) | (記入予定) |

**スキルプラス導線（2026年3月 Row 198-211）:**
| Row | 項目名 | 許容 | 目標 |
|-----|--------|------|------|
| 198 | ROAS | 300% | 400% |
| 199 | オプト→メイン（リストイン率） | 76.13% | 76.13% |
| 200 | メイン→企画（セミナー予約率） | 62.95% | 62.95% |
| 201 | 企画→セミナー予約率 | 100% | 100% |
| 202 | セミナー予約→セミナー着座率 | 55.65% | 55.65% |
| 203 | セミナー着座→個別予約率 | 61.56% | 61.56% |
| 204 | 個別予約→個別着座率 | 60.4% | 60.4% |
| 205 | 個別着座→成約率 | 36.13% | 36.13% |
| 206 | 商品単価（平均着金額） | 671,274 | 671,274 |
| 207 | バックCPO | ¥223,758 | ¥167,819 |
| 208 | 個別CPO | ¥48,830 | ¥36,622 |
| 209 | セミナー着座CPO | ¥30,060 | ¥22,545 |
| 210 | CPA | ¥8,017 | ¥6,013 |

**目標粗利額の位置ルール:**
- 各導線とも、対象月のKPI項目の最後に「目標粗利額」行を記載する
- 月をまたいだら新しい月のKPIを書き、その最後に目標粗利額を追加する
- 現状（2026年3月）: AI=Row464, SNS=Row468, SP=Row180（2月ブロック内。今後は各月のKPI末尾に統一予定）
- 検出方法: KPI項目列を走査し「目標粗利額」テキストを含む行を検出

#### 利益シミュレーションで使用するKPI値

| 用途 | KPI項目 | 備考 |
|------|---------|------|
| バックエンド1件あたりの売上 | **商品単価（平均着金額）** | 定価¥798,000ではなく実績平均を使用 |
| 月次目標 | **目標粗利額** | 各月のKPI行の最下部に記載 |
| ボトルネック比較 | **各ステージ転換率** | 現状実績との乖離で特定 |
| ROAS判定 | **ROAS（許容/目標）** | 許容=最低ライン、目標=理想値 |

#### KPI値のパース仕様

スプシのKPI値はフォーマットが統一されていないため、以下のパース処理が必要。

| フォーマット | 例 | パース結果 |
|-------------|-----|----------|
| 全角パーセント | `"7.9％"` | 0.079 |
| 半角パーセント | `"300%"` | 3.0 |
| 小数（比率） | `"0.7613"` | 0.7613 |
| 円マーク付き | `"¥48,830"` | 48830 |
| カンマ付き数値 | `"652,306"` | 652306 |
| プレーン数値 | `"652306"` | 652306 |
| 漢字単位 | `"2000万"` | 20000000 |
| 漢字単位 | `"1000万"` | 10000000 |

#### KPI項目名 → ファネルステージ間転換率のマッピング

KPIの項目名とファネルモデルのステージ間転換率を対応付ける。

**AI/SNS導線:**
| KPI項目名 | ファネルの転換元 → 転換先 | 備考 |
|----------|------------------------|------|
| CPA | （広告費/オプト数で算出） | ステージ転換率ではなくコスト指標 |
| オプト→フロント率 | オプトイン → フロント購入 | |
| フロント→個別率 | フロント購入 → 個別予約 | 秘密の部屋・LINE登録をスキップした転換率 |
| 個別→着座率 | 個別予約 → 個別着座 | |
| 着座→成約率 | 個別着座 → バックエンド購入 | |

**スキルプラス導線:**
| KPI項目名 | ファネルの転換元 → 転換先 |
|----------|------------------------|
| CPA | （広告費/オプト数で算出） |
| オプト→メイン | オプトイン → LINE登録（リストイン） |
| メイン→企画 | LINE登録 → セミナー予約 |
| 企画→セミナー予約率 | （セミナー予約の内部ステップ、通常100%） |
| セミナー予約→セミナー着座率 | セミナー予約 → セミナー着座 |
| セミナー着座→個別予約率 | セミナー着座 → 個別予約 |
| 個別予約→個別着座率 | 個別予約 → 個別着座 |
| 個別着座→成約率 | 個別着座 → バックエンド購入 |

**既存サービスの活用:**
- `GoogleSheetsService.getIndividualReservationCount()` → 個別予約数取得（既存）
- 着金売上・ファネル各ステージ数値・KPI取得 → 新規メソッド追加

---

## 5. 自動実行

### 5.1 自動実行可能なアクション
| アクション | 既存機能 | 備考 |
|-----------|---------|------|
| 横展開 | `cross-deploy` モジュール | 既に`/api/cross-deploy/deploy`で実行可能 |
| 再出稿 | `redeploy-ad.ts` | ローカルスクリプトとして存在 |
| 予算変更 | `budget-optimization-v2` | 予算調整V2に委譲（触らない） |
| ターゲティング変更 | TikTok API | 新規実装が必要 |

### 5.2 自動実行不可なアクション
| アクション | 理由 |
|-----------|------|
| クリエイティブ制作 | 人間の創造的作業 |
| LP改善 | デザイン・コピーライティング |
| 導線改善（サンクスページ等） | UTAGE/L-step側の設定変更 |

### 5.3 承認フロー（Phase 1: 人間承認）

初期段階ではTODOを自動実行せず、ユーザーの承認を経て実行する。

```
TODO生成
  → ユーザーに提示（各TODOの期待粗利インパクト付き）
  → ユーザーが承認 / 却下 / フィードバック
      ├─ 承認 → 自動実行可能？
      │           ├─ YES → 実行
      │           └─ NO  → 手動アクションとして表示
      ├─ 却下 → 却下理由をフィードバックとして記録
      └─ FB   → 判断基準をルールとして蓄積
```

### 5.4 フィードバックループ（学習サイクル）

承認/却下時のフィードバックをナレッジとして蓄積し、TODO生成ロジックの精度を継続的に向上させる。

**フィードバックの蓄積先:** `daily-ops-rules.md`（既存の思考ルールファイル）

```typescript
interface TodoFeedback {
  todoId: string;
  decision: 'APPROVED' | 'REJECTED' | 'MODIFIED';
  reason: string;                    // 判断の理由
  rule?: string;                     // 汎用化したルール（次回以降に適用）
  timestamp: Date;
}
```

**学習サイクル:**
1. TODO提示 → ユーザーが却下＋理由を提供
2. 理由を汎用ルール化 → `daily-ops-rules.md` に追加
3. 次回のTODO生成時にルールを適用 → 同じ種類のTODOは生成しない or 条件を調整
4. 十分なルールが蓄積され精度が上がったら → Phase 2: 自動実行に移行

**例:**
- FB:「リストイン率が低いのはCPC ¥100未満のCRが原因。導線改善じゃなくてCR停止が先」
  → ルール追加: 「リストイン率低下時、まずCPC ¥100未満のCRがないか確認。あればCR停止TODOを優先」
- FB:「この導線はまだ出稿3日目だから効果測定が先」
  → ルール追加: 「出稿7日未満のCRに対するボトルネック改善TODOは除外。効果測定TODOに切り替え」

### 5.5 Phase 2: 自動実行（将来）

フィードバックループにより十分な精度が確認された後、承認なしの自動実行に移行する。
移行基準は「過去N回のTODO提示で承認率がX%以上」等（具体的な閾値は運用しながら決定）。

---

## 6. アーキテクチャ

### 6.1 DBスキーマ（Prisma）

TODO・フィードバックの永続化に必要なテーブル。

```prisma
model ProfitSimulationTodo {
  id              String   @id @default(uuid())
  channelType     String   // 'AI' | 'SNS' | 'SKILL_PLUS'
  period          String   // '2026-03' 形式
  bottleneckStage String   // ボトルネックのステージ名
  currentRate     Float    // 現状転換率
  targetRate      Float    // KPI許容値
  gapPoints       Float    // 乖離（ポイント差）
  profitImpact    Float    // 改善時の粗利インパクト（円）
  action          String   // アクション内容
  actionType      String   // TodoActionType
  isAutoExecutable Boolean
  priority        String   // 'HIGH' | 'MEDIUM' | 'LOW'
  status          String   @default("PENDING") // 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED'
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  feedbacks       ProfitSimulationFeedback[]
}

model ProfitSimulationFeedback {
  id        String   @id @default(uuid())
  todoId    String
  todo      ProfitSimulationTodo @relation(fields: [todoId], references: [id])
  decision  String   // 'APPROVED' | 'REJECTED' | 'MODIFIED'
  reason    String   // 判断の理由
  rule      String?  // 汎用化したルール（daily-ops-rules.mdに追加する内容）
  createdAt DateTime @default(now())
}
```

### 6.2 DI ポート定義（ドメインが定義するインターフェース）

ドメイン層が外界の影響を受けないよう、以下のポートをドメイン側で定義し、インフラ層が実装する。

```typescript
// ===== データ取得ポート =====

/** スプシから月次実績・KPIを取得 */
interface MetricsDataSource {
  /** 当月の日別ファネル実績を取得し、FunnelModelに必要なデータを返す */
  getMonthlyMetrics(channelType: ChannelType, year: number, month: number): Promise<MonthlyMetricsData>;

  /** 当月のKPI（許容値・目標値）を取得 */
  getKPI(channelType: ChannelType, year: number, month: number): Promise<KPITargets>;

  /** 目標粗利額を取得 */
  getTargetProfit(channelType: ChannelType, year: number, month: number): Promise<number>;
}

/** MetricsDataSourceが返すデータ（ドメインが必要とする形式で定義） */
interface MonthlyMetricsData {
  adSpend: number;           // 広告費（税抜）
  totalRevenue: number;      // 着金売上
  optinCount: number;        // オプト数
  clickCount: number;        // クリック数
  impressions: number;       // インプレッション
  optinLTV: number;          // 単月オプトLTV
  stageMetrics: Record<string, number>;  // ステージ別実績数（ステージ名 → 件数）
  dailyData: DailyMetrics[]; // 日別データ（実績日数の算出用）
}

interface KPITargets {
  conversionRates: Record<string, number>;  // KPI項目名 → 許容値（比率）
  targetROAS: number;
  avgPaymentAmount: number;  // 商品単価（平均着金額）
  cpa: number;               // 許容CPA
}

// ===== TODO永続化ポート =====

interface TodoRepository {
  save(todo: GeneratedTodo): Promise<void>;
  saveBatch(todos: GeneratedTodo[]): Promise<void>;
  findByPeriod(channelType: ChannelType, period: string): Promise<GeneratedTodo[]>;
  updateStatus(id: string, status: string): Promise<void>;
}

// ===== フィードバック永続化ポート =====

interface FeedbackRepository {
  save(feedback: TodoFeedback): Promise<void>;
  findByTodoId(todoId: string): Promise<TodoFeedback[]>;
}

// ===== ルール読み書きポート（TodoGenerationが使用）=====

/** daily-ops-rules.mdの読み書き */
interface RuleStore {
  /** 現在のルール一覧を取得 */
  loadRules(): Promise<OpsRule[]>;

  /** 新しいルールを追加 */
  addRule(rule: OpsRule): Promise<void>;
}

// ===== 勝ちCR情報ポート（TodoGenerationが使用）=====

/** 横展開・再出稿候補となる勝ちCRの存在確認 */
interface WinningCreativeSource {
  /** 指定チャネルで横展開可能な勝ちCRがあるか */
  hasWinningCreatives(channelType: ChannelType): Promise<boolean>;

  /** 横展開候補のCR一覧 */
  getWinningCreatives(channelType: ChannelType): Promise<WinningCreative[]>;
}

interface WinningCreative {
  adId: string;
  adName: string;
  advertiserId: string;
  channelType: ChannelType;
}

// ===== 結果出力ポート =====

/** シミュレーション結果のMDファイル出力 */
interface ReportOutput {
  writeReport(summary: TotalProfitSummary, bottlenecks: BottleneckResult[], todos: GeneratedTodo[]): Promise<void>;
}
```

**ポートとインフラ実装の対応:**

| ポート（ドメイン定義） | インフラ実装 | 依存先 |
|----------------------|------------|--------|
| MetricsDataSource | SpreadsheetMetricsDataSource | Google Sheets API |
| TodoRepository | PrismaTodoRepository | Prisma (PostgreSQL) |
| FeedbackRepository | PrismaFeedbackRepository | Prisma (PostgreSQL) |
| RuleStore | FileRuleStore | ファイルシステム (daily-ops-rules.md) |
| WinningCreativeSource | DatabaseWinningCreativeSource | Prisma (AdPerformance等) |
| ReportOutput | MarkdownReportOutput | ファイルシステム (docs/knowledge/) |

### 6.3 モジュール構成
```
apps/backend/src/profit-simulation/
├── domain/
│   ├── ports.ts                     # 全ポート（インターフェース）定義
│   ├── types.ts                     # ドメイン型定義（ChannelType, MonthlyMetricsData等）
│   ├── funnel-model.ts              # 導線別ファネルモデル
│   ├── funnel-model.spec.ts         # TDD
│   ├── profit-simulation.ts         # 利益シミュレーション（日割り計算）
│   ├── profit-simulation.spec.ts    # TDD
│   ├── direction-judgment.ts        # ROAS vs 集客数判定
│   ├── direction-judgment.spec.ts   # TDD
│   ├── bottleneck-detection.ts      # ボトルネック特定
│   ├── bottleneck-detection.spec.ts # TDD
│   ├── variable-identification.ts   # 変数洗い出し
│   ├── variable-identification.spec.ts # TDD
│   ├── todo-generation.ts           # TODO生成（RuleStore, WinningCreativeSourceをDI）
│   └── todo-generation.spec.ts      # TDD（ポートをモックして純粋テスト）
├── infrastructure/
│   ├── spreadsheet-metrics-data-source.ts  # MetricsDataSource実装
│   ├── prisma-todo-repository.ts           # TodoRepository実装
│   ├── prisma-feedback-repository.ts       # FeedbackRepository実装
│   ├── file-rule-store.ts                  # RuleStore実装
│   ├── database-winning-creative-source.ts # WinningCreativeSource実装
│   └── markdown-report-output.ts           # ReportOutput実装
├── profit-simulation.service.ts     # NestJSサービス（オーケストレーション、全ポートをDI）
├── profit-simulation.controller.ts  # APIエンドポイント
└── profit-simulation.module.ts      # NestJSモジュール（DIバインディング）
```

### 6.4 ドメイン層 vs インフラ層の境界
| 層 | 責務 | 例 |
|----|------|-----|
| **ドメイン** | 何を計算するか、何を判定するか | 利益計算式、転換率算出、ボトルネック判定、TODO生成ルール |
| **ドメイン** | 何の数値を取得するか | 取得すべき指標の定義（オプト数、着金売上、etc.） |
| **インフラ** | どうやって取得するか | Google Sheets APIでの読み取り、カラムマッピング |

### 6.5 TDD実装順序
1. **FunnelModel**: 転換率算出のテスト → 実装
2. **ProfitSimulation**: 日割り計算のテスト → 実装
3. **DirectionJudgment**: ROAS/集客数判定のテスト → 実装
4. **BottleneckDetection**: KPI比較＋粗利インパクト算出のテスト → 実装
5. **VariableIdentification**: 導線ごとの変数列挙テスト → 実装
6. **TodoGeneration**: ルールベースTODO生成のテスト → 実装
7. **SpreadsheetDataSource**: スプシ読み取りの統合テスト → 実装
8. **Service**: 全体オーケストレーションの統合テスト → 実装

---

## 7. 実行タイミング・API

### 7.1 日次cron実行
- **実行時間:** JST 11:00（UTC 02:00）
- GitHub Actionsの日次cronで自動実行
- 結果はMDファイルに出力（将来的にLINE通知に移行予定）

### 7.2 出力形式（Phase 1）
ターミナル出力＋MDファイル（`docs/knowledge/YYYY-MM-DD_profit-simulation.md`）に結果をまとめる。
- シミュレーション結果（導線別＋全体サマリー）
- ボトルネック一覧（粗利インパクト順）
- 生成されたTODO一覧（承認待ち）

### 7.3 API エンドポイント
```
GET  /api/profit-simulation/run
  → 全導線のシミュレーション実行＋ボトルネック特定＋TODO生成

GET  /api/profit-simulation/run?channel=AI
  → 特定導線のみ

POST /api/profit-simulation/todos/:id/approve
  → TODOの承認（承認されたら自動実行可能なものは実行）

POST /api/profit-simulation/todos/:id/reject
  → TODOの却下（理由をフィードバックとして記録）

POST /api/profit-simulation/todos/:id/feedback
  → TODOへのフィードバック（ルール化してdaily-ops-rules.mdに蓄積）
```

---

## 8. 未確定事項

| 項目 | 状態 | 備考 |
|------|------|------|
| ~~目標粗利の管理場所~~ | **確定** | スプシのKPI行最下部「目標粗利額」（記入予定） |
| ~~各ステージのKPI目標転換率~~ | **確定** | スプシのKPI行から取得（Section 4.2参照） |
| ~~日別ファネル指標のスプシカラムマッピング~~ | **確定** | Section 4.1.1, 4.1.2 に全カラム定義済み |
| ~~バックエンド商品単価~~ | **確定** | KPIの「商品単価（平均着金額）」を使用。AI:¥732,236 / SNS:¥652,306 / SP:¥671,274 |
| ~~目標粗利額（AI）~~ | **確定** | 2,000万円（AI Row 464, AV列） |
| ~~目標粗利額（SNS）~~ | **確定** | 1,000万円（SNS Row 468, AV列） |
| ~~目標粗利額（スキルプラス）~~ | **確定** | 1,000万円（SP Row 180, AK列）※2月ブロック内に記載 |
| ~~自動実行の承認フロー~~ | **確定** | Phase 1: 承認フロー（FB蓄積）→ Phase 2: 自動実行（精度向上後） |
| ~~ボトルネック判定基準~~ | **確定** | 「許容」値（最低ライン）で判定。許容を下回ればボトルネック |
| ~~返金行の扱い~~ | **確定** | 無視。着金売上からの差し引き不要 |
| ~~実行タイミング~~ | **確定** | 日次cron（GitHub Actions） |
| ~~cron実行時間~~ | **確定** | JST 11:00（UTC 02:00） |
| ~~通知方法~~ | **確定** | Phase 1: ターミナル出力＋MDファイル。将来: LINE通知 |
| ~~目標粗利額の位置ルール~~ | **確定** | 月ごとのKPI項目の最後に記載。「目標粗利額」テキストで検出 |
| ~~KPIフォーマットパース~~ | **確定** | 全角/半角%、小数、¥、漢字単位(万)等を統一パース |
| ~~KPI→ファネルマッピング~~ | **確定** | Section 4.2 に定義済み |
| ~~TODO/FB永続化~~ | **確定** | Prismaスキーマ追加（Section 6.1） |
| AI/SNSの個別着座数 | 必要時に確認 | スプシにカラムなし。KPIに「個別→着座率」はあるがデータソース未定。必要時に運用者に聞く |
| ~~AI/SNSの成約数のカラム~~ | **確定** | AB列(index 27)「その他成約数(個別、直)」 |

---

## 9. 参考: 今日の分析会話から得た知見

### ボトルネック特定のリアルな分析フロー（スキルプラス導線の例）
1. 各ステージの転換率を現状 vs KPI で一覧化
2. 最大乖離 = オプト→リストイン率（52.9% vs KPI 76.1%、-23.2pt）
3. 日別データに分解して原因切り分け（Phase A/B/C）
4. CPC ≤¥60でリストイン率が構造的に悪化することを発見（r=0.52）
5. 広告セット別データでスマプラ系CR（CPC ¥10-28）が犯人と特定
6. 配信設定（tCPA未設定 × Smart+フォーマット）が根本原因

### システムに反映すべきルール
- CPC ¥100未満の広告はリストイン率低下リスクが高い → アラート対象
- 同一CRでも配信フォーマット（Smart+ vs 通常）でCPCが10倍変わる
- ボトルネック特定時、日別データに分解してフェーズを識別する手法が有効
