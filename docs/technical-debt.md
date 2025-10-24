# TikTok広告運用自動化システム - 技術的負債リスト

**最終更新日:** 2025-10-24
**Phase:** 0 (PoC完了時点)

---

## 📋 優先度凡例

- 🔴 **Critical** - Phase 1開始前に対応必須
- 🟡 **High** - Phase 1中に対応推奨
- 🟢 **Medium** - Phase 2以降で対応可能
- ⚪ **Low** - 将来的に検討

---

## 🔴 Critical（必須対応）

### 1. セキュリティ強化

**問題:**
- OAuth State パラメータが固定値（`"STATE"`）
- 暗号化キーが環境変数に平文保存
- CSRF対策が不十分

**影響:**
- セキュリティリスク
- OAuth認証の脆弱性

**対応方法:**
\`\`\`typescript
// tiktok.service.ts
getAuthUrl(): string {
  // ランダムなStateを生成してRedisに保存
  const state = crypto.randomBytes(32).toString('hex');
  await this.redis.set(\`oauth:state:\${state}\`, '1', 'EX', 600);
  
  const params = new URLSearchParams({
    app_id: this.appId,
    redirect_uri: this.redirectUri,
    state: state,  // ランダム値
  });
  return \`https://business-api.tiktok.com/portal/auth?\${params.toString()}\`;
}
\`\`\`

**期限:** Phase 1開始前（Week 5まで）

---

### 2. エラーハンドリングの改善

**問題:**
- エラーレスポンスの形式が統一されていない
- エラーログに機密情報（トークン等）が含まれる可能性
- リトライロジックが未実装

**影響:**
- デバッグが困難
- セキュリティリスク
- APIの信頼性低下

**対応方法:**
\`\`\`typescript
// エラーハンドリングミドルウェア
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    // 統一されたエラーレスポンス
    const response = {
      success: false,
      error: {
        code: this.getErrorCode(exception),
        message: this.getSafeErrorMessage(exception),
        timestamp: new Date().toISOString(),
      }
    };
  }
}
\`\`\`

**期限:** Phase 1開始前（Week 5まで）

---

### 3. トークン自動リフレッシュ機構

**問題:**
- アクセストークンの自動更新が未実装
- 有効期限切れ時の処理が不完全

**影響:**
- 24時間後にAPIアクセス不可
- 手動でのトークン更新が必要

**対応方法:**
\`\`\`typescript
// token-refresh.service.ts
@Cron('0 */1 * * *')  // 1時間ごとにチェック
async refreshExpiring Tokens() {
  const expiringTokens = await this.prisma.oAuthToken.findMany({
    where: {
      expiresAt: {
        lte: new Date(Date.now() + 30 * 60 * 1000)  // 30分以内
      }
    }
  });
  
  for (const token of expiringTokens) {
    await this.tiktokService.refreshAccessToken(token.refreshToken);
  }
}
\`\`\`

**期限:** Phase 1開始前（Week 5まで）

---

## 🟡 High（Phase 1中に対応）

### 4. テストコード不足

**問題:**
- ユニットテストがほぼ未実装
- E2Eテストが未実装
- テストカバレッジ < 10%

**影響:**
- リグレッションリスク
- リファクタリングが困難

**対応方法:**
\`\`\`bash
# 目標
- ユニットテストカバレッジ ≥ 80%
- E2Eテスト: 主要フロー全て
\`\`\`

**期限:** Phase 1中（Week 5-12）

---

### 5. API レート制限の実装

**問題:**
- Token Bucket アルゴリズムが未実装
- 429エラー時の指数バックオフが未実装
- レート制限の可視化がない

**影響:**
- TikTok APIからのBANリスク
- ユーザー体験の悪化

**対応方法:**
\`\`\`typescript
// rate-limiter.service.ts
export class RateLimiterService {
  async checkLimit(endpoint: string): Promise<boolean> {
    const key = \`rate:\${endpoint}\`;
    const current = await this.redis.get(key);
    if (current >= 600) {  // 600リクエスト/分
      throw new TooManyRequestsException();
    }
    await this.redis.incr(key);
    await this.redis.expire(key, 60);
    return true;
  }
}
\`\`\`

**期限:** Phase 1中（Week 8まで）

---

### 6. データベースクエリ最適化

**問題:**
- N+1問題が発生する可能性
- インデックスが不足
- クエリキャッシュ未実装

**影響:**
- パフォーマンス低下
- データ量増加時のスケーラビリティ問題

**対応方法:**
\`\`\`typescript
// Prisma include で N+1 解消
const campaigns = await this.prisma.campaign.findMany({
  include: {
    adGroups: {
      include: {
        ads: true,
        metrics: true
      }
    },
    metrics: true
  }
});
\`\`\`

**期限:** Phase 1中（Week 10まで）

---

## 🟢 Medium（Phase 2以降）

### 7. ロギング・監視の強化

**問題:**
- 構造化ログが未実装
- メトリクス収集が未実装
- アラート設定が不完全

**対応方法:**
- OpenTelemetry導入
- Prometheus/Grafana連携
- Sentry エラートラッキング

**期限:** Phase 2（Week 13-24）

---

### 8. フロントエンドの型安全性

**問題:**
- APIレスポンスの型定義が不完全
- any型の使用が多い
- バックエンドとフロントエンドで型定義が重複

**対応方法:**
- tRPC または GraphQL導入
- Zodによるランタイムバリデーション
- 共有型パッケージの活用

**期限:** Phase 2（Week 15まで）

---

### 9. Dockerコンテナ化

**問題:**
- ローカル環境のセットアップが複雑
- 環境差分によるバグリスク

**対応方法:**
\`\`\`yaml
# docker-compose.yml
services:
  backend:
    build: ./apps/backend
    ports:
      - "4000:4000"
  frontend:
    build: ./apps/frontend
    ports:
      - "3000:3000"
  postgres:
    image: postgres:16
\`\`\`

**期限:** Phase 2（Week 20まで）

---

## ⚪ Low（将来検討）

### 10. GraphQL API実装

**問題:**
- RESTful APIのN回リクエスト問題
- Over-fetching/Under-fetching

**対応方法:**
- Apollo Server導入
- GraphQL Codegen

**期限:** Phase 3以降

---

### 11. マイクロサービス化

**問題:**
- モノリシックアーキテクチャ
- 機能追加時のデプロイリスク

**対応方法:**
- サービス分割（Auth, Campaign, Reporting, Optimization）
- メッセージキュー（RabbitMQ/Kafka）

**期限:** Phase 3以降（必要性を判断）

---

## 📊 リファクタリング候補

### コード品質改善

1. **循環的複雑度の削減**
   - `tiktokService.saveReportMetrics()` が長すぎる（80行）
   - 分割推奨

2. **マジックナンバーの定数化**
   - `24時間` → `TOKEN_EXPIRATION_HOURS`
   - `1000件` → `DEFAULT_PAGE_SIZE`

3. **重複コードの削除**
   - Campaign/AdGroup/Ad のCRUD処理に類似パターン
   - 共通基底クラス作成を検討

---

## 🎯 Phase 1での対応計画

| タスク | 優先度 | 担当 | 期限 |
|--------|--------|------|------|
| OAuth State ランダム化 | 🔴 | Backend | Week 5 |
| エラーハンドリング統一 | 🔴 | Backend | Week 5 |
| トークン自動リフレッシュ | 🔴 | Backend | Week 6 |
| レート制限実装 | 🟡 | Backend | Week 8 |
| テストコード追加 | 🟡 | All | Week 5-12 |
| DB最適化 | 🟡 | Backend | Week 10 |

---

**作成日:** 2025-10-24
**次の更新:** Phase 1開始時に進捗確認
