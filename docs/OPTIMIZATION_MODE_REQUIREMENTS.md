# 予算調整モード機能 要件定義書

## 1. 概要

予算調整システムに「ROAS最大化モード」と「集客数増加モード」の2つの運用モードを導入する。
これにより、ビジネス目標に応じた柔軟な予算調整が可能になる。

## 2. 背景・目的

### 2.1 現状の課題
現在の予算調整ロジックでは、広告セット内に複数の広告が存在し、一部が「予算増額」判定、他が「継続」判定となった場合、**予算増額を優先**している。

これは集客数を最大化する戦略には適しているが、ROASを重視する運用では不要な広告費増加につながる可能性がある。

### 2.2 目的
- ROASを重視する運用と集客数を重視する運用を使い分けられるようにする
- 自動実行（GitHub Actions）ではROAS最大化を優先し、無駄な広告費増加を防ぐ
- 手動実行時はユーザーが目的に応じてモードを選択できるようにする

## 3. 機能要件

### 3.1 モード定義

| モード名 | 識別子 | 説明 |
|----------|--------|------|
| ROAS最大化モード | `ROAS_MAXIMIZE` | 広告費効率を重視。予算増額に慎重 |
| 集客数増加モード | `ACQUISITION_MAXIMIZE` | 集客数を重視。積極的に予算増額 |

### 3.2 モードによる判定ロジックの違い

#### 3.2.1 対象となるケース

**ケース1: 広告セット予算の場合**
- 広告セットに予算が設定されている
- その広告セット内に複数の広告が存在
- 一部の広告が `INCREASE_BUDGET` 判定、他の広告が `CONTINUE` 判定
- **現在のシステムで対応済み**（`executeAdGroupOptimization`メソッド）

**ケース2: キャンペーン予算（CBO）の場合**
- キャンペーンに予算が設定されている（Campaign Budget Optimization）
- そのキャンペーン内に複数の広告セットが存在
- 各広告セット内の広告判定を集約した結果、一部の広告セットが `INCREASE_BUDGET`、他が `CONTINUE`
- **現在のシステムで未対応**（広告セット単位で独立処理されている）
- **新規実装が必要**

**ケース3: Phase 2（旧スマートプラス）**
- キャンペーン全体を1つのパフォーマンスとして評価
- 判定は1つのみ（混在しない）
- **モード適用は不要**

#### 3.2.2 モード別の判定結果

| 状況 | ROAS最大化モード | 集客数増加モード |
|------|------------------|------------------|
| INCREASE_BUDGET + CONTINUE が混在 | **CONTINUE**（予算維持） | **INCREASE_BUDGET**（予算増額） |
| 全てINCREASE_BUDGET | INCREASE_BUDGET | INCREASE_BUDGET |
| 全てCONTINUE | CONTINUE | CONTINUE |
| PAUSEを含む | PAUSEの広告を停止後、残りで判定 | PAUSEの広告を停止後、残りで判定 |

#### 3.2.3 変更しないロジック

以下のロジックは両モードで共通（既存のまま）：

1. **個別広告の判定ロジック**
   - インプレッション < 5000 → CONTINUE
   - フロント販売 >= 1件 かつ フロントCPO <= 目標値 → INCREASE_BUDGET
   - フロント販売 >= 1件 かつ フロントCPO <= 許容値 → CONTINUE
   - フロント販売 >= 1件 かつ フロントCPO > 許容値 → PAUSE
   - フロント販売 = 0件 かつ CPA = 0 → PAUSE
   - フロント販売 = 0件 かつ CPA <= 許容値 かつ 累積広告費 <= 許容フロントCPO → CONTINUE
   - フロント販売 = 0件 かつ その他 → PAUSE

2. **PAUSE判定の処理**
   - PAUSEの広告は常に個別に停止処理を実行

3. **予算増額の倍率**
   - 30%増額（変更なし）

### 3.3 デフォルトモード

