# 予算増額クールダウン機能 要件定義書

## 1. 概要

予算調整システムに「予算増額クールダウン機能」を導入する。
予算増額後、一定期間は再度の予算増額を行わないことで、急激な予算拡大を防ぎ、広告パフォーマンスの安定性を確保する。

## 2. 背景・目的

### 2.1 現状の課題

現在の予算調整ロジックでは、毎日の最適化実行時に予算増額判定（`INCREASE_BUDGET`）を満たした場合、連日で予算が30%ずつ増額される。

**問題点：**
- 連日の増額により予算が急激に拡大（例: 10,000円 → 13,000円 → 16,900円 → 21,970円...）
- パフォーマンスが安定しないまま予算が増え続けるリスク
- 予算増額後のパフォーマンス変化を観察する期間がない

### 2.2 目的

- 予算増額後、一定のクールダウン期間を設けてパフォーマンスを観察する
- 急激な予算拡大を防ぎ、広告費の効率的な運用を実現する
- 既存のシステム動作に影響を与えず、安全に機能追加する

## 3. 機能要件

### 3.1 クールダウン期間の定義

| 項目 | 値 | 説明 |
|------|-----|------|
| クールダウン期間 | 3日間 | 予算増額後、次の増額を行わない期間 |
| 計算基準日 | 予算増額実行日 | ChangeLogのcreatedAt |

### 3.2 クールダウンの動作例

```
12/30: 予算増額実行 → ChangeLogに記録
12/31: 増額判定でも増額しない（クールダウン1日目）
01/01: 増額判定でも増額しない（クールダウン2日目）
01/02: 増額判定でも増額しない（クールダウン3日目）
01/03: 増額判定なら増額実行可能（クールダウン終了）
```

### 3.3 クールダウンの適用対象

| 対象 | 適用 | 説明 |
|------|------|------|
| 広告セット予算（非CBO） | ○ | AdGroup単位でクールダウンを適用 |
| キャンペーン予算（CBO） | ○ | Campaign単位でクールダウンを適用 |
| Smart+広告セット予算 | ○ | AdGroup単位でクールダウンを適用 |
| Smart+キャンペーン予算 | ○ | Campaign単位でクールダウンを適用 |
| Phase 2 旧スマートプラス | ○ | Campaign単位でクールダウンを適用 |

### 3.4 クールダウン判定ロジック

#### 3.4.1 クールダウン中かどうかの判定

```typescript
/**
 * クールダウン期間中かどうかを判定
 * @param entityType 'ADGROUP' | 'CAMPAIGN'
 * @param entityId 広告セットID または キャンペーンID
 * @param cooldownDays クールダウン日数（デフォルト: 3）
 * @returns true: クールダウン中（増額不可）, false: クールダウン終了（増額可能）
 */
async isInCooldown(entityType: string, entityId: string, cooldownDays: number = 3): Promise<boolean> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - cooldownDays);

  const recentBudgetIncrease = await prisma.changeLog.findFirst({
    where: {
      entityType,
      entityId,
      action: 'UPDATE_BUDGET',
      createdAt: {
        gt: cutoffDate,
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return recentBudgetIncrease !== null;
}
```

#### 3.4.2 予算変更ログの構造（既存）

```sql
-- ChangeLogテーブル（変更なし）
model ChangeLog {
  id              String      @id @default(uuid())
  entityType      String      -- 'ADGROUP' or 'CAMPAIGN'
  entityId        String      -- adgroupId or campaignId
  action          String      -- 'UPDATE_BUDGET'
  source          String      -- 'OPTIMIZATION'
  beforeData      Json?       -- { budget: 10000 }
  afterData       Json?       -- { budget: 13000 }
  reason          String?     -- 予算を30%増額（10000 → 13000）
  createdAt       DateTime    @default(now())
}
```

### 3.5 クールダウン適用時の動作

