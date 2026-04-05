/**
 * CR00568 再出稿バッチスクリプト
 * 250917/在中悠也/説明しようAI_冒頭1_林社長/LP1-CR00568 → AI_1, AI_2, AI_3
 *
 * - AI_1: 同一アカウント（動画再利用）
 * - AI_2, AI_3: 横展開（動画ダウンロード＆アップロード）
 * - 全てSmart+で出稿
 *
 * 使い方:
 *   npx tsx apps/backend/redeploy-cr568-batch.ts
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

const TIKTOK_FUNNEL_MAP = {
  'AI': {
    1: { funnelId: 'a09j9jop95LF', groupId: 'EFnsGw3gAdba', stepId: 'r2RHcL0PdGIY' },
  },
};

const EXCLUSION_AUDIENCE_MAP: Record<string, string[]> = {
  '7468288053866561553': ['194977234', '194405484'],  // AI_1
  '7523128243466551303': ['194977234', '194405486'],  // AI_2
  '7543540647266074641': ['194977234', '194405488'],  // AI_3
};

const AI_AD_TEXT = 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）';

// ===== ソース情報 =====
const SOURCE_ADVERTISER_ID = '7468288053866561553'; // AI_1
const SOURCE_VIDEO_ID = 'v10033g50000d34k1pnog65l9k1377d0';
const SOURCE_CR_LABEL = '説明しようAI_冒頭1_林社長';
const SOURCE_CREATOR = '在中悠也';

const TARGETS = [
  '7468288053866561553', // AI_1（同一アカウント）
  '7523128243466551303', // AI_2
  '7543540647266074641', // AI_3
];

// ===== ユーティリティ =====
let sessionCookies = '';
const videoCoverMap = new Map<string, string>();

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

// ===== 動画 =====
async function uploadVideoToTarget(targetAdvertiserId: string): Promise<string> {
  if (targetAdvertiserId === SOURCE_ADVERTISER_ID) {
    console.log('  同一アカウント → 動画再利用');
    // カバー画像だけ取得＆アップロード
    const coverUrl = await getVideoCoverUrl(targetAdvertiserId, SOURCE_VIDEO_ID);
    if (coverUrl) {
      const coverId = await uploadCoverImage(targetAdvertiserId, coverUrl, SOURCE_VIDEO_ID);
      if (coverId) videoCoverMap.set(SOURCE_VIDEO_ID, coverId);
    }
    return SOURCE_VIDEO_ID;
  }

  console.log('  動画ダウンロード＆アップロード...');
  const videoInfoData = await tiktokGet('/v1.3/file/video/ad/info/', {
    advertiser_id: SOURCE_ADVERTISER_ID,
    video_ids: JSON.stringify([SOURCE_VIDEO_ID]),
  });
  const info = videoInfoData.data?.list?.[0];
  const downloadUrl = info?.preview_url || info?.video_url;
  if (!downloadUrl) throw new Error('動画URLが取得できません');

  const videoResp = await fetch(downloadUrl);
  const buffer = Buffer.from(await videoResp.arrayBuffer());
  console.log(`  ${(buffer.length / 1024 / 1024).toFixed(1)}MB ダウンロード完了`);

  const FormData = require('form-data');
  const axios = require('axios');
  const md5Hash = crypto.createHash('md5').update(buffer).digest('hex');
  const form = new FormData();
  form.append('advertiser_id', targetAdvertiserId);
  form.append('upload_type', 'UPLOAD_BY_FILE');
  form.append('video_signature', md5Hash);
  form.append('video_file', buffer, { filename: `redeploy_cr568_${Date.now()}.mp4`, contentType: 'video/mp4' });

  const uploadResp = await axios.post(`${TIKTOK_API_BASE}/v1.3/file/video/ad/upload/`, form, {
    headers: { 'Access-Token': ACCESS_TOKEN, ...form.getHeaders() },
    timeout: 300000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  if (uploadResp.data.code !== 0) throw new Error(`動画アップロード失敗: ${uploadResp.data.message}`);
  const respData = uploadResp.data.data;
  const newVideoId = Array.isArray(respData) ? respData[0]?.video_id : (respData.video_id || respData.id);
  console.log(`  アップロード完了 → ${newVideoId}`);

  // カバー画像
  const coverUrl = await waitForVideoReady(targetAdvertiserId, newVideoId);
  if (coverUrl) {
    const coverId = await uploadCoverImage(targetAdvertiserId, coverUrl, newVideoId);
    if (coverId) videoCoverMap.set(newVideoId, coverId);
  }
  return newVideoId;
}

async function getVideoCoverUrl(advertiserId: string, videoId: string): Promise<string | null> {
  try {
    const data = await tiktokGet('/v1.3/file/video/ad/info/', {
      advertiser_id: advertiserId,
      video_ids: JSON.stringify([videoId]),
    });
    return data.data?.list?.[0]?.video_cover_url || null;
  } catch { return null; }
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
      if (video?.video_cover_url) { console.log('  サムネイル取得OK'); return video.video_cover_url; }
    } catch { /* retry */ }
  }
  console.log('  ⚠ サムネイル待ちタイムアウト');
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
    if (uploadResp.data.code !== 0) return null;
    const imageId = Array.isArray(uploadResp.data.data) ? uploadResp.data.data[0]?.image_id : uploadResp.data.data.image_id;
    console.log(`  カバー画像 → ${imageId}`);
    return imageId;
  } catch { return null; }
}

