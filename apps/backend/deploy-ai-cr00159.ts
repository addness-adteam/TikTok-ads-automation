/**
 * AI-LP2-CR00159 を AI2・AI3 に再出稿（Smart+, 動画1本, 日予算¥3,000）
 */
import axios from 'axios';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
dotenv.config();

const TIKTOK_API = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const UTAGE_BASE_URL = 'https://school.addness.co.jp';
const OPERATOR_LOGIN_URL = 'https://school.addness.co.jp/operator/GYbKT7Y9d0eR/login';
const AI_LP2_CONFIG = { funnelId: 'a09j9jop95LF', groupId: 'bvnhWMTjQAPU', stepId: 'EnFeDysozIui' };

const SOURCE_ADV_ID = '7543540647266074641'; // AI3
const SOURCE_AD_ID = '1851224743775361';

const targets = [
  { name: 'AI2', id: '7523128243466551303', pixelId: '7474971284842815504', identityId: 'e44d99bc-a305-5627-9899-e671d819f515' },
  { name: 'AI3', id: '7543540647266074641', pixelId: '7545348380013199368', identityId: 'e44d99bc-a305-5627-9899-e671d819f515' },
];
const BC_ID = '7440019834009829392';

async function tiktokGet(path: string, params: any) {
  return (await axios.get(`${TIKTOK_API}${path}`, { headers: { 'Access-Token': ACCESS_TOKEN }, params })).data;
}
async function tiktokPost(path: string, data: any) {
  return (await axios.post(`${TIKTOK_API}${path}`, data, { headers: { 'Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } })).data;
}
async function uploadVideo(advId: string, buffer: Buffer, filename: string): Promise<string> {
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('advertiser_id', advId);
  form.append('upload_type', 'UPLOAD_BY_FILE');
  form.append('video_file', buffer, { filename, contentType: 'video/mp4' });
  form.append('video_signature', crypto.createHash('md5').update(buffer).digest('hex'));
  form.append('file_name', filename);
  const resp = await axios.post(`${TIKTOK_API}/v1.3/file/video/ad/upload/`, form, {
    headers: { 'Access-Token': ACCESS_TOKEN, ...form.getHeaders() },
    timeout: 300000, maxContentLength: Infinity, maxBodyLength: Infinity,
  });
  const data = resp.data?.data;
  return Array.isArray(data) ? data[0]?.video_id : data?.video_id;
}

// UTAGE
let sessionCookies = '';
let csrfToken = '';
function mergeCookies(existing: string, resp: Response): string {
  const raw = resp.headers.get('set-cookie');
  if (!raw) return existing;
  const cookies = raw.split(/,(?=\s*[a-zA-Z_]+=)/).map(c => c.split(';')[0].trim());
  const merged = new Map<string, string>();
  if (existing) existing.split('; ').forEach(c => { const [k] = c.split('='); merged.set(k, c); });
  cookies.forEach(c => { const [k] = c.split('='); merged.set(k, c); });
  return [...merged.values()].join('; ');
}
function extractCsrfToken(html: string): string {
  const m = html.match(/<input[^>]+name=["']_token["'][^>]+value=["']([^"']+)["']/) ||
            html.match(/value=["']([^"']+)["'][^>]+name=["']_token["']/) ||
            html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/);
  if (m) return m[1];
  throw new Error('CSRFトークン取得失敗');
}
async function utageLogin() {
  const email = process.env.UTAGE_EMAIL;
  const password = process.env.UTAGE_PASSWORD;
  if (!email || !password) throw new Error('UTAGE未設定');
  console.log('  UTAGE: ログイン中...');
  const lp = await fetch(OPERATOR_LOGIN_URL, { redirect: 'manual' });
  sessionCookies = mergeCookies('', lp);
  csrfToken = extractCsrfToken(await lp.text());
  const lr = await fetch(OPERATOR_LOGIN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': sessionCookies, 'Referer': OPERATOR_LOGIN_URL },
    body: new URLSearchParams({ _token: csrfToken, email, password }).toString(), redirect: 'manual',
  });
  sessionCookies = mergeCookies(sessionCookies, lr);
  const loc = lr.headers.get('location') || '';
  if (lr.status === 302 && !loc.includes('/login')) {
    const rr = await fetch(loc.startsWith('http') ? loc : `${UTAGE_BASE_URL}${loc}`, { headers: { 'Cookie': sessionCookies }, redirect: 'manual' });
    sessionCookies = mergeCookies(sessionCookies, rr);
    console.log('  UTAGE: ログイン成功');
  } else throw new Error('UTAGEログイン失敗');
}
async function utageGet(url: string): Promise<string> {
  const r = await fetch(url, { headers: { 'Cookie': sessionCookies }, redirect: 'manual' });
  sessionCookies = mergeCookies(sessionCookies, r);
  if (r.status === 302) {
    const loc = r.headers.get('location') || '';
    const ru = loc.startsWith('http') ? loc : `${UTAGE_BASE_URL}${loc}`;
    if (ru.includes('/login')) { await utageLogin(); return utageGet(url); }
    return utageGet(ru);
  }
  return r.text();
}
async function createUtageAI_LP2(): Promise<{ registrationPath: string; destinationUrl: string; crNumber: number }> {
  if (!sessionCookies) await utageLogin();
  const html = await utageGet(`${UTAGE_BASE_URL}/funnel/${AI_LP2_CONFIG.funnelId}/tracking`);
  const matches = [...html.matchAll(/TikTok広告-AI-LP2-CR(\d+)/g)];
  const latest = matches.length > 0 ? Math.max(...matches.map(m => parseInt(m[1]))) : 0;
  const newCr = latest + 1;
  const crStr = String(newCr).padStart(5, '0');
  const regPath = `TikTok広告-AI-LP2-CR${crStr}`;
  console.log(`    最新CR: ${latest} → 新規: ${regPath}`);

  const formHtml = await utageGet(`${UTAGE_BASE_URL}/funnel/${AI_LP2_CONFIG.funnelId}/tracking/create`);
  let ft: string; try { ft = extractCsrfToken(formHtml); } catch { ft = csrfToken; }
  let fa = '';
  const fr = /<form[^>]*action=["']([^"']*)["'][^>]*>([\s\S]*?)<\/form>/gi;
  let fm: RegExpExecArray | null;
  while ((fm = fr.exec(formHtml)) !== null) { if (fm[2].includes('name="name"')) { fa = fm[1]; break; } }
  if (!fa) fa = `${UTAGE_BASE_URL}/funnel/${AI_LP2_CONFIG.funnelId}/tracking`;
  const pu = fa.startsWith('http') ? fa : `${UTAGE_BASE_URL}${fa}`;

  const pr = await fetch(pu, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': sessionCookies, 'Referer': `${UTAGE_BASE_URL}/funnel/${AI_LP2_CONFIG.funnelId}/tracking/create` },
    body: new URLSearchParams({ _token: ft, name: regPath, group_id: AI_LP2_CONFIG.groupId, step_id: AI_LP2_CONFIG.stepId }).toString(), redirect: 'manual',
  });
  sessionCookies = mergeCookies(sessionCookies, pr);
  let lh = '';
  if (pr.status === 302) { const loc = pr.headers.get('location') || ''; lh = await utageGet(loc.startsWith('http') ? loc : `${UTAGE_BASE_URL}${loc}`); }
  else lh = await pr.text();
  let idx = lh.indexOf(regPath);
  if (idx === -1) { lh = await utageGet(`${UTAGE_BASE_URL}/funnel/${AI_LP2_CONFIG.funnelId}/tracking`); idx = lh.indexOf(regPath); }
  if (idx === -1) throw new Error(`UTAGE: ${regPath}が見つかりません`);
  const ctx = lh.substring(Math.max(0, idx - 500), idx + 3000);
  const um = ctx.match(new RegExp(`https://school\\.addness\\.co\\.jp/p/${AI_LP2_CONFIG.stepId}\\?ftid=[a-zA-Z0-9]+`));
  if (!um) throw new Error('UTAGE: LP URL取得失敗');
  console.log(`    LP: ${um[0]}`);
  return { registrationPath: regPath, destinationUrl: um[0], crNumber: newCr };
}

async function main() {
  console.log('=== AI CR00159 → AI2, AI3 再出稿 ===\n');

  // 1. 元広告データ取得
  console.log('1. 元広告データ取得...');
  const smartResp = await tiktokGet('/v1.3/smart_plus/ad/get/', {
    advertiser_id: SOURCE_ADV_ID, page_size: 100,
  });
  const sourceAd = (smartResp.data?.list || []).find((a: any) => a.ad_name?.includes('CR00159'));
  if (!sourceAd) throw new Error('CR00159 not found');
  const videoId = sourceAd.creative_list?.[0]?.creative_info?.video_info?.video_id;
  const adText = sourceAd.ad_text_list?.[0]?.ad_text || 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）';
  console.log(`  ad_name: ${sourceAd.ad_name}`);
  console.log(`  video_id: ${videoId}`);

  // 2. 動画ダウンロード
  console.log('\n2. 動画ダウンロード...');
  const vInfo = await tiktokGet('/v1.3/file/video/ad/info/', {
    advertiser_id: SOURCE_ADV_ID, video_ids: JSON.stringify([videoId]),
  });
  const dlUrl = vInfo.data?.list?.[0]?.preview_url;
  const buf = Buffer.from((await axios.get(dlUrl, { responseType: 'arraybuffer', timeout: 300000 })).data);
  console.log(`  サイズ: ${(buf.length / 1024 / 1024).toFixed(1)}MB`);

  // 3. AI2/AI3のCTA ID取得
  console.log('\n3. CTA ID取得...');
  const ctaIds: Record<string, string> = {};
  for (const t of targets) {
    const r = await tiktokGet('/v1.3/smart_plus/ad/get/', { advertiser_id: t.id, page_size: 5 });
    const ads = r.data?.list || [];
    const ctaId = ads[0]?.ad_configuration?.call_to_action_id;
    ctaIds[t.id] = ctaId || '';
    console.log(`  ${t.name}: cta_id=${ctaId || 'なし'}`);
  }

  // 4. 各ターゲットに出稿
  for (const t of targets) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 CR00159 → ${t.name} (${t.id})`);

    try {
      // 動画アップロード
      console.log('  a. 動画アップロード...');
      const newVid = await uploadVideo(t.id, buf, `ai_cr00159_${Date.now()}.mp4`);
      console.log(`    video_id: ${newVid}`);
      await new Promise(r => setTimeout(r, 15000));

      // カバー画像取得
      const vi = await tiktokGet('/v1.3/file/video/ad/info/', {
        advertiser_id: t.id, video_ids: JSON.stringify([newVid]),
      });
      const coverUrl = vi.data?.list?.[0]?.video_cover_url || '';
      const webUriMatch = coverUrl.match(/(tos-[^~?]+)/);
      const webUri = webUriMatch ? webUriMatch[1] : '';

      // UTAGE登録経路
      console.log('  b. UTAGE登録経路作成...');
      const utage = await createUtageAI_LP2();

      // キャンペーン作成
      const crStr = String(utage.crNumber).padStart(5, '0');
      const adName = `260320/清水絢吾/林社長/冒頭③_コピー6/LP2-CR${crStr}`;
      console.log(`  c. キャンペーン作成: ${adName}`);
      const campResp = await tiktokPost('/v1.3/smart_plus/campaign/create/', {
        advertiser_id: t.id, campaign_name: adName,
        objective_type: 'LEAD_GENERATION', budget_mode: 'BUDGET_MODE_INFINITE', budget_optimize_on: false,
        request_id: String(Date.now()) + String(Math.floor(Math.random() * 10000)),
      });
      if (campResp.code !== 0) throw new Error(`Campaign: ${JSON.stringify(campResp)}`);
      const campaignId = String(campResp.data?.campaign_id);
      console.log(`    campaign_id: ${campaignId}`);

      // 広告グループ作成
      console.log('  d. 広告グループ作成...');
      const agResp = await tiktokPost('/v1.3/smart_plus/adgroup/create/', {
        advertiser_id: t.id, campaign_id: campaignId, adgroup_name: '260320 ノンタゲ',
        budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET', budget: 3000,
        bid_type: 'BID_TYPE_NO_BID', billing_event: 'OCPM',
        optimization_goal: 'CONVERT', optimization_event: 'ON_WEB_REGISTER',
        pixel_id: t.pixelId, schedule_type: 'SCHEDULE_FROM_NOW',
        schedule_start_time: new Date(Date.now() + 10 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19),
        pacing: 'PACING_MODE_SMOOTH', skip_learning_phase: true,
        placement_type: 'PLACEMENT_TYPE_AUTOMATIC',
        targeting_spec: { location_ids: ['1861060'], age_groups: ['AGE_18_24', 'AGE_25_34', 'AGE_35_44', 'AGE_45_54', 'AGE_55_100'], gender: 'GENDER_UNLIMITED', languages: ['ja'] },
        promotion_type: 'LEAD_GENERATION', promotion_target_type: 'EXTERNAL_WEBSITE',
        request_id: String(Date.now()) + String(Math.floor(Math.random() * 10000)),
      });
      if (agResp.code !== 0) throw new Error(`AdGroup: ${JSON.stringify(agResp)}`);
      const adgroupId = String(agResp.data?.adgroup_id);
      console.log(`    adgroup_id: ${adgroupId}`);

      // 広告作成
      console.log('  e. 広告作成...');
      const lpUrl = `${utage.destinationUrl}${utage.destinationUrl.includes('?') ? '&' : '?'}utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;
      const adResp = await tiktokPost('/v1.3/smart_plus/ad/create/', {
        advertiser_id: t.id, adgroup_id: adgroupId, ad_name: adName,
        creative_list: [{
          creative_info: {
            ad_format: 'SINGLE_VIDEO',
            video_info: { video_id: newVid },
            image_info: webUri ? [{ web_uri: webUri }] : [],
            identity_id: t.identityId,
            identity_type: 'BC_AUTH_TT',
            identity_authorized_bc_id: BC_ID,
          },
        }],
        ad_text_list: [{ ad_text: adText }],
        landing_page_url_list: [{ landing_page_url: lpUrl }],
        ad_configuration: { call_to_action_id: ctaIds[t.id], creative_auto_add_toggle: true, dark_post_status: 'ON' },
        operation_status: 'ENABLE',
        request_id: String(Date.now()) + String(Math.floor(Math.random() * 10000)),
      });
      if (adResp.code !== 0) throw new Error(`Ad: ${JSON.stringify(adResp)}`);

      console.log(`  ✅ 成功!`);
      console.log(`    Ad Name: ${adName}`);
      console.log(`    UTAGE経路: ${utage.registrationPath}`);
      console.log(`    日予算: ¥3,000`);
    } catch (e: any) {
      console.log(`  ❌ エラー: ${e.message?.substring(0, 300)}`);
    }
  }
  console.log('\n=== 完了 ===');
}
main().catch(console.error);
