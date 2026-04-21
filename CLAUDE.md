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

## 作業前のルール確認（必須）
分析スクリプト・データ取得・検証を行う前に、以下を必ず確認してから着手する:
1. `memory/` 配下のfeedbackメモリ（特にデータ取得方法・検証フォーマットのルール）
2. `docs/knowledge/` 配下の関連ナレッジ（過去の検証で判明したハマりポイント）
3. `docs/` 配下の仕様書（API仕様・データ構造の制約）

確認せずにスクリプトを書き始めることを禁止する。ルールに反するやり方をしていたら作り直す。

## 広告費取得ルール（最重要・過去に5回以上ミスあり）
TikTok広告のCR別広告費を取得するとき、**3ソース全てから取得して合算する**:
1. **通常広告**: `/v1.3/report/integrated/get/` (AUCTION_CAMPAIGN) → campaign_nameからCR抽出
2. **Smart+広告**: `/v1.3/smart_plus/ad/get/` + `/v1.3/smart_plus/material_report/overview/` → smart_plus_ad_idベース
3. **Upgraded Smart+で消えた広告**: DBのcampaign tiktokId → Report APIで直接フィルタ

**絶対禁止**: DB Metricテーブルから広告費取得（Smart+子広告重複で10-20倍になる）
**広告費0のCRがあったら提出前に個別確認**
詳細は `memory/feedback_hypothesis_verification_workflow.md` を参照

## ナレッジベース
- 運用分析・検証結果: `docs/knowledge/` に日付付きMarkdownで蓄積
- 検証を行ったら必ず結果と考察をナレッジに記録する

## 現在のタスク
`TASKS.md` を参照。Smart+横展開機能の実装が最優先。