| 状況 | 動作 | ログ出力 |
|------|------|----------|
| クールダウン中 + 増額判定 | 増額スキップ、継続配信 | `Skipping budget increase for [entityId]: cooldown period active (last increase: [date])` |
| クールダウン終了 + 増額判定 | 通常通り増額実行 | 既存のログ出力 |
| クールダウン中 + 継続判定 | 通常通り継続 | 変更なし |
| クールダウン中 + 停止判定 | 通常通り停止 | 変更なし |

### 3.6 クールダウンが適用されないケース

以下のケースではクールダウンは適用されない（通常通りの動作）：

1. **停止判定（PAUSE）** - パフォーマンスが悪い場合は即座に停止すべき
2. **継続判定（CONTINUE）** - 予算変更が発生しないため関係なし
3. **予算減額** - 現状のシステムでは予算減額ロジックがないため対象外
4. **日中CPA最適化による停止** - IntradayOptimizationServiceが独自に管理するため対象外

## 4. 実装仕様

### 4.1 変更対象ファイル

| ファイル | 変更内容 | 優先度 |
|----------|----------|--------|
| `optimization.service.ts` | クールダウン判定メソッド追加・`increaseBudget()` / `increaseSmartPlusBudget()` 内に組み込み | 高 |

### 4.2 重要な設計判断

#### 4.2.1 なぜ `increaseBudget()` 内でクールダウン判定するのか

**問題点の発見:**

`increaseBudget()` メソッド内では、広告セット情報を取得後に再度予算タイプを判定している：

```typescript
// increaseBudget() 内 (1213行目付近)
if (adgroup.budget_mode && adgroup.budget) {
  // 広告セット予算 → logChange('ADGROUP', adgroupId, ...)
} else {
  // キャンペーン予算 → logChange('CAMPAIGN', campaign_id, ...)
}
```

もし呼び出し元（`executeAdGroupBudgetChange` 等）でクールダウン判定すると：
1. `executeAdGroupBudgetChange()` で `ADGROUP` としてクールダウン判定
2. しかし `increaseBudget()` 内でキャンペーン予算として更新、`CAMPAIGN` としてログ記録
3. 次回実行時、`ADGROUP` でクールダウン判定 → ログがない → **誤ってクールダウンなしと判定**
4. **結果：連日で増額されてしまうバグが発生！**

**解決策:**

クールダウン判定を `increaseBudget()` と `increaseSmartPlusBudget()` の**内部**に配置し、実際にログ記録される entityType と一致させる。

### 4.3 型定義の変更

`AdGroupOptimizationResult` インターフェースの `action` に新しい値を追加：

```typescript
// 変更箇所: 約86行目～

export interface AdGroupOptimizationResult {
  adgroupId: string;
  campaignId: string;
  action: 'PAUSE' | 'CONTINUE' | 'INCREASE_BUDGET' | 'NO_CHANGE' | 'ERROR' | 'SKIPPED_DUE_TO_CAP' | 'SKIPPED_DUE_TO_COOLDOWN'; // ★ 追加
  reason: string;
  isCBO: boolean;
  isSmartPlus?: boolean;
  oldBudget?: number;
  newBudget?: number;
  error?: string;
}
```

### 4.4 変更箇所の詳細

#### 4.4.1 新規メソッド追加

```typescript
// optimization.service.ts

/**
 * 予算増額クールダウン期間中かどうかを判定
 * @param entityType 'ADGROUP' | 'CAMPAIGN'
 * @param entityId 広告セットID または キャンペーンID
 * @param cooldownDays クールダウン日数（デフォルト: 3）
 * @returns { isInCooldown: boolean, lastIncreaseDate?: Date }
 */
private async checkBudgetIncreaseCooldown(
  entityType: 'ADGROUP' | 'CAMPAIGN',
  entityId: string,
  cooldownDays: number = 3,
): Promise<{ isInCooldown: boolean; lastIncreaseDate?: Date }> {
  try {
    // 過去N日以内の予算増額ログを検索
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - cooldownDays);

    const recentBudgetIncrease = await this.prisma.changeLog.findFirst({
      where: {
        entityType,
        entityId,
        action: 'UPDATE_BUDGET',
        source: 'OPTIMIZATION', // 自動最適化による増額のみを対象
        createdAt: {
          gt: cutoffDate,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentBudgetIncrease) {
      return {
        isInCooldown: true,
        lastIncreaseDate: recentBudgetIncrease.createdAt,
      };
    }

    return { isInCooldown: false };
  } catch (error) {
    // DBエラー時は安全側に倒してクールダウン中として扱う
    this.logger.error(`Failed to check cooldown for ${entityType} ${entityId}: ${error.message}`);
    return { isInCooldown: true, lastIncreaseDate: undefined };
  }
}
```

