# TikTok広告運用自動化システム - Makefile
# 開発環境の操作を簡単にするためのコマンド集

.PHONY: help install dev build lint test clean docker-up docker-down docker-logs docker-clean

# デフォルトターゲット: ヘルプ表示
help:
	@echo "TikTok Ads Automation - Available commands:"
	@echo ""
	@echo "  make install       - 依存関係をインストール"
	@echo "  make dev           - 開発サーバーを起動"
	@echo "  make build         - プロジェクトをビルド"
	@echo "  make lint          - Lintを実行"
	@echo "  make test          - テストを実行"
	@echo "  make format        - コードフォーマット"
	@echo "  make clean         - ビルド成果物をクリーンアップ"
	@echo ""
	@echo "  make docker-up     - Dockerコンテナを起動（DB, Redis）"
	@echo "  make docker-down   - Dockerコンテナを停止"
	@echo "  make docker-logs   - Dockerログを表示"
	@echo "  make docker-clean  - Docker volumeを削除（データ消去）"
	@echo "  make docker-tools  - 管理ツールを起動（Prisma Studio, Redis Commander）"
	@echo ""
	@echo "  make db-migrate    - Prismaマイグレーション実行"
	@echo "  make db-seed       - シードデータ投入"
	@echo "  make db-studio     - Prisma Studioを起動"
	@echo "  make db-reset      - データベースをリセット"
	@echo ""

# 依存関係インストール
install:
	npm install

# 開発サーバー起動
dev:
	npm run dev

# ビルド
build:
	npm run build

# Lint実行
lint:
	npm run lint

# テスト実行
test:
	npm run test

# コードフォーマット
format:
	npm run format

# クリーンアップ
clean:
	npm run clean

# Dockerコンテナ起動
docker-up:
	docker-compose up -d postgres redis
	@echo "Waiting for PostgreSQL to be ready..."
	@sleep 5
	@docker-compose exec -T postgres pg_isready -U tiktok_user || echo "PostgreSQL is ready"

# 管理ツール起動
docker-tools:
	docker-compose --profile tools up -d
	@echo "管理ツールを起動しました:"
	@echo "  - Prisma Studio: http://localhost:5555"
	@echo "  - Redis Commander: http://localhost:8081"

# Dockerコンテナ停止
docker-down:
	docker-compose down

# Dockerログ表示
docker-logs:
	docker-compose logs -f

# Docker volumeクリーン（データ削除）
docker-clean:
	docker-compose down -v
	@echo "全てのDockerボリュームを削除しました"

# Prismaマイグレーション
db-migrate:
	cd apps/backend && npx prisma migrate dev

# Prismaシード投入
db-seed:
	cd apps/backend && npx prisma db seed

# Prisma Studio起動
db-studio:
	cd apps/backend && npx prisma studio

# データベースリセット
db-reset:
	cd apps/backend && npx prisma migrate reset
	@echo "データベースをリセットしました"

# セットアップ（初回）
setup: install docker-up db-migrate
	@echo ""
	@echo "セットアップ完了！"
	@echo ""
	@echo "次のコマンドで開発を開始できます:"
	@echo "  make dev"
	@echo ""

# フルリセット（開発環境クリーンアップ）
reset: docker-clean clean
	@echo "開発環境を完全にリセットしました"
	@echo "再度セットアップするには: make setup"
