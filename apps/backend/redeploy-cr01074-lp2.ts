/**
 * CR01074（2026年3月度勝ちCR）をAI_2にLP2で再出稿する一回限りスクリプト
 *
 * - 元動画: v10033g50000d6r6snnog65oe0q0umq0 (AI_2上に既存)
 * - LP: LP2（通常のredeploy-adはソース広告名からLP自動検出するが、ここではLP2を強制）
 * - アカウント: AI_2 (7523128243466551303)
 */

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

// ===== 設定 =====
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

const UTAGE_BASE_URL = 'https://school.addness.co.jp';
const UTAGE_LOGIN_URL = 'https://school.addness.co.jp/operator/GYbKT7Y9d0eR/login';
const UTAGE_EMAIL = process.env.UTAGE_EMAIL || 'chiba.nobuteru@team.addness.co.jp';
const UTAGE_PASSWORD = process.env.UTAGE_PASSWORD || 'bC4F6mkV';

// 固定パラメータ
const ADVERTISER_ID = '7523128243466551303'; // AI_2
const VIDEO_ID = 'v10033g50000d6r6snnog65oe0q0umq0';
const APPEAL = 'AI';
const LP_NUMBER = 2;
const CREATOR = '千葉信輝';
const CR_NAME = '2026年3月度勝ちCR';
const DAILY_BUDGET = 3000;
const AD_TEXT = 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）';

// AI LP2 UTAGE設定
const FUNNEL_CONFIG = { funnelId: 'a09j9jop95LF', groupId: 'bvnhWMTjQAPU', stepId: 'EnFeDysozIui' };

// ===== ユーティリティ =====
let sessionCookies = '';

function mergeCookies(existing: string, headers: Headers): string {
  const raw = headers.get('set-cookie');
  if (!raw) return existing;
  const cookies = raw.split(/,(?=\s*[a-zA-Z_]+=)/).map(c => c.split(';')[0].trim());
  const merged = new Map<string, string>();
  if (existing) {
    existing.split('; ').forEach(c => { const [k] = c.split('='); merged.set(k, c); });
  }
  cookies.forEach(c => { const [k] = c.split('='); merged.set(k, c); });
  return [...merged.values()].join('; ');
}

function extractCsrfToken(html: string): string {
  const m1 = html.match(/<input[^>]+name=["']_token["'][^>]+value=["']([^"']+)["']/);
  if (m1) return m1[1];
  const m2 = html.match(/value=["']([^"']+)["'][^>]+name=["']_token["']/);
  if (m2) return m2[1];
  const m3 = html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/);
  if (m3) return m3[1];
  throw new Error('CSRFトークンが見つかりません');
}

function getJstNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function isAfter15Jst(): boolean {
  return getJstNow().getUTCHours() >= 15;
}

function getDeliveryDate(): Date {
  const jst = getJstNow();
  if (isAfter15Jst()) {
    jst.setUTCDate(jst.getUTCDate() + 1);
  }
  return jst;
}

function getJstDateStr(): string {
  const d = getDeliveryDate();
  return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

function getJstScheduleTime(): string {
  if (isAfter15Jst()) {
    // 翌日0時JST = 当日15:00 UTC（TikTok APIはUTCで解釈する）
    const d = getDeliveryDate();
    d.setUTCDate(d.getUTCDate() - 1);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} 15:00:00`;
  } else {
    // 今すぐ開始（現在UTC+5分）
    const t = new Date(Date.now() + 5 * 60 * 1000);
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}:${String(t.getUTCSeconds()).padStart(2, '0')}`;
  }
}

async function tiktokApi(endpoint: string, body: any): Promise<any> {
  console.log(`  API: ${endpoint}`);
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Access-Token': ACCESS_TOKEN },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`TikTok API エラー: ${data.message} (code: ${data.code})\n${JSON.stringify(data, null, 2)}`);
  }
  return data;
}

async function tiktokGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, {
    headers: { 'Access-Token': ACCESS_TOKEN },
  });
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`TikTok API エラー: ${data.message} (code: ${data.code})`);
  }
  return data;
}