// ===== CTA =====
const ctaCache = new Map<string, string>();
async function getCtaId(advertiserId: string): Promise<string> {
  if (ctaCache.has(advertiserId)) return ctaCache.get(advertiserId)!;
  const data = await tiktokGet('/v1.3/smart_plus/ad/get/', { advertiser_id: advertiserId, page_size: '5' });
  const ads = data.data?.list || [];
  const ctaId = ads[0]?.ad_configuration?.call_to_action_id || '';
  console.log(`  CTA ID: ${ctaId}`);
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

async function getLatestCrNumber(): Promise<number> {
  const config = TIKTOK_FUNNEL_MAP['AI'][1];
  console.log('  最新CR番号取得中...');
  const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${config.funnelId}/tracking`);
  const pattern = /TikTok広告-AI-LP1-CR(0\d{4})/g;
  const matches = [...html.matchAll(pattern)];
  if (matches.length === 0) return 0;
  const crNumbers = matches.map(m => parseInt(m[1])).sort((a, b) => b - a);
  console.log(`  最新: CR${String(crNumbers[0]).padStart(5, '0')}`);
  return crNumbers[0];
}

async function createRegistrationPath(crNumber: number): Promise<{ registrationPath: string; destinationUrl: string }> {
  const config = TIKTOK_FUNNEL_MAP['AI'][1];
  const crStr = String(crNumber).padStart(5, '0');
  const registrationPath = `TikTok広告-AI-LP1-CR${crStr}`;
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

  console.log(`  完了: ${urlMatch[0]}`);
  return { registrationPath, destinationUrl: urlMatch[0] };
}

// ===== Smart+広告作成 =====
async function createSmartPlusCampaign(advertiserId: string, campaignName: string): Promise<string> {
  console.log(`  キャンペーン作成...`);
  const data = await tiktokApi('/v1.3/smart_plus/campaign/create/', {
    advertiser_id: advertiserId,
    campaign_name: campaignName,
    objective_type: 'LEAD_GENERATION',
    budget_optimize_on: false,
    budget_mode: 'BUDGET_MODE_INFINITE',
    request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
  });
  const campaignId = String(data.data.campaign_id);
  console.log(`  → ${campaignId}`);
  return campaignId;
}

async function createSmartPlusAdGroup(
  advertiserId: string, campaignId: string, pixelId: string,
): Promise<string> {
  console.log('  広告グループ作成 (日予算: ¥3,000)');

  const excludedAudiences = EXCLUSION_AUDIENCE_MAP[advertiserId] || [];
  const targetingSpec: any = {
    location_ids: ['1861060'],
    age_groups: ['AGE_25_34', 'AGE_35_44', 'AGE_45_54'],
  };
  if (excludedAudiences.length > 0) {
    targetingSpec.excluded_custom_audience_ids = excludedAudiences;
  }

  const data = await tiktokApi('/v1.3/smart_plus/adgroup/create/', {
    advertiser_id: advertiserId,
    campaign_id: campaignId,
    adgroup_name: `${getJstDateStr()} 25-54`,
    budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET',
    budget: 3000,
    billing_event: 'OCPM',
    bid_type: 'BID_TYPE_NO_BID',
    optimization_goal: 'CONVERT',
    optimization_event: 'ON_WEB_REGISTER',
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
  console.log(`  → ${adgroupId}`);
  return adgroupId;
}

async function createSmartPlusAd(
  advertiserId: string, adgroupId: string, adName: string,
  videoId: string, identityId: string, identityBcId: string,
  landingPageUrl: string,
): Promise<string> {
  console.log(`  広告作成: ${adName}`);

  const coverImageId = videoCoverMap.get(videoId);
  const creativeInfo: any = {
    ad_format: 'SINGLE_VIDEO',
    video_info: { video_id: videoId },
    identity_id: identityId,
    identity_type: 'BC_AUTH_TT',
    identity_authorized_bc_id: identityBcId,
  };
  if (coverImageId) {
    creativeInfo.image_info = [{ web_uri: coverImageId }];
  }

  const data = await tiktokApi('/v1.3/smart_plus/ad/create/', {
    advertiser_id: advertiserId,
    adgroup_id: adgroupId,
    ad_name: adName,
    creative_list: [{ creative_info: creativeInfo }],
    ad_text_list: [{ ad_text: AI_AD_TEXT }],
    landing_page_url_list: [{ landing_page_url: landingPageUrl }],
    ad_configuration: {
      call_to_action_id: await getCtaId(advertiserId),
    },
    operation_status: 'ENABLE',
    request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
  });

  const adId = String(data.data?.ad_id || data.data?.smart_plus_ad_id);
  console.log(`  → ad_id: ${adId}`);
  return adId;
}

// ===== メイン =====
async function main() {
  const prisma = new PrismaClient();
  const results: any[] = [];

  try {
    console.log('===== CR00568 再出稿 (AI_1, AI_2, AI_3) =====');
    console.log(`ソース: 250917/在中悠也/説明しようAI_冒頭1_林社長/LP1-CR00568`);
    console.log(`動画ID: ${SOURCE_VIDEO_ID}`);
    console.log(`日付: ${getJstDateStr()}, 日予算: ¥3,000\n`);

    await utageLogin();

    for (const targetAdvertiserId of TARGETS) {
      const targetAdv = await prisma.advertiser.findUnique({
        where: { tiktokAdvertiserId: targetAdvertiserId },
        select: { pixelId: true, identityId: true, identityAuthorizedBcId: true, name: true },
      });
      if (!targetAdv?.pixelId || !targetAdv.identityId) {
        console.log(`\n⚠ スキップ: ${targetAdvertiserId}`);
        continue;
      }

      console.log(`\n--- ${targetAdv.name} (${targetAdvertiserId}) ---`);

      // 動画
      videoCoverMap.clear();
      const videoId = await uploadVideoToTarget(targetAdvertiserId);

      // UTAGE登録経路
      const latestCr = await getLatestCrNumber();
      const newCrNumber = latestCr + 1;
      const { registrationPath, destinationUrl } = await createRegistrationPath(newCrNumber);

      // 広告名
      const crStr = String(newCrNumber).padStart(5, '0');
      const adName = `${getJstDateStr()}/${SOURCE_CREATOR}/${SOURCE_CR_LABEL}/LP1-CR${crStr}`;
      const landingPageUrl = `${destinationUrl}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;

      // Smart+作成
      const campaignId = await createSmartPlusCampaign(targetAdvertiserId, adName);
      const adgroupId = await createSmartPlusAdGroup(targetAdvertiserId, campaignId, targetAdv.pixelId);
      const adId = await createSmartPlusAd(
        targetAdvertiserId, adgroupId, adName,
        videoId, targetAdv.identityId, targetAdv.identityAuthorizedBcId || '',
        landingPageUrl,
      );

      results.push({
        target: targetAdv.name,
        adName,
        crNumber: crStr,
        registrationPath,
        campaignId,
        adgroupId,
        adId,
      });

      // 仮説検証登録
      try {
        await prisma.hypothesisTest.create({
          data: {
            channelType: 'AI',
            hypothesis: `CR00568(説明しようAI_冒頭1_林社長)を${targetAdv.name}に再出稿。同CRの再出稿で再現性検証`,
            status: 'RUNNING',
            adId,
            adName,
            account: targetAdv.name || targetAdvertiserId,
          },
        });
      } catch (e: any) { console.log(`  ⚠ 仮説登録スキップ: ${e.message}`); }

      console.log(`  ✓ 完了`);
    }

    // サマリー
    console.log(`\n\n${'='.repeat(60)}`);
    console.log('===== CR00568 再出稿結果 =====');
    console.log('='.repeat(60));
    for (const r of results) {
      console.log(`\n[${r.target}]`);
      console.log(`  広告名: ${r.adName}`);
      console.log(`  CR番号: CR${r.crNumber}`);
      console.log(`  UTAGE: ${r.registrationPath}`);
      console.log(`  広告ID: ${r.adId}`);
    }
    console.log(`\n合計: ${results.length}件の再出稿完了`);

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('\n===== エラー =====');
  console.error(err);
  process.exit(1);
});