#### 4.4.2 increaseBudget() の変更

```typescript
// 変更箇所: 約1167行目～

private async increaseBudget(
  adgroupId: string,
  advertiserId: string,
  accessToken: string,
  increaseRate: number,
) {
  try {
    this.logger.log(`Increasing budget for adgroup: ${adgroupId} by ${increaseRate * 100}%`);

    // 広告セット情報を取得
    const adgroup = await this.tiktokService.getAdGroup(advertiserId, accessToken, adgroupId);
    this.logger.log(`AdGroup fetched: budget=${adgroup.budget}, budget_mode=${adgroup.budget_mode}`);

    // ★ 予算タイプを判定（この後のクールダウン判定で使用）
    const isAdGroupBudget = !!(adgroup.budget_mode && adgroup.budget);

    // ★ クールダウンチェック（実際に更新されるエンティティタイプで判定）
    const cooldownEntityType = isAdGroupBudget ? 'ADGROUP' : 'CAMPAIGN';
    const cooldownEntityId = isAdGroupBudget ? adgroupId : adgroup.campaign_id;
    const cooldownCheck = await this.checkBudgetIncreaseCooldown(cooldownEntityType, cooldownEntityId);

    if (cooldownCheck.isInCooldown) {
      this.logger.log(
        `Skipping budget increase for ${cooldownEntityType} ${cooldownEntityId}: cooldown period active ` +
        `(last increase: ${cooldownCheck.lastIncreaseDate?.toISOString()})`
      );
      return {
        success: true,
        [isAdGroupBudget ? 'adgroupId' : 'campaignId']: cooldownEntityId,
        action: 'SKIPPED_DUE_TO_COOLDOWN',
        reason: `クールダウン期間中のため増額スキップ（前回増額: ${cooldownCheck.lastIncreaseDate?.toLocaleDateString('ja-JP') || '不明'}）`,
      };
    }

    // 以降は既存の処理を続行...
    const currentBudget = adgroup.budget;
    let newBudget = Math.floor(currentBudget * (1 + increaseRate));
    // ...
  }
}
```

#### 4.4.3 increaseSmartPlusBudget() の変更

