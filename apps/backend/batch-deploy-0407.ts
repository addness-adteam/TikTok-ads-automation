/**
 * 2026-04-07 バッチデプロイスクリプト
 *
 * タスク1: CR00580（1時間後悔）をSP2, SP3に横展開（各1動画のSmart+）
 * タスク2: CR00585（セミまとめ）の18動画 + CR00580/CR00577/CR00574/CR00588/CR00591の動画を
 *          まとめたSmart+マルチ動画キャンペーンをSP1, SP2, SP3に作成
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

const SP1 = '7474920444831875080';
const SP2 = '7592868952431362066';
const SP3 = '7616545514662051858';

const FUNNEL_CONFIG = { funnelId: '3lS3x3dXa6kc', groupId: 'sOiiROJBAVIu', stepId: 'doc7hffUAVTv' };
const DEFAULT_BUDGET = 5000;
const AD_TEXT = 'スキルで独立するなら学んでおきたい本質のスキル活用術特商法（https://skill.addness.co.jp/tokushoho）';

// CR00585の既存18動画
const CR00585_VIDEOS = [
  'v10033g50000d3pqv67og65kbm6kce40',
  'v10033g50000d447k27og65g2f75d2m0',
  'v10033g50000d3q83afog65pi7bskqlg',
  'v10033g50000d3jjhd7og65kjmr77ht0',
  'v10033g50000d4539tnog65kub70tgo0',
  'v10033g50000d3jjho7og65tpkd1alq0',
  'v10033g50000d3pqv5nog65ob4jbvmv0',
  'v10033g50000d41jdb7og65tr2tdfhpg',
  'v10033g50000d3sgb0nog65komg77jd0',
  'v10033g50000d488gfvog65s7qu281mg',
  'v10033g50000d488gfnog65ge10l1gd0',
  'v10033g50000d4408vfog65qlrnp8cu0',
  'v10033g50000d488gfnog65itedcejlg',
  'v10033g50000d3pqv5nog65gcn9r8fb0',
  'v10033g50000d3qq61fog65mr67vuq40',
  'v10033g50000d3qq2ofog65tfetphdeg',
  'v10033g50000d3pqv5nog65gkctctb90',
  'v10033g50000d3pqv5nog65uu0heud60',
];

// 追加する各CRの動画
const ADDITIONAL_VIDEOS: Record<string, string> = {
  'CR00580': 'v10033g50000d79ovc7og65jjv55cd30',  // 石黒研太/1時間後悔
  'CR00577': 'v10033g50000d4b7amfog65rlj4klkk0',  // 清水絢吾/おい会社員/穏やか_3万小遣い
  'CR00574': 'v10033g50000d4489avog65qmii03img',  // 清水絢吾/おい会社員/デフォルトLPテスト
  'CR00588': 'v10033g50000d5ms5e7og65pd3hoh9s0',  // 石黒研太/AI副業の嘘セミナー
  'CR00591': 'v10033g50000d4a0cknog65n6u4ng0g0',  // 清水絢吾/はいそこまで(セミナー) ※CR00585と重複しないもの
};

// 全動画の統合リスト（重複除外）
const ALL_MULTI_VIDEOS = [...new Set([...CR00585_VIDEOS, ...Object.values(ADDITIONAL_VIDEOS)])];

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

// video_id → cover_image_id マッピング
const videoCoverMap = new Map<string, string>();

// ===== 動画ダウンロード＆アップロード =====
async function downloadAndUploadVideos(
  sourceAdvertiserId: string, targetAdvertiserId: string, videoIds: string[],
): Promise<Record<string, string>> {
  if (videoIds.length === 0) return {};
  if (sourceAdvertiserId === targetAdvertiserId) {
    // 同一アカウント → アップロード不要、そのままマッピング
    const mapping: Record<string, string> = {};
    for (const vid of videoIds) mapping[vid] = vid;
    return mapping;
  }

  console.log(`\n  動画 ${videoIds.length}本をダウンロード → ${targetAdvertiserId}にアップロード...`);

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
    if (!downloadUrl) {
      console.log(`   ⚠ 動画 ${videoId} のURLが取得できません → スキップ`);
      continue;
    }

    console.log(`   [${i + 1}/${videoIds.length}] ${videoId} ダウンロード中...`);
    const videoResp = await fetch(downloadUrl);
    const buffer = Buffer.from(await videoResp.arrayBuffer());
    console.log(`   ${(buffer.length / 1024 / 1024).toFixed(1)}MB`);

    const md5Hash = crypto.createHash('md5').update(buffer).digest('hex');
    const form = new FormData();
    form.append('advertiser_id', targetAdvertiserId);
    form.append('upload_type', 'UPLOAD_BY_FILE');
    form.append('video_signature', md5Hash);
    form.append('video_file', buffer, { filename: `deploy_${videoId}_${Date.now()}.mp4`, contentType: 'video/mp4' });

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
    console.log(`   → ${newVideoId}`);

    // カバー画像取得
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
      if (video?.video_cover_url) return video.video_cover_url;
    } catch { /* retry */ }
  }
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
    return imageId;
  } catch { return null; }
}

