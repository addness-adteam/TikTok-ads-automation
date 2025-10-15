# Contributing Guide

TikTok広告運用自動化システムへのコントリビューションガイドです。

## 🎯 コントリビューション方針

このプロジェクトへの貢献を歓迎します！バグ報告、機能提案、ドキュメント改善、コード貢献など、どのような形でも大歓迎です。

## 📋 開発フロー

### 1. Issue作成

新しい機能やバグ修正を始める前に、まずIssueを作成してください。

- **バグ報告**: [Bug Report テンプレート](.github/ISSUE_TEMPLATE/bug_report.md)
- **機能提案**: [Feature Request テンプレート](.github/ISSUE_TEMPLATE/feature_request.md)

### 2. ブランチ作成

```bash
# mainブランチから最新を取得
git checkout main
git pull origin main

# 新しいブランチを作成
git checkout -b feature/your-feature-name
# または
git checkout -b fix/bug-name
```

#### ブランチ命名規則

- `feature/xxx`: 新機能
- `fix/xxx`: バグ修正
- `hotfix/xxx`: 緊急修正
- `refactor/xxx`: リファクタリング
- `docs/xxx`: ドキュメント更新
- `test/xxx`: テスト追加・修正
- `chore/xxx`: ビルド・設定変更

### 3. 開発

```bash
# 依存関係インストール
npm install

# Docker起動
make docker-up

# 開発サーバー起動
make dev
```

#### コーディング規約

- **TypeScript**: 型安全性を重視
- **ESLint**: 自動で修正 `npm run lint`
- **Prettier**: コードフォーマット `npm run format`
- **命名規則**:
  - ファイル名: `kebab-case.ts`
  - クラス名: `PascalCase`
  - 関数名: `camelCase`
  - 定数: `UPPER_SNAKE_CASE`

#### コミットメッセージ

[Conventional Commits](https://www.conventionalcommits.org/) に従ってください。

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type**:
- `feat`: 新機能
- `fix`: バグ修正
- `docs`: ドキュメント
- `style`: フォーマット
- `refactor`: リファクタリング
- `test`: テスト
- `chore`: ビルド・設定

**例**:
```
feat(backend): add TikTok OAuth authentication

- Implement OAuth 2.0 flow
- Add token refresh mechanism
- Update database schema

Closes #123
```

### 4. テスト

```bash
# 全テスト実行
npm run test

# Lint
npm run lint

# TypeScriptチェック
npm run typecheck --workspace=apps/backend
```

**テストカバレッジ**: 80%以上を目指してください。

### 5. Pull Request作成

```bash
# ブランチをプッシュ
git push origin feature/your-feature-name
```

GitHub上でPull Requestを作成してください。

#### PRテンプレート

[Pull Request テンプレート](.github/PULL_REQUEST_TEMPLATE.md) に従って記入してください。

#### PRチェックリスト

- [ ] Lint・TypeScriptエラーなし
- [ ] テスト追加・全テストパス
- [ ] ドキュメント更新
- [ ] 秘密情報をコミットしていない
- [ ] 自己レビュー実施済み

### 6. コードレビュー

- 最低1名の承認が必要
- CIチェックが全てパス
- コンフリクトを解消

### 7. マージ

承認後、maintainerがマージします。

## 🧪 テスト

### ユニットテスト

```bash
# Backend
npm run test --workspace=apps/backend

# Frontend
npm run test --workspace=apps/frontend
```

### E2Eテスト

```bash
# 準備中
```

### テスト作成ガイドライン

- **ファイル名**: `*.spec.ts` または `*.test.ts`
- **配置**: ソースコードと同じディレクトリ
- **構造**: Arrange-Act-Assert パターン

```typescript
describe('CampaignService', () => {
  describe('createCampaign', () => {
    it('should create a campaign successfully', async () => {
      // Arrange
      const input = { ... };

      // Act
      const result = await service.createCampaign(input);

      // Assert
      expect(result).toBeDefined();
      expect(result.campaignId).toBeTruthy();
    });
  });
});
```

## 📚 ドキュメント

ドキュメントは常に最新に保ってください。

- **README.md**: プロジェクト概要
- **docs/**: 詳細ドキュメント
- **コード内コメント**: 複雑なロジックには説明を追加

### ドキュメント作成

```bash
# API仕様書生成（OpenAPI）
cd apps/backend
npm run docs:generate
```

## 🔒 セキュリティ

### 秘密情報の扱い

- **環境変数**: `.env` ファイル（Git管理外）
- **APIキー**: AWS Secrets Manager等
- **絶対NG**: ハードコード、Git コミット

### 脆弱性報告

セキュリティ脆弱性を発見した場合は、**Issueに投稿せず**、直接メンテナに連絡してください。

## 🎨 UI/UX

### デザインシステム

- **UIライブラリ**: shadcn/ui
- **スタイリング**: Tailwind CSS
- **アイコン**: Lucide React

### アクセシビリティ

- WCAG 2.1 AA準拠を目指す
- キーボード操作サポート
- スクリーンリーダー対応

## 🐛 バグ修正の優先度

- **P0 (Critical)**: 本番障害、セキュリティ脆弱性 → 即時対応
- **P1 (High)**: 主要機能の不具合 → 24時間以内
- **P2 (Medium)**: 一部機能の不具合 → 1週間以内
- **P3 (Low)**: 軽微な不具合 → 次回リリース

## 📞 サポート

質問やサポートが必要な場合:

- **GitHub Discussions**: [リンク]
- **Slack**: #tiktok-ads-automation
- **メール**: [連絡先]

## 📜 ライセンス

このプロジェクトに貢献することで、あなたの貢献がプロジェクトのライセンス（MIT License）の下で公開されることに同意したものとみなされます。

---

ありがとうございます！
