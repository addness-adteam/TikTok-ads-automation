# 予算調整自動化 要件定義書

## 1. 概要

### 1.1 目的
現在手動で行っている「アカウント選択 → 予算調整を実行」のプロセスを自動化し、毎日定時に全アカウントの予算最適化を実行する。

### 1.2 現状
- フロントエンドUIから手動でアカウントを選択
- 「予算調整を実行」ボタンを押下
- バックエンドAPIが呼び出され、予算調整ロジックが実行される

### 1.3 ゴール
- 毎日決まった時間に自動で予算調整を実行
- 複数アカウントを安全に処理（レート制限を考慮）
- 実行結果の可視化と通知

---

## 2. 技術選定: RPA vs GitHub Actions (API経由)

### 2.1 比較分析

| 項目 | RPA (UiPath, Power Automate等) | GitHub Actions (API経由) |
|------|-------------------------------|-------------------------|
| **正しい挙動の保証** | △ UI操作は不安定（画面変更で破綻） | ◎ API直接呼び出しで確実 |
| **レート制限対応** | △ 難しい（タイミング制御が複雑） | ◎ プログラムで精密制御可能 |
| **複数アカウント処理** | △ 順次処理の実装が複雑 | ◎ matrix strategyで簡潔に実装 |
| **エラーハンドリング** | △ 例外処理が限定的 | ◎ リトライ・フォールバック容易 |
| **実行ログ・監視** | △ 別途ログ収集が必要 | ◎ GitHub UI で履歴確認可能 |
| **保守性** | × UI変更時に修正必要 | ◎ APIは安定・変更少ない |
| **コスト** | × ライセンス費用が発生 | ◎ 無料枠で十分（月2000分） |
| **既存資産活用** | × 新規構築 | ◎ 既存のAPI/ワークフロー活用 |

### 2.2 推奨: GitHub Actions (API経由)

**選定理由:**

1. **正しい挙動の保証**
   - RPAはUI操作に依存するため、画面レイアウト変更で動作しなくなるリスク
   - APIは契約（インターフェース）が明確で、後方互換性が維持される
   - 既存の`POST /api/optimization/execute`がそのまま使える

2. **レート制限への対応**
   - TikTok APIのレート制限: 約600リクエスト/分
   - GitHub Actionsの`max-parallel: 1`で順次処理を強制可能
   - 各アカウント間に待機時間を挿入できる

3. **既存資産との整合性**
   - 既に`daily-metrics.yml`で同様のパターンが実装済み
   - バックエンドに指数バックオフ付きリトライ機能が実装済み
   - エラー分類（T-01〜T-06）も整備済み

---

## 3. TikTok API レート制限対策

### 3.1 レート制限の仕様

| 項目 | 値 |
|------|-----|
| リクエスト上限 | 約600リクエスト/分（スライディングウィンドウ） |
| 超過時のレスポンス | HTTP 429 / エラーコード 40900 |
| リトライ可能 | ◎（Retry-Afterヘッダー参照） |

### 3.2 1アカウントあたりのAPI呼び出し概算

```
予算調整1回の処理フロー:
├── 広告一覧取得: 1-2回（ページネーション）
├── 各広告の評価:
│   ├── AdGroup情報取得: 1回/広告
│   ├── Campaign情報取得: 1回/広告
│   └── レポート取得: 1回/広告
├── 予算更新/停止: 0-N回（判定結果次第）
└── Smart+キャンペーン処理: 同様

推定: 50〜200リクエスト/アカウント（広告数に依存）
```

### 3.3 安全マージンの設計

```
アカウント数: 5〜10個（想定）
処理間隔: 各アカウント間に60秒の待機
合計時間: 約10〜20分で全アカウント処理完了

レート制限計算:
- 1アカウント200リクエスト × 5アカウント = 1000リクエスト
- 処理時間10分 → 100リクエスト/分（上限600の1/6）
- 十分な安全マージン確保
```

---

## 4. 実装設計

### 4.1 GitHub Actionsワークフロー構成