// ===== UTAGE =====
async function utageLogin(): Promise<void> {
  console.log('\n  UTAGEログイン中...');
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
  const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${FUNNEL_CONFIG.funnelId}/tracking`);
  const pattern = /TikTok広告-スキルプラス-LP2-CR(0\d{4})/g;
  const matches = [...html.matchAll(pattern)];
  if (matches.length === 0) return 0;
  const crNumbers = matches.map(m => parseInt(m[1])).sort((a, b) => b - a);
  console.log(`   最新CR番号: CR${String(crNumbers[0]).padStart(5, '0')} (${matches.length}件中)`);
  return crNumbers[0];
}

async function createRegistrationPath(crNumber: number): Promise<{ registrationPath: string; destinationUrl: string }> {
  const crStr = String(crNumber).padStart(5, '0');
  const registrationPath = `TikTok広告-スキルプラス-LP2-CR${crStr}`;
  console.log(`   UTAGE登録: ${registrationPath}`);

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

  const body = new URLSearchParams({
    _token: formToken, name: registrationPath,
    group_id: FUNNEL_CONFIG.groupId, step_id: FUNNEL_CONFIG.stepId,
  });
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
  if (foundIdx === -1) throw new Error(`登録経路が見つかりません: ${registrationPath}`);

  const context = foundHtml.substring(Math.max(0, foundIdx - 500), foundIdx + 3000);
  const urlPattern = new RegExp(`https://school\\.addness\\.co\\.jp/p/${FUNNEL_CONFIG.stepId}\\?ftid=[a-zA-Z0-9]+`);
  const urlMatch = context.match(urlPattern);
  if (!urlMatch) throw new Error(`遷移先URL取得失敗: ${registrationPath}`);

  console.log(`   → ${urlMatch[0]}`);
  return { registrationPath, destinationUrl: urlMatch[0] };
}

// ===== Smart+キャンペーン作成 =====
const ctaCache = new Map<string, string>();
async function getCtaId(advertiserId: string): Promise<string> {
  if (ctaCache.has(advertiserId)) return ctaCache.get(advertiserId)!;
  const data = await tiktokGet('/v1.3/smart_plus/ad/get/', { advertiser_id: advertiserId, page_size: '5' });
  const ads = data.data?.list || [];
  const ctaId = ads[0]?.ad_configuration?.call_to_action_id || '';
  ctaCache.set(advertiserId, ctaId);
  return ctaId;
}

async function createSmartPlusCampaign(advertiserId: string, campaignName: string): Promise<string> {
  const data = await tiktokApi('/v1.3/smart_plus/campaign/create/', {
    advertiser_id: advertiserId,
    campaign_name: campaignName,
    objective_type: 'LEAD_GENERATION',
    budget_mode: 'BUDGET_MODE_INFINITE',
    budget_optimize_on: false,
    request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
  });
  return String(data.data.campaign_id);
}

async function createSmartPlusAdGroup(advertiserId: string, campaignId: string, pixelId: string, budget: number): Promise<string> {
  const data = await tiktokApi('/v1.3/smart_plus/adgroup/create/', {
    advertiser_id: advertiserId,
    campaign_id: campaignId,
    adgroup_name: `${getJstDateStr()} 25-54`,
    budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET',
    budget,
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
    targeting_optimization_mode: 'MANUAL',
    targeting_spec: {
      location_ids: ['1861060'],
      age_groups: ['AGE_25_34', 'AGE_35_44', 'AGE_45_54'],
    },
    request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
  });
  return String(data.data.adgroup_id);
}