```typescript
// 変更箇所: 約1384行目～

private async increaseSmartPlusBudget(
  adgroupId: string,
  campaignId: string,
  advertiserId: string,
  accessToken: string,
  increaseRate: number,
) {
  try {
    this.logger.log(`Increasing Smart+ budget for adgroup: ${adgroupId}, campaign: ${campaignId} by ${increaseRate * 100}%`);

    // Smart+キャンペーン情報を取得してCBOが有効かどうかを確認
    const campaignsResponse = await this.tiktokService.getCampaigns(advertiserId, accessToken);
    const campaign = campaignsResponse.data?.list?.find((c: any) => c.campaign_id === campaignId);

    if (!campaign) {
      throw new Error(`Smart+ campaign not found: ${campaignId}`);
    }

    // CBO有効かどうかを判定
    const isCBOEnabled = campaign.budget_optimize_on === true && campaign.budget_mode !== 'BUDGET_MODE_INFINITE';

    // ★ クールダウンチェック（実際に更新されるエンティティタイプで判定）
    const cooldownEntityType = isCBOEnabled ? 'CAMPAIGN' : 'ADGROUP';
    const cooldownEntityId = isCBOEnabled ? campaignId : adgroupId;
    const cooldownCheck = await this.checkBudgetIncreaseCooldown(cooldownEntityType, cooldownEntityId);

    if (cooldownCheck.isInCooldown) {
      this.logger.log(
        `Skipping Smart+ budget increase for ${cooldownEntityType} ${cooldownEntityId}: cooldown period active ` +
        `(last increase: ${cooldownCheck.lastIncreaseDate?.toISOString()})`
      );
      return {
        success: true,
        [isCBOEnabled ? 'campaignId' : 'adgroupId']: cooldownEntityId,
        action: 'SKIPPED_DUE_TO_COOLDOWN',
        reason: `クールダウン期間中のため増額スキップ（前回増額: ${cooldownCheck.lastIncreaseDate?.toLocaleDateString('ja-JP') || '不明'}）`,
        isSmartPlus: true,
      };
    }

    // 以降は既存の処理を続行...
    if (isCBOEnabled) {
      // CBO有効：キャンペーン予算を更新
      // ...
    } else {
      // CBO無効：広告セット予算を更新
      // ...
    }
  }
}
```

#### 4.4.4 呼び出し元での結果ハンドリング

`executeAdGroupBudgetChange()` と `executeCBOCampaignOptimization()` では、`increaseBudget()` / `increaseSmartPlusBudget()` の戻り値で `action: 'SKIPPED_DUE_TO_COOLDOWN'` を確認し、適切に結果を返す。

```typescript
// executeAdGroupBudgetChange() の変更例
private async executeAdGroupBudgetChange(
  result: AdGroupOptimizationResult,
  advertiserId: string,
  accessToken: string,
  dryRun: boolean = false,
): Promise<AdGroupOptimizationResult> {
  if (result.action !== 'INCREASE_BUDGET') {
    return result;
  }

  try {
    if (dryRun) {
      // ... 既存のdryRun処理 ...
    }

    let budgetResult;
    if (result.isSmartPlus) {
      budgetResult = await this.increaseSmartPlusBudget(result.adgroupId, result.campaignId, advertiserId, accessToken, 0.3);
    } else {
      budgetResult = await this.increaseBudget(result.adgroupId, advertiserId, accessToken, 0.3);
    }

    // ★ クールダウンでスキップされた場合の処理
    if (budgetResult.action === 'SKIPPED_DUE_TO_COOLDOWN') {
      return {
        ...result,
        action: 'CONTINUE', // 増額判定だが継続に変更
        reason: budgetResult.reason,
      };
    }

    return {
      ...result,
      reason: `${result.reason}${result.isSmartPlus ? '（Smart+ API使用）' : ''}`,
    };
  } catch (error) {
    // ...
  }
}
```

## 5. 既存システムへの影響

### 5.1 影響を受けるコンポーネント

| コンポーネント | 影響度 | 影響内容 |
|----------------|--------|----------|
| `optimization.service.ts` | 中 | クールダウン判定の追加 |
| ChangeLog テーブル | なし | 既存の構造をそのまま使用 |
| 通知機能 | なし | 変更なし |
| 日中CPA最適化 | なし | 独立したサービスなので影響なし |

### 5.2 後方互換性

| 項目 | 互換性 | 説明 |
|------|--------|------|
| API | 完全互換 | APIの入出力に変更なし |
| ChangeLog | 完全互換 | 既存のログ構造を使用 |
| 判定ロジック | 完全互換 | 判定自体は既存のまま（実行時にスキップ判定を追加） |

### 5.3 既存動作への影響マトリクス