// ===== UTAGE =====
async function utageLogin(): Promise<void> {
  console.log('1. UTAGEログイン中...');
  const pageResp = await fetch(UTAGE_LOGIN_URL, { redirect: 'manual' });
  sessionCookies = mergeCookies('', pageResp.headers);
  const pageHtml = await pageResp.text();
  const csrfToken = extractCsrfToken(pageHtml);

  const formBody = new URLSearchParams({ _token: csrfToken, email: UTAGE_EMAIL, password: UTAGE_PASSWORD });
  const loginResp = await fetch(UTAGE_LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': sessionCookies, 'Referer': UTAGE_LOGIN_URL },
    body: formBody.toString(),
    redirect: 'manual',
  });
  sessionCookies = mergeCookies(sessionCookies, loginResp.headers);

  const location = loginResp.headers.get('location') || '';
  if (loginResp.status === 302 && !location.includes('/login')) {
    const redirectUrl = location.startsWith('http') ? location : `${UTAGE_BASE_URL}${location}`;
    const redirectResp = await fetch(redirectUrl, { headers: { 'Cookie': sessionCookies }, redirect: 'manual' });
    sessionCookies = mergeCookies(sessionCookies, redirectResp.headers);
    console.log('   ログイン成功');
  } else {
    throw new Error('UTAGEログイン失敗');
  }
}

async function authedGet(url: string): Promise<string> {
  const resp = await fetch(url, { headers: { 'Cookie': sessionCookies }, redirect: 'manual' });
  sessionCookies = mergeCookies(sessionCookies, resp.headers);
  if (resp.status === 302) {
    const loc = resp.headers.get('location') || '';
    const redirectUrl = loc.startsWith('http') ? loc : `${UTAGE_BASE_URL}${loc}`;
    if (redirectUrl.includes('/login')) { await utageLogin(); return authedGet(url); }
    return authedGet(redirectUrl);
  }
  return resp.text();
}