| 実行方法 | デフォルトモード |
|----------|------------------|
| GitHub Actions（自動実行） | ROAS最大化モード |
| GitHub Actions（手動実行） | ROAS最大化モード |
| UI画面（手動実行） | ユーザー選択（必須） |

## 4. API仕様

### 4.1 既存エンドポイントの変更

#### POST /api/optimization/execute/:advertiserId

**リクエストボディ（変更後）:**
```json
{
  "mode": "ROAS_MAXIMIZE" | "ACQUISITION_MAXIMIZE"
}
```

| パラメータ | 型 | 必須 | デフォルト | 説明 |
|------------|-----|------|------------|------|
| mode | string | No | "ROAS_MAXIMIZE" | 最適化モード |

#### POST /api/optimization/execute-selected

**リクエストボディ（変更後）:**
```json
{
  "advertiserIds": ["123456", "789012"],
  "mode": "ROAS_MAXIMIZE" | "ACQUISITION_MAXIMIZE"
}
```

| パラメータ | 型 | 必須 | デフォルト | 説明 |
|------------|-----|------|------------|------|
| advertiserIds | string[] | Yes | - | 対象のAdvertiser ID |
| mode | string | No | "ROAS_MAXIMIZE" | 最適化モード |

#### POST /api/optimization/execute

**リクエストボディ（変更後）:**
```json
{
  "mode": "ROAS_MAXIMIZE" | "ACQUISITION_MAXIMIZE"
}
```

### 4.2 レスポンスの変更

レスポンスに使用したモードを含める：

```json
{
  "success": true,
  "data": {
    "mode": "ROAS_MAXIMIZE",
    "totalAds": 10,
    "evaluated": 8,
    "decisions": 8,
    "executed": 5,
    "detailedLogs": [...],
    "smartPlusCampaigns": {...}
  }
}
```

## 5. UI仕様

### 5.1 モード選択UI

**配置場所:** アカウント選択の下、実行ボタンの上

**UI要素:**
```
┌─────────────────────────────────────────────────────────┐
│ 最適化モード選択                                          │
│                                                         │
│ ○ ROAS最大化モード（推奨）                                │
│   広告費効率を重視し、慎重に予算を調整します。             │
│   複数広告で判定が分かれた場合、予算維持を優先します。      │
│                                                         │
│ ○ 集客数増加モード                                       │
│   集客数を重視し、積極的に予算を増額します。               │
│   複数広告で判定が分かれた場合、予算増額を優先します。      │
└─────────────────────────────────────────────────────────┘
```

**デザイン要件:**
- ラジオボタンで選択（単一選択）
- デフォルトは未選択（ユーザーに明示的に選択させる）
- 選択しないと実行ボタンが無効化される
- 各モードに説明文を付ける

### 5.2 実行結果表示

使用したモードを結果表示に含める：

```
✅ 予算調整が完了しました
モード: ROAS最大化モード
対象広告数: 10  評価した広告: 8  判断数: 8  実行数: 5
```

## 6. GitHub Actions仕様

### 6.1 budget-optimization.yml の変更

**変更点:**
- APIリクエストに `mode` パラメータを追加
- 値は `ROAS_MAXIMIZE` 固定

**変更箇所（curl コマンド）:**
```bash
# 変更前
curl -X POST "$API_BASE_URL/api/optimization/execute/$ADVERTISER_ID"

# 変更後
curl -X POST "$API_BASE_URL/api/optimization/execute/$ADVERTISER_ID" \
  -H "Content-Type: application/json" \
  -d '{"mode": "ROAS_MAXIMIZE"}'
```

### 6.2 手動実行時のモード選択（オプション・将来対応）

将来的に手動実行時にモードを選択できるようにする場合のワークフロー入力定義：

