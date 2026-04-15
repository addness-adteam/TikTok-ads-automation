/**
 * CR01207をAI1にAI LP1として再出稿する
 * redeploy-ad.tsのappeal自動判定がSNSになる問題を回避するため直接指定
 */

// redeploy-ad.tsをappeal強制指定で実行
// 環境変数でappealを強制する
process.env.FORCE_APPEAL = 'AI';
process.env.FORCE_LP = '1';

// あとはredeploy-ad.tsと同じロジック
import './redeploy-ad';
