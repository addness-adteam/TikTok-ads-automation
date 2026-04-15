/**
 * 5CR × AI1~AI3 再出稿バッチ + 5動画まとめ広告
 *
 * - CR00745, CR00797, CR00807, CR00647, CR00518 → AI_1, AI_2, AI_3（各15広告）
 * - 5動画まとめ → AI_1（1広告グループ5広告）
 * - 全て通常API（手動ターゲティング）、ディープファネル最適化あり
 * - 債務整理者類似オーディエンスを除外に追加
 * - CR00647のみLP4、他はLP1
 *
 * 使い方:
 *   npx tsx apps/backend/batch-redeploy-5crs.ts
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

const TIKTOK_FUNNEL_MAP: Record<string, Record<number, { funnelId: string; groupId: string; stepId: string }>> = {
  'AI': {
    1: { funnelId: 'a09j9jop95LF', groupId: 'EFnsGw3gAdba', stepId: 'r2RHcL0PdGIY' },
    4: { funnelId: 'a09j9jop95LF', groupId: 'hEwR9BcvprDu', stepId: 'T8RHcXJVzGtY' },
  },
};

const AI_AD_TEXT = 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）';

// 除外オーディエンスマッピング（既存 + 債務整理類似 195006413）
const EXCLUSION_AUDIENCE_MAP: Record<string, string[]> = {
  '7468288053866561553': ['194977234', '194405484', '195006413'],  // AI_1: AIオプトイン + TikTok除外 + 債務整理類似
  '7523128243466551303': ['194977234', '194405486', '195006413'],  // AI_2: AIオプトイ��� + TikTok除外 + 債務整理類似
  '7543540647266074641': ['194977234', '194405488', '195006413'],  // AI_3: AIオプトイ�� + TikTok除外 + 債務整理類似
};

const TARGET_ACCOUNTS = [
  '7468288053866561553', // AI_1
  '7523128243466551303', // AI_2
  '7543540647266074641', // AI_3
];

// ソースCR情報
const SOURCE_CRS = [
  {
    label: 'CR00745',
    sourceAdvertiserId: '7468288053866561553', // AI_1
    sourceAdId: '1854389388802146',
    creator: '鈴木��大',
    crName: 'YouTube切り抜��（パワポ終焉）',
    lpNumber: 1,
  },
  {
    label: 'CR00797',
    sourceAdvertiserId: '7468288053866561553', // AI_1
    sourceAdId: '1855351138492497',
    creator: '高橋海斗',
    crName: 'やれやめろ＿編集強化',
    lpNumber: 1,
  },
  {
    label: 'CR00807',
    sourceAdvertiserId: '7468288053866561553', // AI_1
    sourceAdId: '1855388992993393',
    creator: '石黒研太',
    crName: 'AI副業の��2（AI訴求）毎日投稿',
    lpNumber: 1,
  },
  {
    label: 'CR00647',
    sourceAdvertiserId: '7523128243466551303', // AI_2
    sourceAdId: '1848394157347922',
    creator: '清水絢吾',
    crName: 'スマプラ/箕輪＆3兆円_AI2',
    lpNumber: 4, // CR00647��みLP4
  },
  {
    label: 'CR00518',
    sourceAdvertiserId: '7468288053866561553', // AI_1
    sourceAdId: '1846834319244353',
    creator: '鈴木織大',
    crName: 'おい会���員_1年後悔',
    lpNumber: 1,
  },
];

// ===== ユーティリティ =====
let sessionCookies = '';
const videoCoverMap = new Map<string, string>(); // videoId → coverImageId

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
  if (isAfter15Jst()) jst.setUTCDate(jst.getUTCDate() + 1);
  return jst;
}

function getJstDateStr(): string {
  const d = getDeliveryDate();
  return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

function getScheduleStartTime(): string {
  if (isAfter15Jst()) {
    const d = getDeliveryDate();
    d.setUTCDate(d.getUTCDate() - 1);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} 15:00:00`;
  } else {
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
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`TikTok API エラー: ${data.message} (code: ${data.code})`);
  return data;
}

// ===== 動画取得 =====
async function getVideoIdFromAd(advertiserId: string, adId: string): Promise<{ videoId: string; adName: string }> {
  // まず通常広告APIで取得
  const adData = await tiktokGet('/v1.3/ad/get/', {
    advertiser_id: advertiserId,
    filtering: JSON.stringify({ ad_ids: [adId] }),
    fields: JSON.stringify(['ad_id', 'ad_name', 'video_id']),
  });
  const ad = adData.data?.list?.[0];
  if (ad?.video_id) {
    return { videoId: ad.video_id, adName: ad.ad_name || '' };
  }

  // Smart+広告として取得
  console.log('  通常APIで見つからず → Smart+で検索...');
  const spData = await tiktokGet('/v1.3/smart_plus/ad/get/', {
    advertiser_id: advertiserId,
    filtering: JSON.stringify({ smart_plus_ad_ids: [adId] }),
  });
  const spAd = spData.data?.list?.[0];
  if (!spAd) throw new Error(`広告が見つかりません: ${adId}`);

  const creativeList = spAd.creative_list || [];
  for (const creative of creativeList) {
    const vid = creative?.creative_info?.video_info?.video_id;
    if (vid && vid !== 'N/A') return { videoId: vid, adName: spAd.smart_plus_ad_name || '' };
  }
  throw new Error(`video_idが取得できません: ${adId}`);
}

// ===== 動画ダウンロード＆アップロード =====
async function downloadAndUploadVideo(sourceAdvId: string, targetAdvId: string, videoId: string): Promise<string> {
  if (sourceAdvId === targetAdvId) {
    console.log('  同一アカウント → 動画再利用');
    return videoId;
  }

  console.log('  動画ダウンロード＆アップロード...');
  const videoInfoData = await tiktokGet('/v1.3/file/video/ad/info/', {
    advertiser_id: sourceAdvId,
    video_ids: JSON.stringify([videoId]),
  });
  const info = videoInfoData.data?.list?.[0];
  const downloadUrl = info?.preview_url || info?.video_url;
  if (!downloadUrl) throw new Error(`動画URLが取得できません: ${videoId}`);

  const videoResp = await fetch(downloadUrl);
  const buffer = Buffer.from(await videoResp.arrayBuffer());
  console.log(`  ${(buffer.length / 1024 / 1024).toFixed(1)}MB ダウンロード完了`);

  const FormData = require('form-data');
  const axios = require('axios');
  const md5Hash = crypto.createHash('md5').update(buffer).digest('hex');
  const form = new FormData();
  form.append('advertiser_id', targetAdvId);
  form.append('upload_type', 'UPLOAD_BY_FILE');
  form.append('video_signature', md5Hash);
  form.append('video_file', buffer, { filename: `redeploy_${Date.now()}.mp4`, contentType: 'video/mp4' });

  const uploadResp = await axios.post(`${TIKTOK_API_BASE}/v1.3/file/video/ad/upload/`, form, {
    headers: { 'Access-Token': ACCESS_TOKEN, ...form.getHeaders() },
    timeout: 300000, maxContentLength: Infinity, maxBodyLength: Infinity,
  });
  if (uploadResp.data.code !== 0) throw new Error(`動画アップロード失敗: ${uploadResp.data.message}`);
  const respData = uploadResp.data.data;
  const newVideoId = Array.isArray(respData) ? respData[0]?.video_id : (respData.video_id || respData.id);
  console.log(`  アップロード完了 → ${newVideoId}`);
  return newVideoId;
}

// ===== カバー画像 =====
async function getAndUploadCover(advertiserId: string, videoId: string): Promise<string | null> {
  for (let i = 0; i < 10; i++) {
    try {
      const data = await tiktokGet('/v1.3/file/video/ad/info/', {
        advertiser_id: advertiserId,
        video_ids: JSON.stringify([videoId]),
      });
      const video = data.data?.list?.[0];
      if (video?.video_cover_url) {
        // アップロード
        const imgResp = await fetch(video.video_cover_url);
        if (!imgResp.ok) return null;
        const buffer = Buffer.from(await imgResp.arrayBuffer());
        const FormData = require('form-data');
        const axios = require('axios');
        const form = new FormData();
        form.append('advertiser_id', advertiserId);
        form.append('upload_type', 'UPLOAD_BY_FILE');
        form.append('image_signature', crypto.createHash('md5').update(buffer).digest('hex'));
        form.append('image_file', buffer, { filename: `cover_${videoId}_${Date.now()}.jpg`, contentType: 'image/jpeg' });
        const uploadResp = await axios.post(`${TIKTOK_API_BASE}/v1.3/file/image/ad/upload/`, form, {
          headers: { 'Access-Token': ACCESS_TOKEN, ...form.getHeaders() },
          timeout: 30000,
        });
        if (uploadResp.data.code !== 0) return null;
        const imageId = Array.isArray(uploadResp.data.data) ? uploadResp.data.data[0]?.image_id : uploadResp.data.data.image_id;
        console.log(`  カバー画像 → ${imageId}`);
        return imageId;
      }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 3000));
  }
  console.log('  ⚠ カバー画像取得タイムアウト');
  return null;
}

// ===== UTAGE =====
async function utageLogin(): Promise<void> {
  console.log('  UTAGEログイン中...');
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
    console.log('  ログイン成功');
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

async function getLatestCrNumber(lpNumber: number): Promise<number> {
  const config = TIKTOK_FUNNEL_MAP['AI']![lpNumber];
  if (!config) throw new Error(`未対応LP: AI LP${lpNumber}`);

  console.log(`  最新CR番号取得中 (AI LP${lpNumber})...`);
  const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${config.funnelId}/tracking`);

  const pattern = new RegExp(`TikTok広告-AI-LP${lpNumber}-CR(0\\d{4})`, 'g');
  const matches = [...html.matchAll(pattern)];
  if (matches.length === 0) return 0;
  const crNumbers = matches.map(m => parseInt(m[1])).sort((a, b) => b - a);
  console.log(`  最新CR: CR${String(crNumbers[0]).padStart(5, '0')} (${matches.length}件中)`);
  return crNumbers[0];
}

async function createRegistrationPath(lpNumber: number, crNumber: number): Promise<{ registrationPath: string; destinationUrl: string }> {
  const config = TIKTOK_FUNNEL_MAP['AI']![lpNumber]!;
  const crStr = String(crNumber).padStart(5, '0');
  const registrationPath = `TikTok広告-AI-LP${lpNumber}-CR${crStr}`;
  console.log(`  UTAGE経路作成: ${registrationPath}`);

  const createFormUrl = `${UTAGE_BASE_URL}/funnel/${config.funnelId}/tracking/create`;
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

  // URL抽出
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
  if (foundIdx === -1) throw new Error(`登録経路が見つかりません: ${registrationPath}`);

  const context = foundHtml.substring(Math.max(0, foundIdx - 500), foundIdx + 3000);
  const urlPattern = new RegExp(`https://school\\.addness\\.co\\.jp/p/${config.stepId}\\?ftid=[a-zA-Z0-9]+`);
  const urlMatch = context.match(urlPattern);
  if (!urlMatch) throw new Error(`遷移先URL取得失敗: ${registrationPath}`);

  console.log(`  完了: ${urlMatch[0]}`);
  return { registrationPath, destinationUrl: urlMatch[0] };
}

// ===== 通常広告作成（手動ターゲティング）=====
async function createRegularCampaign(advertiserId: string, campaignName: string): Promise<string> {
  console.log(`  キャンペーン作成: ${campaignName}`);
  const data = await tiktokApi('/v1.3/campaign/create/', {
    advertiser_id: advertiserId,
    campaign_name: campaignName,
    objective_type: 'LEAD_GENERATION',
    budget_mode: 'BUDGET_MODE_INFINITE',
  });
  const campaignId = String(data.data.campaign_id);
  console.log(`  → campaign_id: ${campaignId}`);
  return campaignId;
}

async function createRegularAdGroup(
  advertiserId: string, campaignId: string, pixelId: string,
  dailyBudget: number, adgroupName: string,
): Promise<string> {
  const excludedAudiences = EXCLUSION_AUDIENCE_MAP[advertiserId] || [];
  console.log(`  広告グループ作成 (手動ターゲティング, 日予算: ¥${dailyBudget}, 除外: ${excludedAudiences.length}件)`);

  const data = await tiktokApi('/v1.3/adgroup/create/', {
    advertiser_id: advertiserId,
    campaign_id: campaignId,
    adgroup_name: adgroupName,
    promotion_type: 'LEAD_GENERATION',
    promotion_target_type: 'EXTERNAL_WEBSITE',
    placement_type: 'PLACEMENT_TYPE_NORMAL',
    placements: ['PLACEMENT_TIKTOK'],
    location_ids: ['1861060'], // 日本
    age_groups: ['AGE_25_34', 'AGE_35_44', 'AGE_45_54'],
    gender: 'GENDER_UNLIMITED',
    languages: ['ja'],
    budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET',
    budget: dailyBudget,
    bid_type: 'BID_TYPE_NO_BID',
    billing_event: 'OCPM',
    optimization_goal: 'CONVERT',
    optimization_event: 'ON_WEB_REGISTER',
    deep_external_action: 'COMPLETE_PAYMENT',
    pixel_id: pixelId,
    schedule_type: 'SCHEDULE_FROM_NOW',
    schedule_start_time: getScheduleStartTime(),
    comment_disabled: true,
    video_download_disabled: true,
    excluded_audience_ids: excludedAudiences,
    pacing: 'PACING_MODE_SMOOTH',
  });
  const adgroupId = String(data.data.adgroup_id);
  console.log(`  �� adgroup_id: ${adgroupId}`);
  return adgroupId;
}

async function createRegularAd(
  advertiserId: string, adgroupId: string, adName: string,
  videoId: string, coverImageId: string | null,
  adText: string, landingPageUrl: string,
  identityId: string, identityBcId: string,
): Promise<string> {
  console.log(`  広告作成: ${adName}`);

  const creative: any = {
    ad_name: adName,
    identity_id: identityId,
    identity_type: 'BC_AUTH_TT',
    identity_authorized_bc_id: identityBcId,
    video_id: videoId,
    ad_text: adText,
    call_to_action: 'LEARN_MORE',
    landing_page_url: landingPageUrl,
    ad_format: 'SINGLE_VIDEO',
  };
  if (coverImageId) {
    creative.image_ids = [coverImageId];
  }

  const data = await tiktokApi('/v1.3/ad/create/', {
    advertiser_id: advertiserId,
    adgroup_id: adgroupId,
    creatives: [creative],
  });
  const adId = String(data.data?.ad_ids?.[0] || 'unknown');
  console.log(`  → ad_id: ${adId}`);
  return adId;
}

// ===== メイン =====
async function main() {
  const prisma = new PrismaClient();
  const results: any[] = [];

  // 各CRの動画ID（ソースアカウントから取得したもの）を保持
  const sourceVideoIds: Record<string, string> = {};
  // 各ターゲットアカウントにアップロード済みの動画IDを保持: `${crLabel}_${targetAdvId}` → videoId
  const uploadedVideoIds: Record<string, string> = {};

  try {
    const jstHour = getJstNow().getUTCHours();
    console.log('='.repeat(70));
    console.log('===== 5CR × AI1~AI3 再出稿バッチ（手動ターゲティング + ディープファネル）=====');
    console.log('='.repeat(70));
    console.log(`日付: ${getJstDateStr()}, JST ${jstHour}時`);
    console.log(`配信開始: ${isAfter15Jst() ? '翌日0時JST' : '即配信'} (${getScheduleStartTime()})`);
    console.log(`対象CR: ${SOURCE_CRS.map(c => c.label).join(', ')}`);
    console.log(`対象アカウント: AI_1, AI_2, AI_3`);
    console.log(`除外: TikTok用 + AIオプトイン + 債務整理類似(195006413)`);
    console.log(`ディープファネル: COMPLETE_PAYMENT\n`);

    // ===== STEP 1: ソース動画ID取得 =====
    console.log('─'.repeat(70));
    console.log('STEP 1: ソースCRの動画ID取得');
    console.log('─'.repeat(70));
    for (const cr of SOURCE_CRS) {
      console.log(`\n[${cr.label}] (${cr.sourceAdvertiserId} / ${cr.sourceAdId})`);
      try {
        const { videoId } = await getVideoIdFromAd(cr.sourceAdvertiserId, cr.sourceAdId);
        sourceVideoIds[cr.label] = videoId;
        console.log(`  video_id: ${videoId}`);
      } catch (e: any) {
        console.log(`  ⚠ 取得失敗: ${e.message}`);
        console.log(`  → このCRはスキップします`);
      }
    }

    const activeCRs = SOURCE_CRS.filter(cr => sourceVideoIds[cr.label]);
    console.log(`\n動画ID取得成功: ${activeCRs.length}/${SOURCE_CRS.length}件`);
    if (activeCRs.length === 0) throw new Error('動画IDが1つも取得できませんでした');

    // ===== STEP 2: 動画アップロード（クロスアカウント分）=====
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 2: 動画アップロード（クロスアカウント分）');
    console.log('─'.repeat(70));
    for (const cr of activeCRs) {
      for (const targetAdvId of TARGET_ACCOUNTS) {
        const key = `${cr.label}_${targetAdvId}`;
        console.log(`\n[${cr.label} → ${targetAdvId}]`);
        try {
          const newVideoId = await downloadAndUploadVideo(cr.sourceAdvertiserId, targetAdvId, sourceVideoIds[cr.label]);
          uploadedVideoIds[key] = newVideoId;

          // カバー画像
          const coverId = await getAndUploadCover(targetAdvId, newVideoId);
          if (coverId) videoCoverMap.set(`${newVideoId}_${targetAdvId}`, coverId);
        } catch (e: any) {
          console.log(`  ⚠ 動画処理失敗: ${e.message}`);
        }
      }
    }

    // ===== STEP 3: UTAGEログイン + 登録経路作成 =====
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 3: UTAGE登録経路作成');
    console.log('─'.repeat(70));
    await utageLogin();

    // LP1とLP4の最新CR番号を事前に取得
    const latestCrLP1 = await getLatestCrNumber(1);
    const latestCrLP4 = await getLatestCrNumber(4);
    let nextCrLP1 = latestCrLP1 + 1;
    let nextCrLP4 = latestCrLP4 + 1;

    // 各CR×アカウントの登録経路を作成
    const utageResults: Record<string, { registrationPath: string; destinationUrl: string; crStr: string }> = {};

    for (const cr of activeCRs) {
      for (const targetAdvId of TARGET_ACCOUNTS) {
        const key = `${cr.label}_${targetAdvId}`;
        if (!uploadedVideoIds[key]) continue;

        const lpNumber = cr.lpNumber;
        let crNumber: number;
        if (lpNumber === 4) {
          crNumber = nextCrLP4++;
        } else {
          crNumber = nextCrLP1++;
        }

        try {
          const result = await createRegistrationPath(lpNumber, crNumber);
          utageResults[key] = { ...result, crStr: String(crNumber).padStart(5, '0') };
        } catch (e: any) {
          console.log(`  ⚠ UTAGE経路作成失敗 [${key}]: ${e.message}`);
        }
      }
    }

    // ===== STEP 4: 広告作成（15個の1-1-1構成）=====
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 4: 広告作成（手動ターゲティング × ディープファネル）');
    console.log('─'.repeat(70));

    for (const cr of activeCRs) {
      for (const targetAdvId of TARGET_ACCOUNTS) {
        const key = `${cr.label}_${targetAdvId}`;
        const videoId = uploadedVideoIds[key];
        const utage = utageResults[key];
        if (!videoId || !utage) {
          console.log(`\n⚠ スキップ: ${key} (動画orUTAGE未準備)`);
          continue;
        }

        const adv = await prisma.advertiser.findUnique({
          where: { tiktokAdvertiserId: targetAdvId },
          select: { pixelId: true, identityId: true, identityAuthorizedBcId: true, name: true },
        });
        if (!adv?.pixelId || !adv.identityId) {
          console.log(`\n⚠ スキップ: ${targetAdvId} (アカウント設定不足)`);
          continue;
        }

        const adName = `${getJstDateStr()}/${cr.creator}/${cr.crName}/LP${cr.lpNumber}-CR${utage.crStr}`;
        const landingPageUrl = `${utage.destinationUrl}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;
        const coverId = videoCoverMap.get(`${videoId}_${targetAdvId}`) || null;

        console.log(`\n--- [${cr.label} → ${adv.name}] ---`);
        try {
          const campaignId = await createRegularCampaign(targetAdvId, adName);
          const adgroupId = await createRegularAdGroup(
            targetAdvId, campaignId, adv.pixelId, 3000,
            `${getJstDateStr()} 手動 25-54 DF`,
          );
          const adId = await createRegularAd(
            targetAdvId, adgroupId, adName,
            videoId, coverId, AI_AD_TEXT, landingPageUrl,
            adv.identityId, adv.identityAuthorizedBcId || '',
          );

          results.push({
            type: '個別再出稿',
            cr: cr.label,
            target: adv.name,
            adName,
            crStr: utage.crStr,
            registrationPath: utage.registrationPath,
            campaignId,
            adgroupId,
            adId,
          });
          console.log(`  ✓ 完了`);
        } catch (e: any) {
          console.log(`  ✗ エラー: ${e.message?.substring(0, 300)}`);
          results.push({
            type: '個別再出稿',
            cr: cr.label,
            target: adv.name,
            adName,
            error: e.message?.substring(0, 200),
          });
        }
      }
    }

    // ===== STEP 5: 5動画まとめ広告（AI1、1キャンペーン1広告グループ5広告、LP1）=====
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 5: 5動画まとめ広告（AI_1、手動ターゲティング、LP1）');
    console.log('─'.repeat(70));

    const ai1AdvId = '7468288053866561553';
    const ai1Adv = await prisma.advertiser.findUnique({
      where: { tiktokAdvertiserId: ai1AdvId },
      select: { pixelId: true, identityId: true, identityAuthorizedBcId: true, name: true },
    });
    if (!ai1Adv?.pixelId || !ai1Adv.identityId) throw new Error('AI_1アカウント設定不足');

    // まとめ用UTAGE登録経路（5動画分、全てLP1）
    const multiAdUtageResults: { crLabel: string; registrationPath: string; destinationUrl: string; crStr: string }[] = [];
    for (const cr of activeCRs) {
      const crNumber = nextCrLP1++;
      const result = await createRegistrationPath(1, crNumber);
      multiAdUtageResults.push({
        crLabel: cr.label,
        ...result,
        crStr: String(crNumber).padStart(5, '0'),
      });
    }

    // キャンペーン（1つ）
    const multiCampaignName = `${getJstDateStr()}/5CRまとめ/手動DF/LP1`;
    const multiCampaignId = await createRegularCampaign(ai1AdvId, multiCampaignName);

    // 広告グループ（1つ）
    const multiAdgroupId = await createRegularAdGroup(
      ai1AdvId, multiCampaignId, ai1Adv.pixelId, 3000,
      `${getJstDateStr()} 5CRまとめ 手動 25-54 DF`,
    );

    // 広告（5つ、各CRの動画1つずつ）
    for (let i = 0; i < activeCRs.length; i++) {
      const cr = activeCRs[i];
      const videoId = uploadedVideoIds[`${cr.label}_${ai1AdvId}`];
      const utage = multiAdUtageResults[i];
      if (!videoId || !utage) {
        console.log(`  ⚠ スキップ（まとめ）: ${cr.label}`);
        continue;
      }

      const adName = `${getJstDateStr()}/${cr.creator}/${cr.crName}/LP1-CR${utage.crStr}`;
      const landingPageUrl = `${utage.destinationUrl}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;
      const coverId = videoCoverMap.get(`${videoId}_${ai1AdvId}`) || null;

      try {
        const adId = await createRegularAd(
          ai1AdvId, multiAdgroupId, adName,
          videoId, coverId, AI_AD_TEXT, landingPageUrl,
          ai1Adv.identityId, ai1Adv.identityAuthorizedBcId || '',
        );
        results.push({
          type: '5CRまとめ',
          cr: cr.label,
          target: 'AI_1',
          adName,
          crStr: utage.crStr,
          registrationPath: utage.registrationPath,
          campaignId: multiCampaignId,
          adgroupId: multiAdgroupId,
          adId,
        });
        console.log(`  ✓ [${cr.label}] ${adId}`);
      } catch (e: any) {
        console.log(`  ✗ [${cr.label}] エラー: ${e.message?.substring(0, 200)}`);
      }
    }

    // ===== サマリー =====
    console.log('\n\n' + '='.repeat(70));
    console.log('===== 結果サマリー =====');
    console.log('='.repeat(70));

    const successes = results.filter(r => r.adId && !r.error);
    const failures = results.filter(r => r.error);

    console.log(`\n成功: ${successes.length}件, 失��: ${failures.length}件\n`);

    for (const r of successes) {
      console.log(`[${r.type}] ${r.cr} → ${r.target}`);
      console.log(`  広告名: ${r.adName}`);
      console.log(`  CR番号: CR${r.crStr}`);
      console.log(`  広告ID: ${r.adId}`);
      console.log(`  UTAGE: ${r.registrationPath}`);
      console.log('');
    }

    if (failures.length > 0) {
      console.log('\n--- 失敗 ---');
      for (const r of failures) {
        console.log(`[${r.type}] ${r.cr} → ${r.target}: ${r.error}`);
      }
    }

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('\n===== 致命的エラー =====');
  console.error(err);
  process.exit(1);
});