| シナリオ | 変更前 | 変更後 |
|----------|--------|--------|
| 初回の予算増額判定 | 増額実行 | 増額実行（変更なし） |
| 前日に増額した広告の再増額判定 | 増額実行 | **増額スキップ（継続）** |
| 3日前に増額した広告の再増額判定 | 増額実行 | **増額スキップ（継続）** |
| 4日前に増額した広告の再増額判定 | 増額実行 | 増額実行（変更なし） |
| 継続判定 | 継続 | 継続（変更なし） |
| 停止判定 | 停止 | 停止（変更なし） |
| 手動で予算変更した広告 | 増額実行 | 増額実行（source='MANUAL'は対象外） |
| 非CBO広告セットが実際はキャンペーン予算 | 増額実行 | **正しくCAMPAIGNでクールダウン判定** |
| Smart+のCBO/非CBO切り替え | 増額実行 | **正しいentityTypeでクールダウン判定** |

## 6. テスト要件

### 6.1 単体テスト

| テストケース | 入力 | 期待結果 |
|--------------|------|----------|
| クールダウン判定: 増額ログなし | entityId='xxx', 過去ログなし | isInCooldown: false |
| クールダウン判定: 1日前に増額 | entityId='xxx', 1日前にUPDATE_BUDGET | isInCooldown: true |
| クールダウン判定: 3日前に増額 | entityId='xxx', 3日前にUPDATE_BUDGET | isInCooldown: true |
| クールダウン判定: 4日前に増額 | entityId='xxx', 4日前にUPDATE_BUDGET | isInCooldown: false |
| クールダウン判定: 手動変更あり | entityId='xxx', source='MANUAL'で1日前 | isInCooldown: false |
| クールダウン判定: 別エンティティ | entityId='yyy'に増額ログあり | isInCooldown: false（entityId='xxx'に対して） |

### 6.2 統合テスト

| テストケース | 手順 | 期待結果 |
|--------------|------|----------|
| 非CBO広告セット: 通常増額 | 1. 増額判定となる広告を用意<br>2. 最適化実行 | 増額が実行される |
| 非CBO広告セット: クールダウン | 1. 広告セットAを増額<br>2. 翌日に再度最適化実行 | 増額スキップ、CONTINUE |
| CBO キャンペーン: 通常増額 | 1. 増額判定となるCBOキャンペーンを用意<br>2. 最適化実行 | 増額が実行される |
| CBO キャンペーン: クールダウン | 1. キャンペーンBを増額<br>2. 翌日に再度最適化実行 | 増額スキップ、CONTINUE |
| Smart+: 通常増額 | 1. 増額判定となるSmart+広告を用意<br>2. 最適化実行 | 増額が実行される |
| Smart+: クールダウン | 1. Smart+キャンペーンCを増額<br>2. 翌日に再度最適化実行 | 増額スキップ、CONTINUE |

### 6.3 エッジケーステスト

| テストケース | 説明 | 期待結果 |
|--------------|------|----------|
| 境界値: 72時間後 | ちょうど72時間後（3日後）に実行 | 増額可能 |
| 境界値: 71時間59分後 | 3日経過していない | 増額スキップ |
| 日付変更前後 | JST 23:59と00:00の間で実行 | 正しく日数計算される |
| 複数エンティティ | 同一アカウント内で別広告セット | 各広告セット独立で判定 |
| データベース接続エラー | ChangeLog検索時にエラー | エラーをログ出力し、安全側（増額スキップ）に倒す |

### 6.4 entityType整合性テスト（重要）

これらのテストは、クールダウン判定とログ記録のentityTypeが一致することを検証する。

| テストケース | 手順 | 期待結果 |
|--------------|------|----------|
| 非CBO → キャンペーン予算更新 | 1. `executeAdGroupBudgetChange()` が呼ばれる<br>2. `increaseBudget()` 内でキャンペーン予算として更新 | `CAMPAIGN` としてクールダウン判定され、`CAMPAIGN` としてログ記録 |
| CBO → キャンペーン予算更新 | 1. `executeCBOCampaignOptimization()` が呼ばれる<br>2. `increaseBudget()` 内でキャンペーン予算として更新 | `CAMPAIGN` としてクールダウン判定され、`CAMPAIGN` としてログ記録 |
| Smart+ CBO有効 | 1. Smart+広告で増額判定<br>2. `increaseSmartPlusBudget()` が呼ばれる | `CAMPAIGN` としてクールダウン判定され、`CAMPAIGN` としてログ記録 |
| Smart+ CBO無効 | 1. Smart+広告で増額判定<br>2. `increaseSmartPlusBudget()` が呼ばれる | `ADGROUP` としてクールダウン判定され、`ADGROUP` としてログ記録 |
| 翌日の再増額判定（整合性確認） | 1. 広告セットAを増額（実際はCAMPAIGNとして記録）<br>2. 翌日に同じ広告セットで増額判定 | `CAMPAIGN` でクールダウン判定 → スキップ |