async function getLatestCrNumber(): Promise<number> {
  console.log(`2. 最新CR番号を取得中... (${APPEAL} LP${LP_NUMBER})`);
  const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${FUNNEL_CONFIG.funnelId}/tracking`);

  const pattern = new RegExp(`TikTok広告-${APPEAL}-LP${LP_NUMBER}-CR(0\\d{4})`, 'g');
  const matches = [...html.matchAll(pattern)];

  if (matches.length === 0) {
    console.log('   既存の登録経路なし、CR00001から開始');
    return 0;
  }

  const crNumbers = matches.map(m => parseInt(m[1])).sort((a, b) => b - a);
  console.log(`   最新CR番号: CR${String(crNumbers[0]).padStart(5, '0')} (${matches.length}件中)`);
  return crNumbers[0];
}

async function createRegistrationPath(crNumber: number): Promise<{ registrationPath: string; destinationUrl: string }> {
  const crStr = String(crNumber).padStart(5, '0');
  const registrationPath = `TikTok広告-${APPEAL}-LP${LP_NUMBER}-CR${crStr}`;
  console.log(`3. UTAGE登録経路作成中: ${registrationPath}`);

  const createFormUrl = `${UTAGE_BASE_URL}/funnel/${FUNNEL_CONFIG.funnelId}/tracking/create`;
  const formHtml = await authedGet(createFormUrl);
  let formToken: string;
  try { formToken = extractCsrfToken(formHtml); } catch { formToken = ''; }

  let formAction = '';
  const formRegex = /<form[^>]*action=["']([^"']*)["'][^>]*>([\s\S]*?)<\/form>/gi;
  let formMatch: RegExpExecArray | null;
  while ((formMatch = formRegex.exec(formHtml)) !== null) {
    if (formMatch[2].includes('name="name"') || formMatch[2].includes('name="group_id"')) {
      formAction = formMatch[1]; break;
    }
  }
  if (!formAction) formAction = `${UTAGE_BASE_URL}/funnel/${FUNNEL_CONFIG.funnelId}/tracking`;
  const postUrl = formAction.startsWith('http') ? formAction : `${UTAGE_BASE_URL}${formAction}`;

  const body = new URLSearchParams({ _token: formToken, name: registrationPath, group_id: FUNNEL_CONFIG.groupId, step_id: FUNNEL_CONFIG.stepId });
  const postResp = await fetch(postUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': sessionCookies, 'Referer': createFormUrl },
    body: body.toString(),
    redirect: 'manual',
  });
  sessionCookies = mergeCookies(sessionCookies, postResp.headers);

  let listingHtml = '';
  if (postResp.status === 302) {
    const loc = postResp.headers.get('location') || '';
    listingHtml = await authedGet(loc.startsWith('http') ? loc : `${UTAGE_BASE_URL}${loc}`);
  } else {
    listingHtml = await postResp.text();
  }

  let foundIdx = listingHtml.indexOf(registrationPath);
  let foundHtml = foundIdx !== -1 ? listingHtml : '';

  if (foundIdx === -1) {
    const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${FUNNEL_CONFIG.funnelId}/tracking`);
    foundIdx = html.indexOf(registrationPath);
    if (foundIdx !== -1) foundHtml = html;
  }
  if (foundIdx === -1) {
    for (let page = 2; page <= 10; page++) {
      const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${FUNNEL_CONFIG.funnelId}/tracking?page=${page}`);
      foundIdx = html.indexOf(registrationPath);
      if (foundIdx !== -1) { foundHtml = html; break; }
      if (!html.includes(`page=${page + 1}`)) break;
    }
  }
  if (foundIdx === -1) throw new Error(`作成した登録経路が見つかりません: ${registrationPath}`);

  const context = foundHtml.substring(Math.max(0, foundIdx - 500), foundIdx + 3000);
  const urlPattern = new RegExp(`https://school\\.addness\\.co\\.jp/p/${FUNNEL_CONFIG.stepId}\\?ftid=[a-zA-Z0-9]+`);
  const urlMatch = context.match(urlPattern);
  if (!urlMatch) throw new Error(`遷移先URLの取得に失敗: ${registrationPath}`);

  console.log(`   作成完了: ${urlMatch[0]}`);
  return { registrationPath, destinationUrl: urlMatch[0] };
}

// ===== TikTok広告作成 =====
async function uploadThumbnail(): Promise<string> {
  console.log('4. サムネイル画像アップロード中...');

  const videoData = await tiktokGet('/v1.3/file/video/ad/info/', {
    advertiser_id: ADVERTISER_ID,
    video_ids: JSON.stringify([VIDEO_ID]),
  });
  const videos = videoData.data?.list || (Array.isArray(videoData.data) ? videoData.data : []);
  const coverUrl = videos[0]?.video_cover_url || videos[0]?.preview_url;
  if (!coverUrl) throw new Error('サムネイルURLが取得できません');

  const imgResp = await fetch(coverUrl);
  const buffer = Buffer.from(await imgResp.arrayBuffer());
  const signature = crypto.createHash('md5').update(buffer).digest('hex');

  const FormData = require('form-data');
  const form = new FormData();
  form.append('advertiser_id', ADVERTISER_ID);
  form.append('upload_type', 'UPLOAD_BY_FILE');
  form.append('image_signature', signature);
  form.append('image_file', buffer, { filename: `thumbnail_${Date.now()}.jpg`, contentType: 'image/jpeg' });

  const axios = require('axios');
  const resp = await axios.post(`${TIKTOK_API_BASE}/v1.3/file/image/ad/upload/`, form, {
    headers: { 'Access-Token': ACCESS_TOKEN, ...form.getHeaders() },
    timeout: 30000,
  });
  if (resp.data.code !== 0) throw new Error(`サムネイルアップロード失敗: ${resp.data.message}`);

  const imageId = resp.data.data.image_id;
  console.log(`   画像ID: ${imageId}`);
  return imageId;
}

async function createCampaign(adName: string): Promise<string> {
  console.log('5. キャンペーン作成中...');
  const data = await tiktokApi('/v1.2/campaign/create/', {
    advertiser_id: ADVERTISER_ID,
    campaign_name: adName,
    objective_type: 'LEAD_GENERATION',
    budget_mode: 'BUDGET_MODE_INFINITE',
  });
  const campaignId = String(data.data.campaign_id);
  console.log(`   キャンペーンID: ${campaignId}`);
  return campaignId;
}

async function createAdGroup(campaignId: string, pixelId: string): Promise<string> {
  const ages = ['AGE_25_34', 'AGE_35_44', 'AGE_45_54'];
  console.log(`6. 広告グループ作成中... (年齢: ${ages.join(', ')})`);
  const adgroupName = `${getJstDateStr()} ノンタゲ`;
  const data = await tiktokApi('/v1.3/adgroup/create/', {
    advertiser_id: ADVERTISER_ID,
    campaign_id: campaignId,
    adgroup_name: adgroupName,
    promotion_type: 'LEAD_GENERATION',
    promotion_target_type: 'EXTERNAL_WEBSITE',
    placement_type: 'PLACEMENT_TYPE_NORMAL',
    placements: ['PLACEMENT_TIKTOK'],
    location_ids: ['1861060'],
    languages: ['ja'],
    age_groups: ages,
    gender: 'GENDER_UNLIMITED',
    budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET',
    budget: DAILY_BUDGET,
    bid_type: 'BID_TYPE_NO_BID',
    billing_event: 'OCPM',
    optimization_goal: 'CONVERT',
    pixel_id: pixelId,
    optimization_event: 'ON_WEB_REGISTER',
    schedule_type: 'SCHEDULE_FROM_NOW',
    schedule_start_time: getJstScheduleTime(),
    pacing: 'PACING_MODE_SMOOTH',
    skip_learning_phase: true,
    video_download_disabled: true,
    click_attribution_window: 'SEVEN_DAYS',
    view_attribution_window: 'ONE_DAY',
  });
  const adgroupId = String(data.data.adgroup_id);
  console.log(`   広告グループID: ${adgroupId}`);
  return adgroupId;
}

async function createAd(
  adgroupId: string, adName: string,
  imageId: string, landingPageUrl: string,
  identityId: string, identityBcId: string,
): Promise<string> {
  console.log('7. 広告作成中...');
  const data = await tiktokApi('/v1.3/ad/create/', {
    advertiser_id: ADVERTISER_ID,
    adgroup_id: adgroupId,
    creatives: [{
      ad_name: adName,
      ad_text: AD_TEXT,
      call_to_action: 'LEARN_MORE',
      landing_page_url: landingPageUrl,
      identity_id: identityId,
      identity_type: 'BC_AUTH_TT',
      identity_authorized_bc_id: identityBcId,
      video_id: VIDEO_ID,
      image_ids: [imageId],
      ad_format: 'SINGLE_VIDEO',
    }],
  });
  const adId = String(data.data.ad_ids?.[0] || data.data.ad_id);
  console.log(`   広告ID: ${adId}`);
  return adId;
}

// ===== メイン =====
async function main() {
  console.log('===== CR01074 LP2 再出稿 (AI_2) =====');
  console.log(`アカウント: ${ADVERTISER_ID} (AI_2)`);
  console.log(`動画ID: ${VIDEO_ID}`);
  console.log(`LP: LP${LP_NUMBER} (強制指定)`);
  console.log(`日予算: ¥${DAILY_BUDGET}`);
  console.log();

  const prisma = new PrismaClient();
  try {
    const advertiser = await prisma.advertiser.findUnique({
      where: { tiktokAdvertiserId: ADVERTISER_ID },
      select: { pixelId: true, identityId: true, identityAuthorizedBcId: true, name: true },
    });
    if (!advertiser) throw new Error(`DBにアカウントが見つかりません: ${ADVERTISER_ID}`);
    if (!advertiser.pixelId || !advertiser.identityId || !advertiser.identityAuthorizedBcId) {
      throw new Error('アカウントにpixelId/identityId/bcIdが未設定です');
    }
    console.log(`アカウント名: ${advertiser.name}`);
    const jstHour = getJstNow().getUTCHours();
    if (isAfter15Jst()) {
      console.log(`現在JST ${jstHour}時 → 15時以降のため翌日0時から配信開始`);
    } else {
      console.log(`現在JST ${jstHour}時 → 15時前のため本日付けで即配信開始`);
    }
    console.log(`配信開始: ${getJstScheduleTime()}`);
    console.log(`広告名日付: ${getJstDateStr()}\n`);

    // 1. UTAGE
    await utageLogin();
    const latestCr = await getLatestCrNumber();
    const newCrNumber = latestCr + 1;
    const { registrationPath, destinationUrl } = await createRegistrationPath(newCrNumber);

    // 2. 広告名生成
    const crStr = String(newCrNumber).padStart(5, '0');
    const adName = `${getJstDateStr()}/${CREATOR}/${CR_NAME}/LP${LP_NUMBER}-CR${crStr}`;
    const landingPageUrl = `${destinationUrl}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;
    console.log(`\n広告名: ${adName}`);
    console.log(`LP URL: ${landingPageUrl}\n`);

    // 3. サムネイルアップロード
    const imageId = await uploadThumbnail();

    // 4-6. キャンペーン → 広告グループ → 広告
    const campaignId = await createCampaign(adName);
    const adgroupId = await createAdGroup(campaignId, advertiser.pixelId);
    const adId = await createAd(
      adgroupId, adName, imageId, landingPageUrl,
      advertiser.identityId, advertiser.identityAuthorizedBcId,
    );

    console.log('\n===== 再出稿完了 =====');
    console.log(`広告名: ${adName}`);
    console.log(`CR番号: CR${crStr}`);
    console.log(`UTAGE経路: ${registrationPath}`);
    console.log(`キャンペーンID: ${campaignId}`);
    console.log(`広告グループID: ${adgroupId}`);
    console.log(`広告ID: ${adId}`);
    console.log(`日予算: ¥${DAILY_BUDGET}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('\n===== エラー =====');
  console.error(err);
  process.exit(1);
});