async function createSmartPlusAd(
  advertiserId: string, adgroupId: string, adName: string,
  videoIds: string[], identityId: string, identityBcId: string,
  landingPageUrl: string,
): Promise<string> {
  const creative_list: any[] = [];
  for (const videoId of videoIds) {
    const creativeInfo: any = {
      ad_format: 'SINGLE_VIDEO',
      video_info: { video_id: videoId },
      identity_id: identityId,
      identity_type: 'BC_AUTH_TT',
      identity_authorized_bc_id: identityBcId,
    };
    const coverImageId = videoCoverMap.get(videoId);
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
    ad_text_list: [{ ad_text: AD_TEXT }],
    landing_page_url_list: [{ landing_page_url: landingPageUrl }],
    ad_configuration: { call_to_action_id: await getCtaId(advertiserId) },
    operation_status: 'ENABLE',
    request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
  });
  return String(data.data?.ad_id || data.data?.smart_plus_ad_id);
}

// ===== SP1用: カバー画像を既存動画から取得 =====
async function getCoverImagesForExistingVideos(advertiserId: string, videoIds: string[]): Promise<void> {
  console.log(`\n  SP1既存動画のカバー画像取得中 (${videoIds.length}本)...`);
  // バッチで取得（APIは最大60個まで）
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    try {
      const data = await tiktokGet('/v1.3/file/video/ad/info/', {
        advertiser_id: advertiserId,
        video_ids: JSON.stringify(batch),
      });
      for (const video of (data.data?.list || [])) {
        if (video.video_cover_url && video.video_id) {
          // カバー画像をアップロード
          const imageId = await uploadCoverImage(advertiserId, video.video_cover_url, video.video_id);
          if (imageId) videoCoverMap.set(video.video_id, imageId);
        }
      }
    } catch (e: any) {
      console.log(`   ⚠ カバー画像バッチ取得エラー: ${e.message}`);
    }
  }
  console.log(`   カバー画像: ${videoCoverMap.size}件取得`);
}

