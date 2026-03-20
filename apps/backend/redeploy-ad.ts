/**
 * 同一アカウント内でCRを再出稿する汎用スクリプト
 *
 * 使い方:
 *   npx tsx apps/backend/redeploy-ad.ts <advertiser_id> <source_ad_id> [daily_budget]
 *
 * 例:
 *   npx tsx apps/backend/redeploy-ad.ts 7474920444831875080 1859709464799409
 *   npx tsx apps/backend/redeploy-ad.ts 7474920444831875080 1859709464799409 3000
 *
 * 処理フロー:
 *   1. 元広告の情報をTikTok APIから取得（広告名・動画ID・広告文・LP）
 *   2. 広告名からappeal/LP番号を推定
 *   3. UTAGEにログイン → 最新CR番号取得 → 新規登録経路作成
 *   4. 動画サムネイル取得＆アップロード（同一アカウントなので動画再アップロード不要）
 *   5. キャンペーン → 広告グループ → 広告 を作成
 *
 * 注意:
 *   - 同一アカウント内の再出稿専用（別アカウントへは /自動出稿 を使う）
 *   - 通常配信（REGULAR）の1-1-1構成で作成される
 *   - 動画は元広告のものをそのまま再利用
 */

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

// ===== 設定 =====
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

// UTAGE設定
const UTAGE_BASE_URL = 'https://school.addness.co.jp';
const UTAGE_LOGIN_URL = 'https://school.addness.co.jp/operator/GYbKT7Y9d0eR/login';
const UTAGE_EMAIL = process.env.UTAGE_EMAIL || 'chiba.nobuteru@team.addness.co.jp';
const UTAGE_PASSWORD = process.env.UTAGE_PASSWORD || 'bC4F6mkV';

// ファネルマッピング
const TIKTOK_FUNNEL_MAP: Record<string, Record<number, { funnelId: string; groupId: string; stepId: string }>> = {
  'AI': {
    1: { funnelId: 'a09j9jop95LF', groupId: 'EFnsGw3gAdba', stepId: 'r2RHcL0PdGIY' },
    2: { funnelId: 'a09j9jop95LF', groupId: 'bvnhWMTjQAPU', stepId: 'EnFeDysozIui' },
    3: { funnelId: 'a09j9jop95LF', groupId: 'EZL6dqvMuop6', stepId: 'A65xiRBl9HCD' },
    4: { funnelId: 'a09j9jop95LF', groupId: 'hEwR9BcvprDu', stepId: 'T8RHcXJVzGtY' },
    5: { funnelId: 'a09j9jop95LF', groupId: 'ND7cXzKmeiqG', stepId: 'EIQBI7HAVxgd' },
    6: { funnelId: 'a09j9jop95LF', groupId: 'FNFK0iB3rIzl', stepId: 'U8Ba9qy5m0us' },
  },
  'SNS': {
    1: { funnelId: 'dZNDzwCgHNBC', groupId: '32FwkcHtFSuj', stepId: 'wZhilaQY1Huv' },
    2: { funnelId: 'dZNDzwCgHNBC', groupId: 'dLrB2E7U7tq8', stepId: 'AhTvtpaeXyj6' },
    3: { funnelId: 'dZNDzwCgHNBC', groupId: 'L9JO3krgnNYD', stepId: '5UKZIXOKSyV4' },
  },
  'スキルプラス': {
    2: { funnelId: '3lS3x3dXa6kc', groupId: 'sOiiROJBAVIu', stepId: 'doc7hffUAVTv' },
  },
};

const DEFAULT_DAILY_BUDGET: Record<string, number> = {
  'AI': 3000,
  'SNS': 3000,
  'スキルプラス': 5000,
};

const DEFAULT_AD_TEXT: Record<string, string> = {
  'AI': 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）',
  'SNS': 'SNSで独立するなら学んでおきたい本質のSNSマーケ特商法（https://skill.addness.co.jp/tokushoho）',
  'スキルプラス': 'スキルで独立するなら学んでおきたい本質のスキル活用術特商法（https://skill.addness.co.jp/tokushoho）',
};

// アカウント→appeal マッピング
const ACCOUNT_APPEAL_MAP: Record<string, string> = {
  '7468288053866561553': 'AI',
  '7523128243466551303': 'AI',
  '7543540647266074641': 'AI',
  '7580666710525493255': 'AI',
  '7247073333517238273': 'SNS',
  '7543540100849156112': 'SNS',
  '7543540381615800337': 'SNS',
  '7474920444831875080': 'スキルプラス',
  '7592868952431362066': 'スキルプラス',
};

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