```yaml
# .github/workflows/budget-optimization.yml

name: Daily Budget Optimization

on:
  schedule:
    # 毎日3時（日本時間）= 18時（UTC前日）
    - cron: '0 18 * * *'
  workflow_dispatch:
    inputs:
      advertiser_ids:
        description: '特定のAdvertiser IDsをカンマ区切りで指定（空欄で全アカウント）'
        required: false
        type: string

env:
  API_BASE_URL: https://tik-tok-ads-automation-backend.vercel.app
  WAIT_BETWEEN_ACCOUNTS_SEC: 60

jobs:
  # Step 1: アクティブなAdvertiser IDを取得
  get-advertisers:
    runs-on: ubuntu-latest
    outputs:
      advertiser_ids: ${{ steps.get_ids.outputs.ids }}
    steps:
      - name: Get Active Advertiser IDs
        id: get_ids
        run: |
          if [ -n "${{ github.event.inputs.advertiser_ids }}" ]; then
            # 手動実行時は指定されたIDを使用
            ids=$(echo "${{ github.event.inputs.advertiser_ids }}" | jq -R -c 'split(",")')
          else
            # 自動実行時はAPIから取得
            response=$(curl -s "${{ env.API_BASE_URL }}/jobs/diagnostics")
            ids=$(echo "$response" | jq -c '[.oauthTokens.tokens[].advertiserId]')
          fi

          echo "Target advertiser IDs: $ids"
          echo "ids=$ids" >> $GITHUB_OUTPUT

  # Step 2: 各アカウントの予算最適化を順次実行
  optimize-budgets:
    runs-on: ubuntu-latest
    needs: get-advertisers
    strategy:
      fail-fast: false
      max-parallel: 1  # 重要: 順次実行でレート制限を回避
      matrix:
        advertiser_id: ${{ fromJson(needs.get-advertisers.outputs.advertiser_ids) }}
    steps:
      - name: Wait before processing
        run: |
          echo "Waiting ${{ env.WAIT_BETWEEN_ACCOUNTS_SEC }} seconds before processing..."
          sleep ${{ env.WAIT_BETWEEN_ACCOUNTS_SEC }}

      - name: Optimize Budget for ${{ matrix.advertiser_id }}
        id: optimize
        run: |
          echo "Starting budget optimization for: ${{ matrix.advertiser_id }}"

          # 最大3回リトライ
          max_retries=3
          retry_count=0

          while [ $retry_count -lt $max_retries ]; do
            response=$(curl -s -w "\n%{http_code}" --max-time 600 -X POST \
              "${{ env.API_BASE_URL }}/api/optimization/execute/${{ matrix.advertiser_id }}" \
              -H "Content-Type: application/json")

            http_code=$(echo "$response" | tail -n1)
            body=$(echo "$response" | sed '$d')

            echo "HTTP Status: $http_code"

            if [ "$http_code" -eq 200 ]; then
              echo "✅ Success for ${{ matrix.advertiser_id }}"
              echo "$body" | jq .
              break
            elif [ "$http_code" -eq 429 ]; then
              # レート制限: 指数バックオフでリトライ
              retry_count=$((retry_count + 1))
              wait_time=$((60 * retry_count))
              echo "⚠️ Rate limited. Waiting ${wait_time}s before retry $retry_count/$max_retries..."
              sleep $wait_time
            else
              echo "❌ Error for ${{ matrix.advertiser_id }}: $http_code"
              echo "$body"
              break
            fi
          done

          if [ "$http_code" -ne 200 ]; then
            echo "result=failed" >> $GITHUB_OUTPUT
          else
            echo "result=success" >> $GITHUB_OUTPUT
          fi

  # Step 3: 結果サマリーと通知
  summary:
    runs-on: ubuntu-latest
    needs: [get-advertisers, optimize-budgets]
    if: always()
    steps:
      - name: Generate Summary
        run: |
          echo "## Budget Optimization Summary" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "- **Execution Time**: $(date -u '+%Y-%m-%d %H:%M:%S UTC')" >> $GITHUB_STEP_SUMMARY
          echo "- **Accounts Processed**: ${{ needs.get-advertisers.outputs.advertiser_ids }}" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY

          # 詳細ログへのリンク
          echo "See job logs for detailed results." >> $GITHUB_STEP_SUMMARY
```

### 4.2 バックエンドAPI拡張（オプション）

既存エンドポイントを活用しつつ、自動化向けに以下を追加検討:

```typescript
// 新規エンドポイント: 自動化用（進捗レポート付き）
@Post('execute-automated')
async executeAutomatedOptimization(
  @Body() body: {
    advertiserIds?: string[];  // 未指定時は全アカウント
    dryRun?: boolean;          // テスト実行モード
  }
) {
  // レート制限を考慮した実行
  // 1アカウントずつ処理、間に30秒待機
}
```