```yaml
workflow_dispatch:
  inputs:
    advertiser_ids:
      description: '特定のAdvertiser IDsをカンマ区切りで指定'
      required: false
      type: string
    mode:
      description: '最適化モード'
      required: false
      type: choice
      default: 'ROAS_MAXIMIZE'
      options:
        - ROAS_MAXIMIZE
        - ACQUISITION_MAXIMIZE
```

※ 初期リリースでは手動実行時もROAS最大化モード固定とする

## 7. バックエンド実装仕様

### 7.1 変更対象ファイル

| ファイル | 変更内容 |
|----------|----------|
| `optimization.service.ts` | モードに応じた判定ロジックの分岐 |
| `optimization.controller.ts` | リクエストパラメータの受け取り |
| `optimization.dto.ts` | DTOにmode追加（新規作成の場合） |

### 7.2 OptimizationService の変更

#### 7.2.1 モード型定義

```typescript
type OptimizationMode = 'ROAS_MAXIMIZE' | 'ACQUISITION_MAXIMIZE';
```

#### 7.2.2 executeAdGroupOptimization メソッドの変更

```typescript
private async executeAdGroupOptimization(
  adgroupId: string,
  decisions: OptimizationDecision[],
  advertiserId: string,
  accessToken: string,
  mode: OptimizationMode = 'ROAS_MAXIMIZE',  // 追加
) {
  // ... 既存のPAUSE処理 ...

  const remainingDecisions = decisions.filter((d) => d.action !== 'PAUSE');

  if (remainingDecisions.length === 0) {
    return { adgroupId, action: 'NO_CHANGE', reason: '全ての広告が停止されました' };
  }

  const hasIncreaseBudget = remainingDecisions.some((d) => d.action === 'INCREASE_BUDGET');
  const hasContinue = remainingDecisions.some((d) => d.action === 'CONTINUE');

  // モードに応じた判定
  if (hasIncreaseBudget && hasContinue) {
    // 混在ケース: モードで判断
    if (mode === 'ROAS_MAXIMIZE') {
      return { adgroupId, action: 'CONTINUE', reason: 'ROAS最大化モード: 判定が分かれたため予算維持' };
    } else {
      // ACQUISITION_MAXIMIZE: 既存の動作（予算増額）
      // ... 既存の予算増額処理 ...
    }
  } else if (hasIncreaseBudget) {
    // 全てINCREASE_BUDGET: 予算増額
    // ... 既存の予算増額処理 ...
  }

  return { adgroupId, action: 'CONTINUE', reason: '配信継続' };
}
```

### 7.3 キャンペーン予算（CBO）への対応（新規実装必要）

**現在の問題点：**
- CBO有効時、各広告セットが独立して処理され、先に処理された広告セットでキャンペーン予算が増額される
- キャンペーン全体を見て判定を集約するロジックがない

**必要な実装：**

#### 7.3.1 処理フローの変更

```
【変更前】
1. 広告ごとに判定
2. 広告セットごとにグループ化
3. 広告セットごとに順次実行 → CBO時は先に増額になった広告セットで予算増額

【変更後】
1. 広告ごとに判定
2. 広告セットごとにグループ化
3. 各広告セットの「広告セット判定」を決定（INCREASE_BUDGET / CONTINUE / PAUSE）
4. CBO判定：
   - 広告セット予算の場合 → 広告セットごとに実行（従来通り）
   - キャンペーン予算（CBO）の場合 → キャンペーンでグループ化して集約判定
5. 実行
```

#### 7.3.2 新規メソッド追加

