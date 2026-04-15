/**
 * CR00577 スマプラ再出稿（SP1→SP1）
 * 元: 260403/清水絢吾/おい会社員/穏やか_3万小遣い/LP2-CR00577
 * 動画1本、明日0時配信開始
 *
 * npx tsx apps/backend/redeploy-cr00577.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

import { PrismaClient } from '@prisma/client';

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SP1_ID = '7474920444831875080';

const SOURCE_VIDEO_ID = 'v10033g50000d4b7amfog65rlj4klkk0';
const SOURCE_IMAGE_URI = 'ad-site-i18n-sg/20260402c7c79051889317b1433cbc1d';
const SOURCE_NAME = '清水絢吾/おい会社員/穏やか_3万小遣い';

const UTAGE_BASE_URL = 'https://school.addness.co.jp';
const UTAGE_LOGIN_URL = 'https://school.addness.co.jp/operator/GYbKT7Y9d0eR/login';
const UTAGE_EMAIL = process.env.UTAGE_EMAIL || 'chiba.nobuteru@team.addness.co.jp';
const UTAGE_PASSWORD = process.env.UTAGE_PASSWORD || 'bC4F6mkV';
const SP_FUNNEL = { funnelId: '3lS3x3dXa6kc', groupId: 'sOiiROJBAVIu', stepId: 'doc7hffUAVTv' };

const AD_TEXT = 'スキルで独立するなら学んでおきたい本質のスキル活用術特商法（https://skill.addness.co.jp/tokushoho）';
const DAILY_BUDGET = 5000;

let sessionCookies = '';

function mergeCookies(existing: string, headers: Headers): string {
  const raw = headers.get('set-cookie');
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

function getJstNow(): Date { return new Date(Date.now() + 9 * 60 * 60 * 1000); }

function getJstDateStr(): string {
  const d = getJstNow();
  d.setUTCDate(d.getUTCDate() + 1);
  return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

function getJstScheduleTime(): string {
  const jst = getJstNow();
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')} 15:00:00`;
}

async function tiktokApi(endpoint: string, body: any): Promise<any> {
  console.log(`  API: ${endpoint}`);
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Access-Token': ACCESS_TOKEN }, body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`TikTok API エラー: ${data.message} (code: ${data.code})\n${JSON.stringify(data, null, 2)}`);
  return data;
}

async function tiktokGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

async function utageLogin(): Promise<void> {
  console.log('1. UTAGEログイン中...');
  const pageResp = await fetch(UTAGE_LOGIN_URL, { redirect: 'manual' });
  sessionCookies = mergeCookies('', pageResp.headers);
  const pageHtml = await pageResp.text();
  const csrfToken = extractCsrfToken(pageHtml);
  const formBody = new URLSearchParams({ _token: csrfToken, email: UTAGE_EMAIL, password: UTAGE_PASSWORD });
  const loginResp = await fetch(UTAGE_LOGIN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': sessionCookies, 'Referer': UTAGE_LOGIN_URL },
    body: formBody.toString(), redirect: 'manual',
  });
  sessionCookies = mergeCookies(sessionCookies, loginResp.headers);
  const location = loginResp.headers.get('location') || '';
  if (loginResp.status === 302 && !location.includes('/login')) {
    const redirectUrl = location.startsWith('http') ? location : `${UTAGE_BASE_URL}${location}`;
    const rr = await fetch(redirectUrl, { headers: { 'Cookie': sessionCookies }, redirect: 'manual' });
    sessionCookies = mergeCookies(sessionCookies, rr.headers);
    console.log('   ログイン成功');
  } else throw new Error('UTAGEログイン失敗');
}

async function authedGet(url: string): Promise<string> {
  const resp = await fetch(url, { headers: { 'Cookie': sessionCookies }, redirect: 'manual' });
  sessionCookies = mergeCookies(sessionCookies, resp.headers);
  if (resp.status === 302) {
    const loc = resp.headers.get('location') || '';
    const ru = loc.startsWith('http') ? loc : `${UTAGE_BASE_URL}${loc}`;
    if (ru.includes('/login')) { await utageLogin(); return authedGet(url); }
    return authedGet(ru);
  }
  return resp.text();
}

async function getLatestCrNumber(): Promise<number> {
  console.log('2. 最新CR番号取得中...');
  const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${SP_FUNNEL.funnelId}/tracking`);
  const matches = [...html.matchAll(/TikTok広告-スキルプラス-LP2-CR(0\d{4})/g)];
  if (matches.length === 0) return 0;
  const nums = matches.map(m => parseInt(m[1])).sort((a, b) => b - a);
  console.log(`   最新: CR${String(nums[0]).padStart(5, '0')}`);
  return nums[0];
}

async function createRegistrationPath(crNumber: number): Promise<string> {
  const crStr = String(crNumber).padStart(5, '0');
  const regPath = `TikTok広告-スキルプラス-LP2-CR${crStr}`;
  console.log(`3. UTAGE登録経路作成: ${regPath}`);

  const createFormUrl = `${UTAGE_BASE_URL}/funnel/${SP_FUNNEL.funnelId}/tracking/create`;
  const formHtml = await authedGet(createFormUrl);
  let formToken: string;
  try { formToken = extractCsrfToken(formHtml); } catch { formToken = ''; }

  let formAction = '';
  const formRegex = /<form[^>]*action=["']([^"']*)["'][^>]*>([\s\S]*?)<\/form>/gi;
  let fm: RegExpExecArray | null;
  while ((fm = formRegex.exec(formHtml)) !== null) {
    if (fm[2].includes('name="name"') || fm[2].includes('name="group_id"')) { formAction = fm[1]; break; }
  }
  if (!formAction) formAction = `${UTAGE_BASE_URL}/funnel/${SP_FUNNEL.funnelId}/tracking`;
  const postUrl = formAction.startsWith('http') ? formAction : `${UTAGE_BASE_URL}${formAction}`;

  const body = new URLSearchParams({ _token: formToken, name: regPath, group_id: SP_FUNNEL.groupId, step_id: SP_FUNNEL.stepId });
  const postResp = await fetch(postUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': sessionCookies, 'Referer': createFormUrl },
    body: body.toString(), redirect: 'manual',
  });
  sessionCookies = mergeCookies(sessionCookies, postResp.headers);

  let listingHtml = '';
  if (postResp.status === 302) {
    const loc = postResp.headers.get('location') || '';
    listingHtml = await authedGet(loc.startsWith('http') ? loc : `${UTAGE_BASE_URL}${loc}`);
  } else listingHtml = await postResp.text();

  let foundIdx = listingHtml.indexOf(regPath);
  let foundHtml = foundIdx !== -1 ? listingHtml : '';
  if (foundIdx === -1) {
    const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${SP_FUNNEL.funnelId}/tracking`);
    foundIdx = html.indexOf(regPath);
    if (foundIdx !== -1) foundHtml = html;
  }
  if (foundIdx === -1) {
    for (let page = 2; page <= 10; page++) {
      const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${SP_FUNNEL.funnelId}/tracking?page=${page}`);
      foundIdx = html.indexOf(regPath);
      if (foundIdx !== -1) { foundHtml = html; break; }
      if (!html.includes(`page=${page + 1}`)) break;
    }
  }
  if (foundIdx === -1) throw new Error(`登録経路が見つかりません: ${regPath}`);

  const context = foundHtml.substring(Math.max(0, foundIdx - 500), foundIdx + 3000);
  const urlMatch = context.match(new RegExp(`https://school\\.addness\\.co\\.jp/p/${SP_FUNNEL.stepId}\\?ftid=[a-zA-Z0-9]+`));
  if (!urlMatch) throw new Error(`遷移先URL取得失敗`);

  console.log(`   完了: ${urlMatch[0]}`);
  return urlMatch[0];
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const adv = await prisma.advertiser.findFirst({ where: { tiktokAdvertiserId: SP1_ID } });
    if (!adv) throw new Error('SP1 not found');

    await utageLogin();
    const latestCr = await getLatestCrNumber();
    const newCr = latestCr + 1;
    const crStr = `CR${String(newCr).padStart(5, '0')}`;
    console.log(`   新CR番号: ${crStr}`);

    const destUrl = await createRegistrationPath(newCr);
    const lpUrl = `${destUrl}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;

    const ds = getJstDateStr();
    const adName = `${ds}/${SOURCE_NAME}/LP2-${crStr}`;
    console.log(`\n4. Smart+キャンペーン作成: ${adName}`);

    const campData = await tiktokApi('/v1.3/smart_plus/campaign/create/', {
      advertiser_id: SP1_ID, campaign_name: adName, objective_type: 'LEAD_GENERATION',
      budget_mode: 'BUDGET_MODE_INFINITE', budget_optimize_on: false,
      request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
    });
    const campaignId = String(campData.data.campaign_id);
    console.log(`   キャンペーンID: ${campaignId}`);

    console.log('5. 広告グループ作成...');
    const agData = await tiktokApi('/v1.3/smart_plus/adgroup/create/', {
      advertiser_id: SP1_ID, campaign_id: campaignId, adgroup_name: `${ds} 25-54`,
      budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET', budget: DAILY_BUDGET,
      billing_event: 'OCPM', bid_type: 'BID_TYPE_NO_BID',
      optimization_goal: 'CONVERT', optimization_event: 'ON_WEB_REGISTER',
      pixel_id: adv.pixelId, promotion_type: 'LEAD_GENERATION', promotion_target_type: 'EXTERNAL_WEBSITE',
      placement_type: 'PLACEMENT_TYPE_NORMAL', placements: ['PLACEMENT_TIKTOK'],
      comment_disabled: true, schedule_type: 'SCHEDULE_FROM_NOW', schedule_start_time: getJstScheduleTime(),
      targeting_optimization_mode: 'MANUAL',
      targeting_spec: { location_ids: ['1861060'], age_groups: ['AGE_25_34', 'AGE_35_44', 'AGE_45_54'] },
      request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
    });
    const adgroupId = String(agData.data.adgroup_id);
    console.log(`   広告グループID: ${adgroupId}`);

    // ターゲティング検証
    console.log('   ターゲティング検証（5秒待機）...');
    await new Promise(r => setTimeout(r, 5000));
    const verify = await tiktokGet('/v1.3/smart_plus/adgroup/get/', { advertiser_id: SP1_ID, adgroup_ids: JSON.stringify([adgroupId]) });
    console.log(`   年齢: ${JSON.stringify(verify.data?.list?.[0]?.targeting_spec?.age_groups)}`);

    // CTA取得
    const ctaResp = await tiktokGet('/v1.3/smart_plus/ad/get/', { advertiser_id: SP1_ID, page_size: '5' });
    const ctaId = ctaResp.data?.list?.[0]?.ad_configuration?.call_to_action_id || '';

    console.log(`\n6. Smart+広告作成...`);
    const adData = await tiktokApi('/v1.3/smart_plus/ad/create/', {
      advertiser_id: SP1_ID, adgroup_id: adgroupId, ad_name: adName,
      creative_list: [{
        creative_info: {
          ad_format: 'SINGLE_VIDEO',
          video_info: { video_id: SOURCE_VIDEO_ID },
          identity_id: adv.identityId,
          identity_type: 'BC_AUTH_TT',
          identity_authorized_bc_id: adv.identityAuthorizedBcId || adv.bcId,
          image_info: [{ web_uri: SOURCE_IMAGE_URI }],
        },
      }],
      ad_text_list: [{ ad_text: AD_TEXT }],
      landing_page_url_list: [{ landing_page_url: lpUrl }],
      ad_configuration: { call_to_action_id: ctaId },
      operation_status: 'ENABLE',
      request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
    });
    const newAdId = String(adData.data?.ad_id || adData.data?.smart_plus_ad_id);

    console.log('\n========================================');
    console.log('✅ 再出稿完了');
    console.log(`   キャンペーン: ${adName}`);
    console.log(`   キャンペーンID: ${campaignId}`);
    console.log(`   広告グループID: ${adgroupId}`);
    console.log(`   広告ID: ${newAdId}`);
    console.log(`   日予算: ¥${DAILY_BUDGET}`);
    console.log(`   LP: ${lpUrl}`);
    console.log(`   CR番号: ${crStr}`);
    console.log('========================================');

    // DB登録
    console.log('\n7. DB登録...');
    const dbCamp = await prisma.campaign.create({
      data: { tiktokId: campaignId, name: adName, advertiserId: adv.id, objectiveType: 'LEAD_GENERATION', status: 'ENABLE' },
    });
    const dbAg = await prisma.adGroup.create({
      data: { tiktokId: adgroupId, name: `${ds} 25-54`, campaignId: dbCamp.id, initialBudget: DAILY_BUDGET, status: 'ENABLE' },
    });
    let creative = await prisma.creative.findFirst({ where: { tiktokVideoId: SOURCE_VIDEO_ID, advertiserId: adv.id } });
    if (!creative) {
      creative = await prisma.creative.create({
        data: { advertiserId: adv.id, name: `${crStr}-video`, tiktokVideoId: SOURCE_VIDEO_ID, type: 'VIDEO', url: '', filename: 'おい会社員_穏やか_3万小遣い' },
      });
    }
    await prisma.ad.create({
      data: { tiktokId: newAdId, name: adName, adgroupId: dbAg.id, creativeId: creative.id, status: 'ENABLE' },
    });
    console.log('   DB登録完了');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