---

## 5. レート制限対策の詳細設計

### 5.1 多層防御アプローチ

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: GitHub Actions                                 │
│   - max-parallel: 1 で順次実行                          │
│   - 各アカウント間に60秒待機                            │
├─────────────────────────────────────────────────────────┤
│ Layer 2: Backend API                                    │
│   - withRetry() で指数バックオフ（1s→2s→4s）            │
│   - HTTP 429 / 40900 検出でリトライ                     │
│   - Retry-Afterヘッダーを尊重                           │
├─────────────────────────────────────────────────────────┤
│ Layer 3: TikTok API                                     │
│   - 既存のhttpGetWithRetry/httpPostWithRetry            │
│   - タイムアウト設定（デフォルト30秒）                  │
└─────────────────────────────────────────────────────────┘
```

### 5.2 エラー発生時の挙動

| エラー種別 | 対応 |
|-----------|------|
| レート制限 (429/40900) | 60秒待機後にリトライ（最大3回） |
| 認証エラー (401) | 即時失敗、通知送信 |
| サーバーエラー (5xx) | 指数バックオフでリトライ |
| タイムアウト | リトライ後、次アカウントへ |
| 1アカウント失敗 | ログ記録、他アカウントは継続 |

---

## 6. 実行スケジュール

### 6.1 推奨スケジュール

| 処理 | 実行時刻 (JST) | 理由 |
|------|---------------|------|
| メトリクス収集 | 0:05 | 前日のデータ確定後 |
| **予算最適化** | **3:00** | メトリクス収集完了後、深夜の低負荷時間帯 |

### 6.2 処理順序の依存関係

```
Daily Metrics (0:05)
     ↓ メトリクスをDBに格納
Budget Optimization (3:00)
     ↓ 最新メトリクスを参照して判定
     ↓ 予算更新/広告停止を実行
```

---

## 7. 監視・通知

### 7.1 GitHub Actions標準機能

- ワークフロー失敗時のメール通知（GitHub設定で有効化）
- `$GITHUB_STEP_SUMMARY`で実行結果をマークダウン表示

### 7.2 追加実装（オプション）

```typescript
// Slack/Discord通知
async function notifyOptimizationResult(result: OptimizationResult) {
  if (result.hasErrors) {
    await sendSlackAlert({
      channel: '#tiktok-ads-alerts',
      message: `⚠️ 予算最適化でエラー発生: ${result.errorCount}件`,
      details: result.errors
    });
  }
}
```

---

## 8. テスト計画

### 8.1 段階的ロールアウト

| Phase | 内容 | 期間 |
|-------|------|------|
| Phase 1 | 単一アカウントで手動実行テスト | 1日 |
| Phase 2 | 全アカウントで手動実行テスト | 2日 |
| Phase 3 | スケジュール実行（週1回） | 1週間 |
| Phase 4 | 本番運用（毎日実行） | 継続 |

### 8.2 検証項目

- [ ] 全アカウントが正常に処理されること
- [ ] レート制限エラーが発生しないこと
- [ ] 1アカウント失敗時に他アカウントが継続すること
- [ ] 実行ログが正しく記録されること
- [ ] 予算変更がChangeLogに記録されること

---

## 9. 実装タスク

### 9.1 必須タスク

1. [ ] `budget-optimization.yml` ワークフローの作成
2. [ ] ワークフロー手動実行でのテスト
3. [ ] 本番スケジュール有効化

### 9.2 オプションタスク

1. [ ] Slack/Discord通知の実装
2. [ ] ダッシュボードへの実行履歴表示
3. [ ] dryRunモードの実装
4. [ ] 特定アカウント除外機能

---

## 10. 結論

**GitHub Actions (API経由) を採用**

理由:
1. 既存の`daily-metrics.yml`パターンを踏襲し、学習コストゼロ
2. APIは安定しており、RPAのようなUI依存の脆弱性がない
3. レート制限対策が`max-parallel: 1`と待機時間で簡潔に実装可能
4. 無料枠内で運用可能（月2000分、1回10-20分×30日=300-600分）
5. 既存のリトライ機構（`withRetry`、`httpGetWithRetry`）を活用できる

RPAは以下の理由で不採用:
- UI変更への脆弱性
- レート制限対応の困難さ
- ライセンスコスト
- 既存資産との乖離