/**
 * JST現在時刻が15時以降かどうかで配信開始日を決定
 * - 15時より前 → 今日付けで即配信開始
 * - 15時以降 → 翌日0時から配信開始
 */
function getJstNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function isAfter15Jst(): boolean {
  return getJstNow().getUTCHours() >= 15;
}

function getDeliveryDate(): Date {
  const jst = getJstNow();
  if (isAfter15Jst()) {
    // 翌日
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
    // 翌日0時JSTから配信開始
    const d = getDeliveryDate();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} 00:00:00`;
  } else {
    // 今すぐ開始（現在時刻+5分）
    const t = new Date(Date.now() + 9 * 60 * 60 * 1000 + 5 * 60 * 1000);
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

// ===== 元広告情報取得 =====
async function getSourceAdInfo(advertiserId: string, adId: string) {
  console.log('1. 元広告の情報を取得中...');

  // 広告情報取得
  const adData = await tiktokGet('/v1.3/ad/get/', {
    advertiser_id: advertiserId,
    filtering: JSON.stringify({ ad_ids: [adId] }),
    fields: JSON.stringify(['ad_id', 'ad_name', 'ad_text', 'landing_page_url', 'video_id', 'call_to_action', 'call_to_action_id', 'creative_type']),
  });
  const ad = adData.data?.list?.[0];
  if (!ad) throw new Error(`広告が見つかりません: ${adId}`);

  const adName = ad.ad_name;
  const adText = ad.ad_text;
  const videoId = ad.video_id;
  const landingPageUrl = ad.landing_page_url;

  console.log(`   広告名: ${adName}`);
  console.log(`   動画ID: ${videoId}`);
  console.log(`   広告文: ${adText}`);

  return { adName, adText, videoId, landingPageUrl };
}

// ===== 広告名パース =====
function parseAdInfo(adName: string, advertiserId: string): { appeal: string; lpNumber: number; creator: string; crName: string } {
  // LP番号抽出
  const lpMatch = adName.match(/LP(\d+)/i);
  const lpNumber = lpMatch ? parseInt(lpMatch[1]) : 1;

  // appeal推定（アカウントID → 広告名の手がかり）
  let appeal = ACCOUNT_APPEAL_MAP[advertiserId] || 'AI';
  if (adName.includes('SNS') || adName.includes('sns')) appeal = 'SNS';
  else if (adName.includes('スキル') || adName.includes('セミナー')) appeal = 'スキルプラス';

  // 制作者名・CR名を抽出（YYMMDD/制作者/CR名/LP-CR形式）
  const parts = adName.split('/');
  const creator = parts.length >= 2 ? parts[1] : '横展開';
  const crName = parts.length >= 3 ? parts[2] : '横展開CR';

  return { appeal, lpNumber, creator, crName };
}

// ===== UTAGE =====
async function utageLogin(): Promise<void> {
  console.log('2. UTAGEログイン中...');
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

async function getLatestCrNumber(appeal: string, lpNumber: number): Promise<number> {
  const config = TIKTOK_FUNNEL_MAP[appeal]?.[lpNumber];
  if (!config) throw new Error(`未対応の導線/LP: ${appeal} LP${lpNumber}`);

  console.log(`3. 最新CR番号を取得中... (${appeal} LP${lpNumber})`);
  const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${config.funnelId}/tracking`);

  // 5桁ゼロ埋め形式のみマッチ（過去の手動登録CR29527等を除外）
  const pattern = new RegExp(`TikTok広告-${appeal}-LP${lpNumber}-CR(0\\d{4})`, 'g');
  const matches = [...html.matchAll(pattern)];

  if (matches.length === 0) {
    console.log('   既存の登録経路なし、CR00001から開始');
    return 0;
  }

  const crNumbers = matches.map(m => parseInt(m[1])).sort((a, b) => b - a);
  console.log(`   最新CR番号: CR${String(crNumbers[0]).padStart(5, '0')} (${matches.length}件中)`);
  return crNumbers[0];
}

