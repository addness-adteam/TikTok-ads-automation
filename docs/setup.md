# TikTok広告運用自動化システム - 環境構築手順書

**対象:** 開発者・運用担当者
**最終更新日:** 2025-10-24
**所要時間:** 約30分

---

## 📋 目次

1. [前提条件](#前提条件)
2. [TikTok Developer アカウント設定](#tiktok-developer-アカウント設定)
3. [ローカル環境構築](#ローカル環境構築)
4. [データベースセットアップ](#データベースセットアップ)
5. [開発サーバー起動](#開発サーバー起動)
6. [動作確認](#動作確認)
7. [トラブルシューティング](#トラブルシューティング)

---

## 🔧 前提条件

### 必須ソフトウェア

| ソフトウェア | バージョン | 確認コマンド |
|------------|----------|------------|
| Node.js | 18以上 | \`node --version\` |
| npm | 9以上 | \`npm --version\` |
| Git | 最新 | \`git --version\` |

### 必要なアカウント

1. **Neon Postgres**（無料） - https://neon.tech
2. **TikTok for Developers**（無料） - https://developers.tiktok.com

---

## 🎯 TikTok Developer アカウント設定

### Step 1: アプリケーション作成

1. https://developers.tiktok.com/ にアクセス
2. 「Apps」→「Create an app」をクリック
3. App Name: TikTok Ads Automation

### Step 2: OAuth設定

**Redirect URIs** に追加:
\`\`\`
http://localhost:3001/auth/callback
\`\`\`

**Scopes** 選択:
- Campaign Management
- Reporting

### Step 3: 認証情報取得

- **App ID**
- **App Secret**

---

## 💻 ローカル環境構築

\`\`\`bash
# リポジトリクローン
git clone https://github.com/your-org/TikTok-ads-automation.git
cd TikTok-ads-automation

# 依存関係インストール
npm install

# 環境変数設定
cd apps/backend
cp .env.example .env
# .envを編集してApp IDとSecretを設定
\`\`\`

---

## 🗄️ データベースセットアップ

\`\`\`bash
cd apps/backend

# Prismaマイグレーション実行
npx prisma migrate deploy

# シードデータ投入
npx prisma db seed
\`\`\`

---

## 🚀 開発サーバー起動

\`\`\`bash
# バックエンド
cd apps/backend
npm run dev
# → http://localhost:4000

# フロントエンド（別ターミナル）
cd apps/frontend
npm run dev
# → http://localhost:3000
\`\`\`

---

**作成日:** 2025-10-24
