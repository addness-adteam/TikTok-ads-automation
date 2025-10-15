# 環境構築手順

TikTok広告運用自動化システムの開発環境セットアップガイドです。

## 📋 前提条件

以下のソフトウェアがインストールされている必要があります：

- **Node.js**: 18.0.0 以上
- **npm**: 9.0.0 以上
- **Docker**: 20.10 以上
- **Docker Compose**: 2.0 以上
- **Git**: 2.30 以上

### バージョン確認

```bash
node --version   # v18.0.0 以上
npm --version    # 9.0.0 以上
docker --version # 20.10 以上
docker-compose --version # 2.0 以上
```

## 🚀 クイックスタート

### 1. リポジトリクローン

```bash
git clone https://github.com/your-org/TikTok-ads-automation.git
cd TikTok-ads-automation
```

### 2. 自動セットアップ（推奨）

```bash
make setup
```

このコマンドで以下が自動実行されます：
- 依存関係のインストール
- Docker コンテナ起動（PostgreSQL, Redis）
- データベースマイグレーション

### 3. 開発サーバー起動

```bash
make dev
```

以下のURLでアクセス可能になります：
- **フロントエンド**: http://localhost:3000
- **バックエンドAPI**: http://localhost:3001
- **Prisma Studio**: http://localhost:5555（`make docker-tools` 実行後）

---

## 📝 手動セットアップ

自動セットアップがうまくいかない場合は、手動で実行してください。

### ステップ1: 依存関係インストール

```bash
npm install
```

### ステップ2: 環境変数設定

```bash
cp .env.example .env
```

`.env` ファイルを開き、必要な値を設定：

```bash
# 最低限必要な設定
TIKTOK_APP_ID=your_app_id
TIKTOK_APP_SECRET=your_app_secret
DATABASE_URL=postgresql://tiktok_user:tiktok_pass@localhost:5432/tiktok_ads_automation
```

### ステップ3: Docker コンテナ起動

```bash
docker-compose up -d
```

起動確認：
```bash
docker-compose ps

# 出力例:
# NAME                   STATUS
# tiktok-ads-postgres    Up (healthy)
# tiktok-ads-redis       Up (healthy)
```

### ステップ4: データベースマイグレーション

```bash
cd apps/backend
npx prisma migrate dev
cd ../..
```

### ステップ5: 開発サーバー起動

```bash
npm run dev
```

---

## 🛠️ よく使うコマンド

### 開発

```bash
# 全アプリ開発サーバー起動
make dev

# Backend のみ
npm run dev --workspace=apps/backend

# Frontend のみ
npm run dev --workspace=apps/frontend
```

### ビルド

```bash
# 全アプリビルド
make build

# 個別ビルド
npm run build --workspace=apps/backend
```

### Lint & Format

```bash
# Lint実行
make lint

# コードフォーマット
make format
```

### Docker操作

```bash
# コンテナ起動
make docker-up

# 管理ツール起動（Prisma Studio, Redis Commander）
make docker-tools

# ログ確認
make docker-logs

# コンテナ停止
make docker-down

# 完全クリーンアップ（データ削除）
make docker-clean
```

### データベース操作

```bash
# マイグレーション実行
make db-migrate

# Prisma Studio 起動
make db-studio

# シードデータ投入
make db-seed

# データベースリセット
make db-reset
```

---

## 🔧 トラブルシューティング

### ポート競合エラー

既に使用されているポートがある場合：

```bash
# 使用中のポート確認（Windows）
netstat -ano | findstr :5432
netstat -ano | findstr :6379
netstat -ano | findstr :3000

# プロセス終了（管理者権限）
taskkill /PID <PID> /F
```

または `docker-compose.yml` でポート番号を変更：

```yaml
postgres:
  ports:
    - '15432:5432'  # 15432に変更
```

### Docker コンテナが起動しない

```bash
# Docker Daemon 確認
docker info

# コンテナログ確認
docker-compose logs postgres
docker-compose logs redis

# 完全再起動
make docker-clean
make docker-up
```

### データベース接続エラー

```bash
# PostgreSQL接続確認
docker-compose exec postgres psql -U tiktok_user -d tiktok_ads_automation

# 接続成功なら:
# tiktok_ads_automation=#
```

### node_modules エラー

```bash
# 完全クリーンアップ
make clean
rm -rf node_modules apps/*/node_modules packages/*/node_modules

# 再インストール
npm install
```

---

## 🌐 開発環境URL一覧

| サービス | URL | 説明 |
|---------|-----|------|
| Frontend | http://localhost:3000 | Next.js Webアプリ |
| Backend API | http://localhost:3001 | NestJS API Server |
| Prisma Studio | http://localhost:5555 | DB管理画面 |
| Redis Commander | http://localhost:8081 | Redis管理画面 |
| PostgreSQL | localhost:5432 | Database |
| Redis | localhost:6379 | Cache/Queue |

---

## 📚 次のステップ

環境構築が完了したら：

1. [アーキテクチャドキュメント](./architecture.md) を確認
2. [API仕様書](./api-spec.md) を確認
3. TikTok Developer アカウント作成（Task 0.2）
4. OAuth実装（Task 0.3）

---

## 💡 便利なTips

### VS Code 拡張機能

推奨拡張機能（`.vscode/extensions.json` に定義）:

- ESLint
- Prettier
- Prisma
- Docker
- TypeScript関連

### Git フック

コミット前に自動でLint実行：

```bash
npm install -D husky lint-staged
npx husky install
```

### 環境変数の管理

開発環境の秘密情報は **絶対に Git にコミットしない**：

```bash
# .gitignore に含まれていることを確認
cat .gitignore | grep .env

# 出力に .env が含まれていればOK
```

---

## 📞 サポート

問題が解決しない場合：

- GitHub Issues: [リンク]
- Slack: #tiktok-ads-automation
- ドキュメント: このディレクトリ内の他のファイル