async function createRegistrationPath(appeal: string, lpNumber: number, crNumber: number): Promise<{ registrationPath: string; destinationUrl: string }> {
  const config = TIKTOK_FUNNEL_MAP[appeal]![lpNumber]!;
  const crStr = String(crNumber).padStart(5, '0');
  const registrationPath = `TikTok広告-${appeal}-LP${lpNumber}-CR${crStr}`;
  console.log(`4. UTAGE登録経路作成中: ${registrationPath}`);

  const createFormUrl = `${UTAGE_BASE_URL}/funnel/${config.funnelId}/tracking/create`;
  const formHtml = await authedGet(createFormUrl);
  let formToken: string;
  try { formToken = extractCsrfToken(formHtml); } catch { formToken = ''; }

  // フォームaction URL取得
  let formAction = '';
  const formRegex = /<form[^>]*action=["']([^"']*)["'][^>]*>([\s\S]*?)<\/form>/gi;
  let formMatch: RegExpExecArray | null;
  while ((formMatch = formRegex.exec(formHtml)) !== null) {
    if (formMatch[2].includes('name="name"') || formMatch[2].includes('name="group_id"')) {
      formAction = formMatch[1]; break;
    }
  }
  if (!formAction) formAction = `${UTAGE_BASE_URL}/funnel/${config.funnelId}/tracking`;
  const postUrl = formAction.startsWith('http') ? formAction : `${UTAGE_BASE_URL}${formAction}`;

  const body = new URLSearchParams({ _token: formToken, name: registrationPath, group_id: config.groupId, step_id: config.stepId });
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

  // URL抽出（一覧ページ → ページネーション）
  let foundIdx = listingHtml.indexOf(registrationPath);
  let foundHtml = foundIdx !== -1 ? listingHtml : '';

  if (foundIdx === -1) {
    const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${config.funnelId}/tracking`);
    foundIdx = html.indexOf(registrationPath);
    if (foundIdx !== -1) foundHtml = html;
  }
  if (foundIdx === -1) {
    for (let page = 2; page <= 10; page++) {
      const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${config.funnelId}/tracking?page=${page}`);
      foundIdx = html.indexOf(registrationPath);
      if (foundIdx !== -1) { foundHtml = html; break; }
      if (!html.includes(`page=${page + 1}`)) break;
    }
  }
  if (foundIdx === -1) throw new Error(`作成した登録経路が見つかりません: ${registrationPath}`);

  const context = foundHtml.substring(Math.max(0, foundIdx - 500), foundIdx + 3000);
  const urlPattern = new RegExp(`https://school\\.addness\\.co\\.jp/p/${config.stepId}\\?ftid=[a-zA-Z0-9]+`);
  const urlMatch = context.match(urlPattern);
  if (!urlMatch) throw new Error(`遷移先URLの取得に失敗: ${registrationPath}`);

  console.log(`   作成完了: ${urlMatch[0]}`);
  return { registrationPath, destinationUrl: urlMatch[0] };
}