```typescript
/**
 * キャンペーン単位で広告セットの判定を集約
 */
private groupAdGroupDecisionsByCampaign(
  adgroupResults: AdGroupOptimizationResult[],
): Record<string, AdGroupOptimizationResult[]> {
  // campaignIdでグループ化
}

/**
 * CBO有効キャンペーンの判定を実行
 */
private async executeCampaignOptimization(
  campaignId: string,
  adgroupResults: AdGroupOptimizationResult[],
  advertiserId: string,
  accessToken: string,
  mode: OptimizationMode,
): Promise<CampaignOptimizationResult> {
  const hasIncreaseBudget = adgroupResults.some(r => r.action === 'INCREASE_BUDGET');
  const hasContinue = adgroupResults.some(r => r.action === 'CONTINUE');

  if (hasIncreaseBudget && hasContinue) {
    if (mode === 'ROAS_MAXIMIZE') {
      return { campaignId, action: 'CONTINUE', reason: 'ROAS最大化モード' };
    }
    // ACQUISITION_MAXIMIZE: 予算増額
  }
  // ...
}
```

#### 7.3.3 CBO判定のためのフラグ取得

広告セット情報から`budget_mode`を確認してCBO判定を行う：
- `budget_mode = 'BUDGET_MODE_DAY'` かつ `budget > 0` → 広告セット予算
- それ以外 → キャンペーン予算（CBO）

### 7.4 Phase 2（旧スマートプラス）への対応

Phase 2はキャンペーン全体を1つのパフォーマンスとして評価するため、**モード適用は不要**。
`makeCampaignOptimizationDecision`メソッドは変更なし。

## 8. テスト要件

### 8.1 単体テスト

| テストケース | ROAS最大化 | 集客数増加 |
|--------------|------------|------------|
| 全広告INCREASE_BUDGET | INCREASE_BUDGET | INCREASE_BUDGET |
| 全広告CONTINUE | CONTINUE | CONTINUE |
| INCREASE_BUDGET + CONTINUE 混在 | **CONTINUE** | **INCREASE_BUDGET** |
| PAUSE + INCREASE_BUDGET | PAUSE後、INCREASE_BUDGET | PAUSE後、INCREASE_BUDGET |
| PAUSE + CONTINUE | PAUSE後、CONTINUE | PAUSE後、CONTINUE |
| PAUSE + INCREASE_BUDGET + CONTINUE | PAUSE後、**CONTINUE** | PAUSE後、**INCREASE_BUDGET** |

### 8.2 統合テスト

1. API経由でモード指定が正しく動作すること
2. UI画面からモード選択・実行が正しく動作すること
3. GitHub Actionsで固定モード（ROAS_MAXIMIZE）が正しく動作すること

## 9. 影響範囲

### 9.1 影響を受けるコンポーネント

| コンポーネント | 影響度 | 変更内容 |
|----------------|--------|----------|
| optimization.service.ts | 高 | 判定ロジックにモード分岐追加 |
| optimization.controller.ts | 中 | リクエストパラメータ追加 |
| optimization/page.tsx | 中 | モード選択UI追加 |
| budget-optimization.yml | 低 | APIリクエストにmode追加 |

### 9.2 後方互換性

- APIのmodeパラメータはオプション（デフォルト: ROAS_MAXIMIZE）
- 既存のAPI呼び出しはそのまま動作（ROAS最大化モードとして実行）
- 現在の動作（集客数増加モード相当）を維持したい場合は明示的にmode指定が必要

## 10. リリース計画

### Phase 1: バックエンド実装
1. OptimizationServiceにモード対応を追加
2. コントローラーにmode受け取りを追加
3. 単体テスト実施

### Phase 2: GitHub Actions更新
1. budget-optimization.ymlにmode追加
2. 自動実行テスト

### Phase 3: フロントエンド実装
1. モード選択UIを追加
2. API呼び出しにmode追加
3. 統合テスト

### Phase 4: 本番デプロイ
1. バックエンドデプロイ
2. フロントエンドデプロイ
3. 動作確認

## 11. 用語集

| 用語 | 説明 |
|------|------|
| ROAS | Return On Ad Spend（広告費用対効果） |
| CBO | Campaign Budget Optimization（キャンペーン予算最適化） |
| CPA | Cost Per Acquisition（獲得単価） |
| CPO | Cost Per Order（注文単価） |
| フロントCPO | フロント商品の獲得単価 |
