/**
 * UTAGEファネルのグループ・ステップ一覧取得スクリプト
 * 新しいLPを追加する際にgroupId/stepIdを調べるために使う
 *
 * 使い方:
 *   npx tsx apps/backend/utage-list-groups.ts <funnelId>
 *
 * 例:
 *   npx tsx apps/backend/utage-list-groups.ts dZNDzwCgHNBC   # SNS
 *   npx tsx apps/backend/utage-list-groups.ts a09j9jop95LF   # AI
 *   npx tsx apps/backend/utage-list-groups.ts 3lS3x3dXa6kc   # スキルプラス（セミナー）
 *   npx tsx apps/backend/utage-list-groups.ts EYHSSYtextak   # スキルプラス（LP1）
 *
 * ファネルID一覧:
 *   AI:           a09j9jop95LF
 *   SNS:          dZNDzwCgHNBC
 *   スキルプラス:   3lS3x3dXa6kc (セミナー), EYHSSYtextak (LP1)
 */

const UTAGE_BASE_URL = 'https://school.addness.co.jp';
const UTAGE_LOGIN_URL = 'https://school.addness.co.jp/operator/GYbKT7Y9d0eR/login';
const UTAGE_EMAIL = process.env.UTAGE_EMAIL || 'chiba.nobuteru@team.addness.co.jp';
const UTAGE_PASSWORD = process.env.UTAGE_PASSWORD || 'bC4F6mkV';

// ===== Cookie管理 =====
function mergeCookies(existing: string, response: Response): string {
  const setCookieHeaders = response.headers.getSetCookie?.() || [];
  const raw = setCookieHeaders.length > 0
    ? setCookieHeaders.map(h => h.split(';')[0].trim())
    : (response.headers.get('set-cookie') || '').split(/,(?=\s*[a-zA-Z_]+=)/).map(c => c.split(';')[0].trim()).filter(Boolean);

  const merged = new Map<string, string>();
  if (existing) existing.split('; ').forEach(c => { const [k] = c.split('='); merged.set(k, c); });
  raw.forEach(c => { const [k] = c.split('='); merged.set(k, c); });
  return [...merged.values()].join('; ');
}

function extractCsrfToken(html: string): string {
  const m = html.match(/<input[^>]+name=["']_token["'][^>]+value=["']([^"']+)["']/)
    || html.match(/value=["']([^"']+)["'][^>]+name=["']_token["']/)
    || html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/);
  if (!m) throw new Error('CSRFトークンが見つかりません');
  return m[1];
}

// ===== メイン =====
async function main() {
  const funnelId = process.argv[2];
  if (!funnelId) {
    console.error('使い方: npx tsx apps/backend/utage-list-groups.ts <funnelId>');
    console.error('例:     npx tsx apps/backend/utage-list-groups.ts dZNDzwCgHNBC');
    process.exit(1);
  }

  console.log(`\n🔍 ファネル ${funnelId} のグループ・ステップ一覧を取得中...\n`);

  // ログイン
  let cookies = '';
  const loginPage = await fetch(UTAGE_LOGIN_URL, { redirect: 'manual' });
  cookies = mergeCookies('', loginPage);
  const csrfToken = extractCsrfToken(await loginPage.text());

  const loginResp = await fetch(UTAGE_LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies, 'Referer': UTAGE_LOGIN_URL },
    body: new URLSearchParams({ _token: csrfToken, email: UTAGE_EMAIL, password: UTAGE_PASSWORD }).toString(),
    redirect: 'manual',
  });
  cookies = mergeCookies(cookies, loginResp);

  const location = loginResp.headers.get('location') || '';
  if (loginResp.status !== 302 || location.includes('/login')) {
    console.error('❌ UTAGEログイン失敗');
    process.exit(1);
  }
  console.log('✅ UTAGEログイン成功');

  // リダイレクト先をフォロー
  const redirectResp = await fetch(
    location.startsWith('http') ? location : `${UTAGE_BASE_URL}${location}`,
    { headers: { 'Cookie': cookies }, redirect: 'manual' },
  );
  cookies = mergeCookies(cookies, redirectResp);

  // 登録経路作成フォームを取得
  const createFormUrl = `${UTAGE_BASE_URL}/funnel/${funnelId}/tracking/create`;
  const formResp = await fetch(createFormUrl, {
    headers: { 'Cookie': cookies },
    redirect: 'follow',
  });
  cookies = mergeCookies(cookies, formResp);
  const formHtml = await formResp.text();

  // グループ（group_id）のセレクトボックスを解析
  const groupSelectMatch = formHtml.match(/<select[^>]*name=["']group_id["'][^>]*>([\s\S]*?)<\/select>/);
  if (!groupSelectMatch) {
    console.error('❌ group_id セレクトボックスが見つかりません');
    console.error('   ファネルIDが正しいか確認してください');
    process.exit(1);
  }

  const groupOptions: { value: string; label: string }[] = [];
  const groupOptRegex = /<option[^>]*value=["']([^"']+)["'][^>]*>(.*?)<\/option>/g;
  let m: RegExpExecArray | null;
  while ((m = groupOptRegex.exec(groupSelectMatch[1])) !== null) {
    if (m[1]) groupOptions.push({ value: m[1], label: m[2].trim() });
  }

  // ステップ（step_id）のセレクトボックスを解析
  const stepSelectMatch = formHtml.match(/<select[^>]*name=["']step_id["'][^>]*>([\s\S]*?)<\/select>/);
  const stepOptions: { value: string; label: string }[] = [];
  if (stepSelectMatch) {
    const stepOptRegex = /<option[^>]*value=["']([^"']+)["'][^>]*>(.*?)<\/option>/g;
    while ((m = stepOptRegex.exec(stepSelectMatch[1])) !== null) {
      if (m[1]) stepOptions.push({ value: m[1], label: m[2].trim() });
    }
  }

  // 結果表示
  console.log('='.repeat(60));
  console.log(`ファネルID: ${funnelId}`);
  console.log('='.repeat(60));

  console.log(`\n📂 グループ一覧 (${groupOptions.length}件):`);
  console.log('-'.repeat(60));
  for (const g of groupOptions) {
    console.log(`  groupId: ${g.value.padEnd(20)} | ${g.label}`);
  }

  console.log(`\n📄 ステップ一覧 (${stepOptions.length}件):`);
  console.log('-'.repeat(60));
  for (const s of stepOptions) {
    console.log(`  stepId:  ${s.value.padEnd(20)} | ${s.label}`);
  }

  // コピペ用出力
  console.log('\n' + '='.repeat(60));
  console.log('📋 TIKTOK_FUNNEL_MAP用コピペフォーマット:');
  console.log('='.repeat(60));
  for (const g of groupOptions) {
    for (const s of stepOptions) {
      console.log(`    X: { funnelId: '${funnelId}', groupId: '${g.value}', stepId: '${s.value}' },  // ${g.label} / ${s.label}`);
    }
  }

  console.log('\n✅ 完了');
}

main().catch(e => { console.error('❌ エラー:', e.message); process.exit(1); });