// ===== TikTok広告作成 =====
async function uploadThumbnail(advertiserId: string, videoId: string): Promise<string> {
  console.log('5. サムネイル画像アップロード中...');

  // 動画情報取得
  const videoData = await tiktokGet('/v1.3/file/video/ad/info/', {
    advertiser_id: advertiserId,
    video_ids: JSON.stringify([videoId]),
  });
  const videos = videoData.data?.list || (Array.isArray(videoData.data) ? videoData.data : []);
  const coverUrl = videos[0]?.video_cover_url || videos[0]?.preview_url;
  if (!coverUrl) throw new Error('サムネイルURLが取得できません');

  // ダウンロード＆アップロード
  const imgResp = await fetch(coverUrl);
  const buffer = Buffer.from(await imgResp.arrayBuffer());
  const signature = crypto.createHash('md5').update(buffer).digest('hex');

  const FormData = require('form-data');
  const form = new FormData();
  form.append('advertiser_id', advertiserId);
  form.append('upload_type', 'UPLOAD_BY_FILE');
  form.append('image_signature', signature);
  form.append('image_file', buffer, { filename: 'thumbnail.jpg', contentType: 'image/jpeg' });

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

async function createCampaign(advertiserId: string, adName: string): Promise<string> {
  console.log('6. キャンペーン作成中...');
  const data = await tiktokApi('/v1.2/campaign/create/', {
    advertiser_id: advertiserId,
    campaign_name: adName,
    objective_type: 'LEAD_GENERATION',
    budget_mode: 'BUDGET_MODE_INFINITE',
  });
  const campaignId = String(data.data.campaign_id);
  console.log(`   キャンペーンID: ${campaignId}`);
  return campaignId;
}

async function createAdGroup(advertiserId: string, campaignId: string, pixelId: string, dailyBudget: number): Promise<string> {
  console.log('7. 広告グループ作成中...');
  const adgroupName = `${getJstDateStr()} ノンタゲ`;
  const data = await tiktokApi('/v1.3/adgroup/create/', {
    advertiser_id: advertiserId,
    campaign_id: campaignId,
    adgroup_name: adgroupName,
    promotion_type: 'LEAD_GENERATION',
    promotion_target_type: 'EXTERNAL_WEBSITE',
    placement_type: 'PLACEMENT_TYPE_NORMAL',
    placements: ['PLACEMENT_TIKTOK'],
    location_ids: ['1861060'],
    languages: ['ja'],
    age_groups: ['AGE_18_24', 'AGE_25_34', 'AGE_35_44', 'AGE_45_54', 'AGE_55_100'],
    gender: 'GENDER_UNLIMITED',
    budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET',
    budget: dailyBudget,
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
  advertiserId: string, adgroupId: string, adName: string,
  videoId: string, imageId: string, adText: string,
  landingPageUrl: string, identityId: string, identityBcId: string,
): Promise<string> {
  console.log('8. 広告作成中...');
  const data = await tiktokApi('/v1.3/ad/create/', {
    advertiser_id: advertiserId,
    adgroup_id: adgroupId,
    creatives: [{
      ad_name: adName,
      ad_text: adText,
      call_to_action: 'LEARN_MORE',
      landing_page_url: landingPageUrl,
      identity_id: identityId,
      identity_type: 'BC_AUTH_TT',
      identity_authorized_bc_id: identityBcId,
      video_id: videoId,
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
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('使い方: npx tsx apps/backend/redeploy-ad.ts <advertiser_id> <source_ad_id> [daily_budget]');
    console.log('');
    console.log('例:');
    console.log('  npx tsx apps/backend/redeploy-ad.ts 7474920444831875080 1859709464799409');
    console.log('  npx tsx apps/backend/redeploy-ad.ts 7474920444831875080 1859709464799409 3000');
    process.exit(1);
  }

  const advertiserId = args[0];
  const sourceAdId = args[1];
  const budgetOverride = args[2] ? parseInt(args[2]) : undefined;

  console.log(`===== 同一アカウント再出稿 =====`);
  console.log(`アカウント: ${advertiserId}`);
  console.log(`元広告ID: ${sourceAdId}\n`);

  // DB からアカウント情報取得
  const prisma = new PrismaClient();
  try {
    const advertiser = await prisma.advertiser.findUnique({
      where: { tiktokAdvertiserId: advertiserId },
      select: { pixelId: true, identityId: true, identityAuthorizedBcId: true, name: true },
    });
    if (!advertiser) throw new Error(`DBにアカウントが見つかりません: ${advertiserId}`);
    if (!advertiser.pixelId || !advertiser.identityId || !advertiser.identityAuthorizedBcId) {
      throw new Error(`アカウントにpixelId/identityId/bcIdが未設定です`);
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

    // 1. 元広告情報取得
    const sourceAd = await getSourceAdInfo(advertiserId, sourceAdId);

    // 2. 広告名パース
    const { appeal, lpNumber, creator, crName } = parseAdInfo(sourceAd.adName, advertiserId);
    const dailyBudget = budgetOverride || DEFAULT_DAILY_BUDGET[appeal] || 3000;
    console.log(`   appeal: ${appeal}, LP: ${lpNumber}, 日予算: ¥${dailyBudget}\n`);

    // 3. UTAGE
    await utageLogin();
    const latestCr = await getLatestCrNumber(appeal, lpNumber);
    const newCrNumber = latestCr + 1;
    const { registrationPath, destinationUrl } = await createRegistrationPath(appeal, lpNumber, newCrNumber);

    // 4. 広告名生成
    const crStr = String(newCrNumber).padStart(5, '0');
    const adName = `${getJstDateStr()}/${creator}/${crName}/LP${lpNumber}-CR${crStr}`;
    const landingPageUrl = `${destinationUrl}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;
    console.log(`\n広告名: ${adName}`);
    console.log(`LP URL: ${landingPageUrl}\n`);

    // 5. サムネイルアップロード
    const imageId = await uploadThumbnail(advertiserId, sourceAd.videoId);

    // 6-8. キャンペーン → 広告グループ → 広告
    const campaignId = await createCampaign(advertiserId, adName);
    const adgroupId = await createAdGroup(advertiserId, campaignId, advertiser.pixelId, dailyBudget);
    const adText = sourceAd.adText || DEFAULT_AD_TEXT[appeal] || '';
    const adId = await createAd(
      advertiserId, adgroupId, adName,
      sourceAd.videoId, imageId, adText,
      landingPageUrl, advertiser.identityId, advertiser.identityAuthorizedBcId,
    );

    console.log('\n===== 再出稿完了 =====');
    console.log(`広告名: ${adName}`);
    console.log(`CR番号: CR${crStr}`);
    console.log(`UTAGE経路: ${registrationPath}`);
    console.log(`キャンペーンID: ${campaignId}`);
    console.log(`広告グループID: ${adgroupId}`);
    console.log(`広告ID: ${adId}`);
    console.log(`日予算: ¥${dailyBudget}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('\n===== エラー =====');
  console.error(err);
  process.exit(1);
});