// ===== メイン =====
async function main() {
  const prisma = new PrismaClient();
  const results: string[] = [];

  try {
    // アカウント情報取得
    const accounts: Record<string, any> = {};
    for (const advId of [SP1, SP2, SP3]) {
      const adv = await prisma.advertiser.findUnique({
        where: { tiktokAdvertiserId: advId },
        select: { pixelId: true, identityId: true, identityAuthorizedBcId: true, name: true },
      });
      if (!adv || !adv.pixelId || !adv.identityId) throw new Error(`アカウント未設定: ${advId}`);
      accounts[advId] = adv;
    }

    const jstHour = getJstNow().getUTCHours();
    console.log(`JST ${jstHour}時 | 配信開始: ${getScheduleStartTime()} | 広告名日付: ${getJstDateStr()}`);

    // UTAGE ログイン
    await utageLogin();
    let latestCr = await getLatestCrNumber();

    // ============================================
    // タスク1: CR00580横展開 → SP2, SP3
    // ============================================
    console.log('\n========================================');
    console.log('タスク1: CR00580（1時間後悔）横展開');
    console.log('========================================');

    const cr580VideoId = ADDITIONAL_VIDEOS['CR00580'];

    for (const targetAdvId of [SP2, SP3]) {
      const target = accounts[targetAdvId];
      console.log(`\n--- ${target.name} (${targetAdvId}) ---`);

      // 動画アップロード
      const videoMapping = await downloadAndUploadVideos(SP1, targetAdvId, [cr580VideoId]);
      const uploadedVideoId = videoMapping[cr580VideoId];
      if (!uploadedVideoId) throw new Error(`動画アップロード失敗: ${cr580VideoId}`);

      // UTAGE
      latestCr++;
      const { registrationPath, destinationUrl } = await createRegistrationPath(latestCr);
      const crStr = String(latestCr).padStart(5, '0');
      const adName = `${getJstDateStr()}/石黒研太/1時間後悔/LP2-CR${crStr}`;
      const landingPageUrl = `${destinationUrl}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;

      console.log(`   広告名: ${adName}`);

      // Smart+作成
      const campaignId = await createSmartPlusCampaign(targetAdvId, adName);
      console.log(`   キャンペーンID: ${campaignId}`);
      const adgroupId = await createSmartPlusAdGroup(targetAdvId, campaignId, target.pixelId, DEFAULT_BUDGET);
      console.log(`   広告グループID: ${adgroupId}`);
      const adId = await createSmartPlusAd(
        targetAdvId, adgroupId, adName,
        [uploadedVideoId], target.identityId, target.identityAuthorizedBcId || '',
        landingPageUrl,
      );
      console.log(`   広告ID: ${adId}`);

      results.push(`[横展開] ${adName} → ${target.name} | ad_id: ${adId} | CR${crStr}`);

      // 仮説検証登録
      try {
        await prisma.hypothesisTest.create({
          data: {
            channelType: 'SKILL_PLUS',
            hypothesis: `CR00580（1時間後悔）を${target.name}に横展開。元SP1での実績を基に検証`,
            status: 'RUNNING',
            adId, adName,
            account: target.name || targetAdvId,
          },
        });
      } catch (e: any) { console.log(`   ⚠ 仮説登録スキップ: ${e.message}`); }
    }

    // ============================================
    // タスク2: Smart+マルチ動画キャンペーン → SP1, SP2, SP3
    // ============================================
    console.log('\n========================================');
    console.log('タスク2: セミまとめ+追加動画 Smart+マルチ動画');
    console.log(`動画数: ${ALL_MULTI_VIDEOS.length}本 (既存${CR00585_VIDEOS.length} + 追加${Object.keys(ADDITIONAL_VIDEOS).length})`);
    console.log('========================================');

    // SP1用: 既存動画のカバー画像取得
    await getCoverImagesForExistingVideos(SP1, ALL_MULTI_VIDEOS);

    for (const targetAdvId of [SP1, SP2, SP3]) {
      const target = accounts[targetAdvId];
      console.log(`\n--- ${target.name} (${targetAdvId}) ---`);

      // 動画アップロード（SP1は不要）
      let targetVideoIds: string[];
      if (targetAdvId === SP1) {
        targetVideoIds = ALL_MULTI_VIDEOS;
      } else {
        const videoMapping = await downloadAndUploadVideos(SP1, targetAdvId, ALL_MULTI_VIDEOS);
        targetVideoIds = ALL_MULTI_VIDEOS.map(vid => videoMapping[vid]).filter(Boolean);
        console.log(`   アップロード完了: ${targetVideoIds.length}/${ALL_MULTI_VIDEOS.length}本`);
      }

      // UTAGE
      latestCr++;
      const { registrationPath, destinationUrl } = await createRegistrationPath(latestCr);
      const crStr = String(latestCr).padStart(5, '0');
      const adName = `${getJstDateStr()}/清水絢吾/セミまとめ+追加動画/LP2-CR${crStr}`;
      const landingPageUrl = `${destinationUrl}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;

      console.log(`   広告名: ${adName}`);
      console.log(`   動画数: ${targetVideoIds.length}本`);

      // Smart+作成
      const campaignId = await createSmartPlusCampaign(targetAdvId, adName);
      console.log(`   キャンペーンID: ${campaignId}`);
      const adgroupId = await createSmartPlusAdGroup(targetAdvId, campaignId, target.pixelId, DEFAULT_BUDGET);
      console.log(`   広告グループID: ${adgroupId}`);
      const adId = await createSmartPlusAd(
        targetAdvId, adgroupId, adName,
        targetVideoIds, target.identityId, target.identityAuthorizedBcId || '',
        landingPageUrl,
      );
      console.log(`   広告ID: ${adId}`);

      results.push(`[マルチ動画] ${adName} → ${target.name} | ad_id: ${adId} | CR${crStr} | ${targetVideoIds.length}本`);

      // 仮説検証登録
      try {
        await prisma.hypothesisTest.create({
          data: {
            channelType: 'SKILL_PLUS',
            hypothesis: `セミまとめ(CR00585)に追加動画5本を加えた${targetVideoIds.length}本のSmart+マルチ動画キャンペーン。${target.name}で検証`,
            status: 'RUNNING',
            adId, adName,
            account: target.name || targetAdvId,
          },
        });
      } catch (e: any) { console.log(`   ⚠ 仮説登録スキップ: ${e.message}`); }
    }

    // ===== 完了サマリー =====
    console.log('\n========================================');
    console.log('全タスク完了');
    console.log('========================================');
    for (const r of results) console.log(`  ${r}`);

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('\n===== エラー =====');
  console.error(err);
  process.exit(1);
});