## 7. 設定値

### 7.1 ハードコード値

| 項目 | 値 | 理由 |
|------|-----|------|
| クールダウン日数 | 3 | ビジネス要件 |

### 7.2 将来的な拡張オプション

将来的に環境変数で設定可能にする場合：

```bash
# .env
BUDGET_INCREASE_COOLDOWN_DAYS=3
```

```typescript
// ConfigServiceから取得
const cooldownDays = this.configService.get<number>('BUDGET_INCREASE_COOLDOWN_DAYS', 3);
```

**初期リリースではハードコード（3日）とし、運用を見て設定化を検討する。**

## 8. ログ・監視

### 8.1 ログ出力

| イベント | ログレベル | メッセージ例 |
|----------|------------|--------------|
| クールダウンによるスキップ | LOG | `Skipping budget increase for adgroup 123: cooldown period active (last increase: 2024-12-30T15:00:00Z)` |
| クールダウン終了で増額実行 | LOG | 既存のログ（変更なし） |

### 8.2 監視項目

| 項目 | 監視方法 | 閾値 |
|------|----------|------|
| クールダウンスキップ件数 | ログ集計 | 情報収集目的（アラートなし） |
| クールダウン後の増額件数 | ログ集計 | 情報収集目的（アラートなし） |

## 9. リリース計画

### Phase 1: 実装・テスト

1. `checkBudgetIncreaseCooldown` メソッドの追加
2. `executeAdGroupBudgetChange` への組み込み
3. `executeCBOCampaignOptimization` への組み込み
4. Phase 2（旧スマートプラス）への組み込み
5. 単体テスト・統合テスト実施

### Phase 2: ステージング検証

1. ステージング環境でのテスト
2. 実際の広告データを使った動作確認
3. ログ出力の確認

### Phase 3: 本番デプロイ

1. 本番デプロイ
2. 動作監視（1週間）
3. 効果測定

## 10. FAQ

### Q1: なぜ3日間なのか？

A: 予算増額後、パフォーマンスの変化が安定するまでに通常2-3日かかるため。短すぎると効果測定ができず、長すぎると機会損失になる。

### Q2: 手動で予算を変更した場合はどうなる？

A: source='MANUAL' のログはクールダウン判定の対象外。手動変更後も自動増額は通常通り判定される。

### Q3: クールダウン期間を変更したい場合は？

A: 現状はハードコードだが、将来的に環境変数化を検討。運用経験を積んでから適切な設定値を決定する。

### Q4: クールダウン中に停止判定になった場合は？

A: 停止判定はクールダウンの影響を受けず、通常通り停止される。パフォーマンスが悪い広告は即座に停止すべきという考え方。

### Q5: 同一キャンペーン内の別広告セットはどうなる？

A: 非CBO の場合、各広告セットは独立してクールダウン判定される。CBO の場合はキャンペーン単位でクールダウン判定される。

## 11. 用語集

| 用語 | 説明 |
|------|------|
| クールダウン | 予算増額後に再増額を行わない期間 |
| CBO | Campaign Budget Optimization（キャンペーン予算最適化） |
| 非CBO | 広告セット単位で予算が設定されている場合 |
| Smart+ | TikTokの自動化広告タイプ |
| Phase 2 | 旧スマートプラス（キャンペーン単位で評価）の処理フェーズ |
