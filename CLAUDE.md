# CLAUDE.md - TikTok広告運用自動化システム

## プロジェクト概要
TikTok広告の運用を自動化するNestJS + Next.jsモノレポ。予算最適化、メトリクス同期、広告作成を自動化。

## 開発コマンド
```bash
# TypeScriptコンパイルチェック
npx tsc --noEmit --project apps/backend/tsconfig.json

# ローカル開発サーバー
cd apps/backend && npm run start:dev

# Prismaマイグレーション
cd apps/backend && npx prisma migrate dev --name <migration-name>
cd apps/backend && npx prisma generate

# 一時スクリプト実行
npx tsx apps/backend/<script-name>.ts
```

## コーディングルール
- NestJSのモジュール構造に従う（module / service / controller）
- PrismaModuleは@Global — インポート不要
- 日本語のコメント・ログメッセージOK
- TikTok APIは `/v1.3/` を使用
- JST (UTC+9) で日付計算
- エラー時は3回リトライ + 指数バックオフが標準パターン

## 予算調整V2は触らない
予算調整V2（`budget-optimization-v2/`）は完璧に動作中。手動での広告停止や予算変更はしない。

## デプロイ
- masterブランチにpush → Vercel自動デプロイ
- コミット前にtscチェック必須

## ナレッジベース
- 運用分析・検証結果: `docs/knowledge/` に日付付きMarkdownで蓄積
- 検証を行ったら必ず結果と考察をナレッジに記録する

## 現在のタスク
`TASKS.md` を参照。Smart+横展開機能の実装が最優先。
