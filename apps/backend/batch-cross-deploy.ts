/**
 * バッチ横展開スクリプト
 * 通常広告の複数動画を1つのSmart+広告にまとめて横展開する
 *
 * 今回の横展開:
 *   CR454 (8/10 AI CR454 平日夜＋休日ブースト) → AI_1, AI_2, AI_3
 *   CR178 (12/18 AI CR178 スマ 当たり×10) → AI_1, AI_2, AI_3
 *
 * 使い方:
 *   npx tsx apps/backend/batch-cross-deploy.ts
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
    2: { funnelId: 'a09j9jop95LF', groupId: 'bvnhWMTjQAPU', stepId: 'EnFeDysozIui' },
    3: { funnelId: 'a09j9jop95LF', groupId: 'EZL6dqvMuop6', stepId: 'A65xiRBl9HCD' },
    4: { funnelId: 'a09j9jop95LF', groupId: 'hEwR9BcvprDu', stepId: 'T8RHcXJVzGtY' },
    5: { funnelId: 'a09j9jop95LF', groupId: 'ND7cXzKmeiqG', stepId: 'EIQBI7HAVxgd' },
    6: { funnelId: 'a09j9jop95LF', groupId: 'FNFK0iB3rIzl', stepId: 'U8Ba9qy5m0us' },
  },
};

const EXCLUSION_AUDIENCE_MAP: Record<string, string> = {
  '7468288053866561553': '194405484', // AI_1
  '7523128243466551303': '194405486', // AI_2
  '7543540647266074641': '194405488', // AI_3
};
const AI_OPTIN_EXCLUSION_AUDIENCE_ID = '194977234';

const AI_AD_TEXT = 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）';

// ===== 横展開対象 =====
const SOURCE_ADVERTISER_ID = '7247073333517238273'; // SNS_1

const DEPLOY_JOBS = [
  {
    label: 'CR454 平日夜＋休日ブースト',
    videoIds: [
      'v10033g50000d0pvs1nog65jrgv4f080', // これ全部辞めましたAI
      'v10033g50000d0pua0vog65o79o5jcvg', // 頭の良さ（AI）
      'v10033g50000d0lvt7fog65s79otnvs0', // パクるやつ多すぎ（AI）
      'v10033g50000d0assm7og65vhivn40rg', // 一過性のノウハウ
      'v10033g50000d0nvsgnog65u8va5gtl0', // 二極化（副業会社員）
      'v10033g50000d0nvqt7og65ko36vn7rg', // 二極化(フリーランス)
    ],
    crLabel: 'CR454_横展開',
    targets: ['7468288053866561553', '7523128243466551303', '7543540647266074641'], // AI_1, AI_2, AI_3
  },
  {
    label: 'CR178 当たり×10',
    videoIds: [
      'v10033g50000cspk57vog65jrv4i7pl0', // プロンプトパターン①
      'v10033g50000cr5b69fog65p7dvnjc30', // AIはいそこまで台本2
      'v10033g50000cs7kqrfog65gev6147ag', // プロンプト_パターン①
      'v10033g50000csdm657og65q9bi1b300', // Xpost_煽り②
      'v10033g50000ct29qfvog65rimamjt7g', // Google（免責文、LP変更）
      'v10033g50000ct9vfs7og65h4ahkqt9g', // ④入社1ヶ月目の
    ],
    crLabel: 'CR178_横展開',
    targets: ['7468288053866561553', '7523128243466551303', '7543540647266074641'], // AI_1, AI_2, AI_3
  },
];

// ===== ユーティリティ =====
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
  const m1 = html.match(/<input[^>]+name=["']_token["'][^>]+value=["']([^"']+)["']/);
  if (m1) return m1[1];
  const m2 = html.match(/value=["']([^"']+)["'][^>]+name=["']_token["']/);
  if (m2) return m2[1];
  const m3 = html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/);
  if (m3) return m3[1];
  throw new Error('CSRFトークンが見つかりません');
}

function getJstDateStr(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

function getScheduleStartTime(): string {
  const t = new Date(Date.now() + 5 * 60 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}:${String(t.getUTCSeconds()).padStart(2, '0')}`;
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

// ===== 動画ダウンロード＆アップロード =====
const videoCoverMap = new Map<string, string>();

async function downloadAndUploadVideos(
  sourceAdvertiserId: string, targetAdvertiserId: string, videoIds: string[],
): Promise<Record<string, string>> {
  if (videoIds.length === 0) return {};
  console.log(`  動画 ${videoIds.length}本をダウンロード → アップロード...`);

  const videoInfoData = await tiktokGet('/v1.3/file/video/ad/info/', {
    advertiser_id: sourceAdvertiserId,
    video_ids: JSON.stringify(videoIds),
  });
  const videoInfos = videoInfoData.data?.list || [];

  const FormData = require('form-data');
  const axios = require('axios');
  const mapping: Record<string, string> = {};

  for (let i = 0; i < videoIds.length; i++) {
    const videoId = videoIds[i];
    const info = videoInfos.find((v: any) => v.video_id === videoId);
    const downloadUrl = info?.preview_url || info?.video_url;
    if (!downloadUrl) throw new Error(`動画 ${videoId} のダウンロードURLが取得できません`);

    console.log(`   [${i + 1}/${videoIds.length}] ${videoId} ダウンロード中...`);
    const videoResp = await fetch(downloadUrl);
    const buffer = Buffer.from(await videoResp.arrayBuffer());
    console.log(`   ${(buffer.length / 1024 / 1024).toFixed(1)}MB`);

    const md5Hash = crypto.createHash('md5').update(buffer).digest('hex');
    const form = new FormData();
    form.append('advertiser_id', targetAdvertiserId);
    form.append('upload_type', 'UPLOAD_BY_FILE');
    form.append('video_signature', md5Hash);
    form.append('video_file', buffer, { filename: `cross_deploy_${videoId}_${Date.now()}.mp4`, contentType: 'video/mp4' });

    const uploadResp = await axios.post(`${TIKTOK_API_BASE}/v1.3/file/video/ad/upload/`, form, {
      headers: { 'Access-Token': ACCESS_TOKEN, ...form.getHeaders() },
      timeout: 300000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    if (uploadResp.data.code !== 0) throw new Error(`動画アップロード失敗: ${uploadResp.data.message}`);
    const respData = uploadResp.data.data;
    const newVideoId = Array.isArray(respData) ? respData[0]?.video_id : (respData.video_id || respData.id);
    if (!newVideoId) throw new Error(`video_id取得失敗: ${JSON.stringify(respData).substring(0, 200)}`);
    mapping[videoId] = newVideoId;
    console.log(`   アップロード完了 → ${newVideoId}`);

    // カバー画像取得＆アップロード
    const coverUrl = await waitForVideoReady(targetAdvertiserId, newVideoId);
    if (coverUrl) {
      const coverImageId = await uploadCoverImage(targetAdvertiserId, coverUrl, newVideoId);
      if (coverImageId) videoCoverMap.set(newVideoId, coverImageId);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return mapping;
}

async function waitForVideoReady(advertiserId: string, videoId: string): Promise<string | null> {
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const data = await tiktokGet('/v1.3/file/video/ad/info/', {
        advertiser_id: advertiserId,
        video_ids: JSON.stringify([videoId]),
      });
      const video = data.data?.list?.[0];
      if (video?.video_cover_url) {
        console.log(`   サムネイル取得OK`);
        return video.video_cover_url;
      }
    } catch { /* retry */ }
  }
  console.log(`   ⚠ サムネイル待ちタイムアウト（続行）`);
  return null;
}

