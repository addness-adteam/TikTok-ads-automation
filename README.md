# TikTok広告運用自動化システム

TikTok Ads（Auction型）の広告運用を自動化し、誰でも最適運用できる環境を提供するシステムです。

## 📋 要件定義

- [要件定義 v2.0](./TikTok広告運用自動化システム_v2.0_改訂版.txt)
- [実装タスク一覧](./実装タスク一覧.txt)

## 🏗️ アーキテクチャ

### Monorepo 構成（Turborepo）

```
TikTok-ads-automation/
├── apps/
│   ├── backend/          # NestJS API Server
│   └── frontend/         # Next.js Web App
├── packages/
│   ├── shared-types/     # 共有型定義
│   ├── eslint-config/    # 共有ESLint設定
│   └── tsconfig/         # 共有TypeScript設定
├── docs/                 # ドキュメント
├── docker-compose.yml    # ローカル開発環境
└── turbo.json           # Turborepo設定
```

### 技術スタック

**バックエンド**
- Node.js 18+ / TypeScript 5.3+
- NestJS（フレームワーク）
- Prisma（ORM）
- PostgreSQL 16（メインDB）
- Redis 7（キャッシュ・ジョブキュー）
- BullMQ（ジョブ処理）

**フロントエンド**
- Next.js 14（App Router）
- React 18
- TypeScript
- Tailwind CSS + shadcn/ui
- Recharts（チャート）

**インフラ**
- AWS（本番環境）
- Docker + Docker Compose（開発環境）
- GitHub Actions（CI/CD）

**監視・ログ**
- Winston（ログ）
- Prometheus + Grafana（メトリクス）
- OpenTelemetry（トレーシング）

## 🚀 クイックスタート

### 前提条件

- Node.js 18以上
- npm 9以上
- Docker & Docker Compose
- Git

### セットアップ

```bash
# リポジトリクローン
git clone https://github.com/your-org/TikTok-ads-automation.git
cd TikTok-ads-automation

# 依存関係インストール
npm install

# 環境変数設定
cp .env.example .env
# .env ファイルを編集

# Docker で DB・Redis 起動
docker-compose up -d

# Prisma マイグレーション実行
cd apps/backend
npx prisma migrate dev

# 開発サーバー起動（全アプリ）
cd ../..
npm run dev
```

### アクセス

- フロントエンド: http://localhost:3000
- バックエンドAPI: http://localhost:3001
- Prisma Studio: http://localhost:5555

## 📦 開発

### スクリプト

```bash
# 開発サーバー起動
npm run dev

# ビルド
npm run build

# Lint
npm run lint

# テスト
npm run test

# フォーマット
npm run format

# クリーンアップ
npm run clean
```

### Workspace 個別実行

```bash
# Backend のみ開発
npm run dev --workspace=apps/backend

# Frontend のみビルド
npm run build --workspace=apps/frontend
```

## 🔧 主要機能

### Phase 0（PoC）- 完了予定: Week 4
- ✅ OAuth 2.0 認証フロー
- ✅ TikTok Campaign 作成
- ✅ Reporting API 連携
- ✅ 基本ダッシュボード

### Phase 1（MVP）- 完了予定: Week 12
- ⬜ Creative 管理（動画/画像アップロード）
- ⬜ AdGroup & Ad 自動作成
- ⬜ ルールベース最適化エンジン
- ⬜ アラート・通知（Slack）
- ⬜ 権限管理（RBAC）
- ⬜ 本番環境リリース

### Phase 2（機能拡張）- 完了予定: Week 24
- ⬜ Events API（サーバーサイドCV）
- ⬜ A/B テスト・MAB 実験フレームワーク
- ⬜ AI 最適化（CVR予測、Creative提案）
- ⬜ MMP連携（AppsFlyer/Adjust）
- ⬜ DWH連携・データパイプライン

### Phase 3（最適化）- 完了予定: Week 36
- ⬜ ポートフォリオ最適化
- ⬜ What-if シミュレーション
- ⬜ スケーラビリティ対応（1000+ Campaign）
- ⬜ SLO/SLI 整備

## 📚 ドキュメント

- [アーキテクチャ設計](./docs/architecture.md)（TODO）
- [API仕様書](./docs/api-spec.md)（TODO）
- [環境構築手順](./docs/setup.md)（TODO）
- [運用マニュアル](./docs/operations.md)（TODO）

## 🤝 コントリビューション

1. ブランチ作成: `git checkout -b feature/your-feature`
2. 変更をコミット: `git commit -m 'Add your feature'`
3. プッシュ: `git push origin feature/your-feature`
4. Pull Request 作成

### ブランチ戦略

- `main`: 本番環境
- `develop`: 開発環境
- `feature/*`: 機能開発
- `hotfix/*`: 緊急修正

## 📄 ライセンス

MIT License（TODO: 組織に応じて変更）

## 📞 サポート

- Issues: [GitHub Issues](https://github.com/your-org/TikTok-ads-automation/issues)
- Slack: #tiktok-ads-automation（社内）

---

**開発開始日**: 2025-10-04
**要件定義バージョン**: v2.0
**現在フェーズ**: Phase 0（Week 1）
