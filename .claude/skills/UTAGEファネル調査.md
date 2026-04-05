---
name: UTAGEファネル調査
description: UTAGEファネルのgroupId/stepId一覧を取得する（新LP追加時に使用）
user_invocable: true
---

# /UTAGEファネル調査 - グループ・ステップID取得スキル

新しいLPを追加する際に、UTAGEファネルのgroupId/stepIdを調べて、コードに反映する。

## 手順

1. ユーザーにどの導線（AI/SNS/スキルプラス等）のどのLP番号を追加したいか確認する

2. 対象ファネルIDで調査スクリプトを実行する（タイムアウト30秒）:
   ```
   npx tsx apps/backend/utage-list-groups.ts <funnelId>
   ```

3. ファネルID一覧:
   - AI: `a09j9jop95LF`
   - SNS: `dZNDzwCgHNBC`
   - スキルプラス（セミナー導線）: `3lS3x3dXa6kc`
   - スキルプラス（LP1）: `EYHSSYtextak`

4. 出力から該当LPのgroupIdとstepIdを特定する:
   - グループ名が「オプトX」のものがLP番号Xに対応
   - ステップ名が「TikTok広告_導線名_オプトインLPX_...」のものが該当

5. 特定できたら、以下3ファイルにLP定義を追加する:
   - `apps/backend/src/utage/utage.types.ts` (TIKTOK_FUNNEL_MAP - メイン定義)
   - `apps/backend/cross-deploy-local.ts` (ローカル横展開用)
   - `apps/backend/redeploy-ad.ts` (再出稿用)

6. `npx tsc --noEmit --project apps/backend/tsconfig.json` でコンパイルチェック

## 注意
- UTAGEにLP用のグループ・ステップが未作成の場合は、先にUTAGE管理画面で作成が必要
- 3ファイルのマッピングは常に同期させること