async function uploadCoverImage(advertiserId: string, coverUrl: string, videoId: string): Promise<string | null> {
  try {
    const resp = await fetch(coverUrl);
    if (!resp.ok) return null;
    const buffer = Buffer.from(await resp.arrayBuffer());
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
    if (uploadResp.data.code !== 0) { console.log(`   ⚠ カバー画像失敗: ${uploadResp.data.message}`); return null; }
    const imageId = Array.isArray(uploadResp.data.data) ? uploadResp.data.data[0]?.image_id : uploadResp.data.data.image_id;
    console.log(`   カバー画像 → ${imageId}`);
    return imageId;
  } catch (e: any) { console.log(`   ⚠ カバー画像エラー: ${e.message}`); return null; }
}

// ===== CTA ID取得 =====
const ctaCache = new Map<string, string>();
async function getCtaId(advertiserId: string): Promise<string> {
  if (ctaCache.has(advertiserId)) return ctaCache.get(advertiserId)!;
  const data = await tiktokGet('/v1.3/smart_plus/ad/get/', { advertiser_id: advertiserId, page_size: '5' });
  const ads = data.data?.list || [];
  const ctaId = ads[0]?.ad_configuration?.call_to_action_id || '';
  console.log(`   CTA ID: ${ctaId}`);
  ctaCache.set(advertiserId, ctaId);
  return ctaId;
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

async function getLatestCrNumber(lpNumber: number): Promise<number> {
  const config = TIKTOK_FUNNEL_MAP['AI']?.[lpNumber];
  if (!config) throw new Error(`未対応LP: AI LP${lpNumber}`);
  console.log(`  最新CR番号取得中... (AI LP${lpNumber})`);
  const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${config.funnelId}/tracking`);
  const pattern = new RegExp(`TikTok広告-AI-LP${lpNumber}-CR(0\\d{4})`, 'g');
  const matches = [...html.matchAll(pattern)];
  if (matches.length === 0) { console.log('   既存なし、CR00001から'); return 0; }
  const crNumbers = matches.map(m => parseInt(m[1])).sort((a, b) => b - a);
  console.log(`   最新: CR${String(crNumbers[0]).padStart(5, '0')} (${matches.length}件)`);
  return crNumbers[0];
}

async function createRegistrationPath(lpNumber: number, crNumber: number): Promise<{ registrationPath: string; destinationUrl: string }> {
  const config = TIKTOK_FUNNEL_MAP['AI']![lpNumber]!;
  const crStr = String(crNumber).padStart(5, '0');
  const registrationPath = `TikTok広告-AI-LP${lpNumber}-CR${crStr}`;
  console.log(`  UTAGE登録経路: ${registrationPath}`);

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

  console.log(`   完了: ${urlMatch[0]}`);
  return { registrationPath, destinationUrl: urlMatch[0] };
}

// ===== Smart+広告作成 =====
async function createSmartPlusCampaign(advertiserId: string, campaignName: string, dailyBudget: number): Promise<string> {
  console.log(`  キャンペーン作成: ${campaignName}`);
  const data = await tiktokApi('/v1.3/smart_plus/campaign/create/', {
    advertiser_id: advertiserId,
    campaign_name: campaignName,
    objective_type: 'LEAD_GENERATION',
    budget_optimize_on: false,
    budget_mode: 'BUDGET_MODE_INFINITE',
    request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
  });
  const campaignId = String(data.data.campaign_id);
  console.log(`   → ${campaignId}`);
  return campaignId;
}

async function createSmartPlusAdGroup(
  advertiserId: string, campaignId: string, pixelId: string, dailyBudget: number,
): Promise<string> {
  console.log(`  広告グループ作成 (日予算: ¥${dailyBudget})`);

  const excludedAudiences: string[] = [];
  const exclusionId = EXCLUSION_AUDIENCE_MAP[advertiserId];
  if (exclusionId) excludedAudiences.push(exclusionId);
  excludedAudiences.push(AI_OPTIN_EXCLUSION_AUDIENCE_ID);

  const targetingSpec: any = {
    location_ids: ['1861060'],
    age_groups: ['AGE_25_34', 'AGE_35_44', 'AGE_45_54'],
  };
  if (excludedAudiences.length > 0) {
    targetingSpec.excluded_custom_audience_ids = excludedAudiences;
  }

  console.log(`   除外オーディエンス: ${excludedAudiences.join(', ')}`);

  const data = await tiktokApi('/v1.3/smart_plus/adgroup/create/', {
    advertiser_id: advertiserId,
    campaign_id: campaignId,
    adgroup_name: `${getJstDateStr()} 25-54`,
    budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET',
    budget: dailyBudget,
    billing_event: 'OCPM',
    bid_type: 'BID_TYPE_NO_BID',
    optimization_goal: 'CONVERT',
    optimization_event: 'ON_WEB_REGISTER',
    deep_external_action: 'COMPLETE_PAYMENT',
    pixel_id: pixelId,
    promotion_type: 'LEAD_GENERATION',
    promotion_target_type: 'EXTERNAL_WEBSITE',
    placement_type: 'PLACEMENT_TYPE_NORMAL',
    placements: ['PLACEMENT_TIKTOK'],
    comment_disabled: true,
    schedule_type: 'SCHEDULE_FROM_NOW',
    schedule_start_time: getScheduleStartTime(),
    targeting_spec: targetingSpec,
    request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
  });
  const adgroupId = String(data.data.adgroup_id);
  console.log(`   → ${adgroupId}`);
  return adgroupId;
}

async function createSmartPlusAd(
  advertiserId: string, adgroupId: string, adName: string,
  videoMapping: Record<string, string>, identityId: string, identityBcId: string,
  landingPageUrl: string,
): Promise<string> {
  console.log(`  広告作成: ${adName} (動画${Object.keys(videoMapping).length}本)`);

  const creative_list: any[] = [];
  for (const newVideoId of Object.values(videoMapping)) {
    const coverImageId = videoCoverMap.get(newVideoId);
    const creativeInfo: any = {
      ad_format: 'SINGLE_VIDEO',
      video_info: { video_id: newVideoId },
      identity_id: identityId,
      identity_type: 'BC_AUTH_TT',
      identity_authorized_bc_id: identityBcId,
    };
    if (coverImageId) {
      creativeInfo.image_info = [{ web_uri: coverImageId }];
    }
    creative_list.push({ creative_info: creativeInfo });
  }

  const data = await tiktokApi('/v1.3/smart_plus/ad/create/', {
    advertiser_id: advertiserId,
    adgroup_id: adgroupId,
    ad_name: adName,
    creative_list,
    ad_text_list: [{ ad_text: AI_AD_TEXT }],
    landing_page_url_list: [{ landing_page_url: landingPageUrl }],
    ad_configuration: {
      call_to_action_id: await getCtaId(advertiserId),
    },
    operation_status: 'ENABLE',
    request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
  });

  const adId = String(data.data?.ad_id || data.data?.smart_plus_ad_id);
  console.log(`   → ad_id: ${adId}`);
  return adId;
}

// ===== メイン =====
async function main() {
  const prisma = new PrismaClient();
  const results: any[] = [];

  try {
    console.log('===== バッチ横展開（通常広告 → Smart+） =====');
    console.log(`日付: ${getJstDateStr()}`);
    console.log(`appeal: AI, 配信面: TikTokのみ, 年齢: 25-54`);
    console.log(`日予算: ¥3,000\n`);

    // UTAGEログイン（1回だけ）
    await utageLogin();

    for (const job of DEPLOY_JOBS) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`【${job.label}】動画${job.videoIds.length}本 → ${job.targets.length}アカウント`);
      console.log('='.repeat(60));

      for (const targetAdvertiserId of job.targets) {
        // ターゲットアカウント情報
        const targetAdv = await prisma.advertiser.findUnique({
          where: { tiktokAdvertiserId: targetAdvertiserId },
          select: { pixelId: true, identityId: true, identityAuthorizedBcId: true, name: true },
        });
        if (!targetAdv?.pixelId || !targetAdv.identityId) {
          console.log(`\n⚠ スキップ: ${targetAdvertiserId} (pixelId/identityId未設定)`);
          continue;
        }

        console.log(`\n--- 展開先: ${targetAdv.name} (${targetAdvertiserId}) ---`);

        // 動画アップロード（ターゲットごとに別アップロード必要）
        videoCoverMap.clear();
        const videoMapping = await downloadAndUploadVideos(SOURCE_ADVERTISER_ID, targetAdvertiserId, job.videoIds);

        // UTAGE登録経路作成
        const lpNumber = 1;
        const latestCr = await getLatestCrNumber(lpNumber);
        const newCrNumber = latestCr + 1;
        const { registrationPath, destinationUrl } = await createRegistrationPath(lpNumber, newCrNumber);

        // 広告名生成
        const crStr = String(newCrNumber).padStart(5, '0');
        const adName = `${getJstDateStr()}/横展開/${job.crLabel}/LP${lpNumber}-CR${crStr}`;
        const landingPageUrl = `${destinationUrl}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;

        // Smart+作成
        const campaignId = await createSmartPlusCampaign(targetAdvertiserId, adName, 3000);
        const adgroupId = await createSmartPlusAdGroup(targetAdvertiserId, campaignId, targetAdv.pixelId, 3000);
        const adId = await createSmartPlusAd(
          targetAdvertiserId, adgroupId, adName,
          videoMapping, targetAdv.identityId, targetAdv.identityAuthorizedBcId || '',
          landingPageUrl,
        );

        results.push({
          label: job.label,
          target: targetAdv.name,
          adName,
          crNumber: crStr,
          registrationPath,
          campaignId,
          adgroupId,
          adId,
          videos: Object.keys(videoMapping).length,
        });

        // 仮説検証登録
        try {
          await prisma.hypothesisTest.create({
            data: {
              channelType: 'AI',
              hypothesis: `${job.label}を${targetAdv.name}にSmart+横展開。6動画混合で同等成績が出るか検証`,
              status: 'RUNNING',
              adId,
              adName,
              account: targetAdv.name || targetAdvertiserId,
            },
          });
        } catch (e: any) { console.log(`   ⚠ 仮説登録スキップ: ${e.message}`); }

        console.log(`   ✓ 完了: ${adName}`);
      }
    }

    // 結果サマリー
    console.log(`\n\n${'='.repeat(60)}`);
    console.log('===== 横展開結果サマリー =====');
    console.log('='.repeat(60));
    for (const r of results) {
      console.log(`\n[${r.label}] → ${r.target}`);
      console.log(`  広告名: ${r.adName}`);
      console.log(`  CR番号: CR${r.crNumber}`);
      console.log(`  UTAGE: ${r.registrationPath}`);
      console.log(`  広告ID: ${r.adId}`);
      console.log(`  動画数: ${r.videos}本`);
    }
    console.log(`\n合計: ${results.length}件の横展開完了`);

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('\n===== エラー =====');
  console.error(err);
  process.exit(1);
});
