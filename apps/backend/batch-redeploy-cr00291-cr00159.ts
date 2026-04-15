/**
 * CR00291 + CR00159 バッチ再出稿 → スキルプラス1, スキルプラス2, スキルプラス3
 *
 * - CR00291: 1本（AI副業の嘘セミナー_AI×睡眠動画）
 * - CR00159: 6本（除外5本反映済み）
 * - LP2, Smart+配信
 * - SP1: 同一アカウント（動画再利用）、SP2/SP3: 横展開（動画DL&アップロード）
 *
 * 使い方:
 *   npx tsx apps/backend/batch-redeploy-cr00291-cr00159.ts
 */

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const UTAGE_BASE_URL = 'https://school.addness.co.jp';
const UTAGE_LOGIN_URL = 'https://school.addness.co.jp/operator/GYbKT7Y9d0eR/login';
const UTAGE_EMAIL = process.env.UTAGE_EMAIL || 'chiba.nobuteru@team.addness.co.jp';
const UTAGE_PASSWORD = process.env.UTAGE_PASSWORD || 'bC4F6mkV';

const FUNNEL_CONFIG = { funnelId: '3lS3x3dXa6kc', groupId: 'sOiiROJBAVIu', stepId: 'doc7hffUAVTv' };
const LP_NUMBER = 2;
const DAILY_BUDGET = 5000;
const AD_TEXT = 'スキルで独立するなら学んでおきたい本質のスキル活用術特商法（https://skill.addness.co.jp/tokushoho）';
const SOURCE_ADV = '7474920444831875080';

const TARGET_ACCOUNTS = [
  '7474920444831875080', // SP1
  '7592868952431362066', // SP2
  '7616545514662051858', // SP3
];

// 再出稿するCR定義
const CRS = [
  {
    label: 'CR00291',
    creator: '石黒研太',
    crName: 'AI副業の嘘セミナー',
    videos: [
      { name: 'AI副業の嘘セミナー_AI×睡眠動画', videoId: 'v10033g50000d5ms5e7og65pd3hoh9s0' },
    ],
  },
  {
    label: 'CR00159',
    creator: '清水絢吾',
    crName: 'はいそこまで(セミナー)',
    videos: [
      { name: '台本３-tiktok Music_Refresh', videoId: 'v10033g50000d4a0cknog65n6u4ng0g0' },
      { name: '＃納品_まちがっている_セミナー_強化なし', videoId: 'v10033g50000d488gfnog65itedcejlg' },
      { name: 'TT_11UGCごとこうさん', videoId: 'v10033g50000d47flanog65r1osl9ofg' },
      { name: '【免責文あり】セミナーダイジェスト', videoId: 'v10033g50000d447k27og65g2f75d2m0' },
      { name: 'TT⑥権威-実績', videoId: 'v10033g50000d47flafog65oh5v42v0g' },
      { name: '＃納品_箕輪さん冒頭⑤', videoId: 'v10033g50000d488gfvog65s7qu281mg' },
    ],
  },
];

// ===== ユーティリティ =====
let sessionCookies = '';
const videoCoverMap = new Map<string, string>();
const ctaCache = new Map<string, string>();

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

function getJstNow(): Date { return new Date(Date.now() + 9 * 60 * 60 * 1000); }
function isAfter15Jst(): boolean { return getJstNow().getUTCHours() >= 15; }
function getDeliveryDate(): Date { const jst = getJstNow(); if (isAfter15Jst()) jst.setUTCDate(jst.getUTCDate() + 1); return jst; }
function getJstDateStr(): string {
  const d = getDeliveryDate();
  return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}
function getScheduleStartTime(): string {
  if (isAfter15Jst()) {
    const d = getDeliveryDate(); d.setUTCDate(d.getUTCDate() - 1);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} 15:00:00`;
  }
  const t = new Date(Date.now() + 5 * 60 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}:${String(t.getUTCSeconds()).padStart(2, '0')}`;
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
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`TikTok API エラー: ${data.message} (code: ${data.code})`);
  return data;
}

// ===== 動画DL&アップロード =====
async function downloadAndUploadVideos(targetAdvId: string, videos: { name: string; videoId: string }[]): Promise<Record<string, string>> {
  console.log(`  動画 ${videos.length}本をDL → ${targetAdvId} にアップロード...`);
  const videoInfoData = await tiktokGet('/v1.3/file/video/ad/info/', {
    advertiser_id: SOURCE_ADV, video_ids: JSON.stringify(videos.map(v => v.videoId)),
  });
  const videoInfos = videoInfoData.data?.list || [];
  const FormData = require('form-data');
  const axios = require('axios');
  const mapping: Record<string, string> = {};

  for (let i = 0; i < videos.length; i++) {
    const { name, videoId } = videos[i];
    const info = videoInfos.find((v: any) => v.video_id === videoId);
    const downloadUrl = info?.preview_url || info?.video_url;
    if (!downloadUrl) { console.log(`   ⚠ ${videoId} DL URL取得不可（スキップ）`); continue; }

    console.log(`   [${i + 1}/${videos.length}] ${name}`);
    const videoResp = await fetch(downloadUrl);
    const buffer = Buffer.from(await videoResp.arrayBuffer());
    console.log(`     ${(buffer.length / 1024 / 1024).toFixed(1)}MB DL完了`);

    const form = new FormData();
    form.append('advertiser_id', targetAdvId);
    form.append('upload_type', 'UPLOAD_BY_FILE');
    form.append('video_signature', crypto.createHash('md5').update(buffer).digest('hex'));
    form.append('video_file', buffer, { filename: `redeploy_${videoId}_${Date.now()}.mp4`, contentType: 'video/mp4' });

    const uploadResp = await axios.post(`${TIKTOK_API_BASE}/v1.3/file/video/ad/upload/`, form, {
      headers: { 'Access-Token': ACCESS_TOKEN, ...form.getHeaders() }, timeout: 300000, maxContentLength: Infinity, maxBodyLength: Infinity,
    });
    if (uploadResp.data.code !== 0) throw new Error(`動画アップロード失敗: ${uploadResp.data.message}`);
    const respData = uploadResp.data.data;
    const newVideoId = Array.isArray(respData) ? respData[0]?.video_id : (respData.video_id || respData.id);
    if (!newVideoId) throw new Error(`動画ID取得不可`);
    mapping[videoId] = newVideoId;
    console.log(`     → ${newVideoId}`);

    // カバー画像
    const coverUrl = await waitForVideoReady(targetAdvId, newVideoId);
    if (coverUrl) {
      const coverImageId = await uploadCoverImage(targetAdvId, coverUrl, newVideoId);
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
      const data = await tiktokGet('/v1.3/file/video/ad/info/', { advertiser_id: advertiserId, video_ids: JSON.stringify([videoId]) });
      const video = data.data?.list?.[0];
      if (video?.video_cover_url) return video.video_cover_url;
    } catch { /* retry */ }
  }
  console.log(`     ⚠ サムネイル取得タイムアウト`);
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
      headers: { 'Access-Token': ACCESS_TOKEN, ...form.getHeaders() }, timeout: 30000,
    });
    if (uploadResp.data.code !== 0) return null;
    return Array.isArray(uploadResp.data.data) ? uploadResp.data.data[0]?.image_id : uploadResp.data.data.image_id;
  } catch { return null; }
}

async function prepareCoverImages(advertiserId: string, videoIds: string[]): Promise<void> {
  console.log(`  カバー画像 ${videoIds.length}本分を取得...`);
  for (const videoId of videoIds) {
    try {
      const data = await tiktokGet('/v1.3/file/video/ad/info/', { advertiser_id: advertiserId, video_ids: JSON.stringify([videoId]) });
      const video = data.data?.list?.[0];
      if (video?.video_cover_url) {
        const coverImageId = await uploadCoverImage(advertiserId, video.video_cover_url, videoId);
        if (coverImageId) videoCoverMap.set(videoId, coverImageId);
      }
    } catch { /* skip */ }
  }
  console.log(`  カバー画像: ${videoCoverMap.size}/${videoIds.length} 取得完了`);
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
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': sessionCookies, 'Referer': UTAGE_LOGIN_URL },
    body: formBody.toString(), redirect: 'manual',
  });
  sessionCookies = mergeCookies(sessionCookies, loginResp.headers);
  const location = loginResp.headers.get('location') || '';
  if (loginResp.status === 302 && !location.includes('/login')) {
    const redirectUrl = location.startsWith('http') ? location : `${UTAGE_BASE_URL}${location}`;
    const redirectResp = await fetch(redirectUrl, { headers: { 'Cookie': sessionCookies }, redirect: 'manual' });
    sessionCookies = mergeCookies(sessionCookies, redirectResp.headers);
    console.log('  ログイン成功');
  } else { throw new Error('UTAGEログイン失敗'); }
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
  console.log(`  最新CR番号を取得中... (スキルプラス LP${LP_NUMBER})`);
  const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${FUNNEL_CONFIG.funnelId}/tracking`);
  const pattern = new RegExp(`TikTok広告-スキルプラス-LP${LP_NUMBER}-CR(0\\d{4})`, 'g');
  const matches = [...html.matchAll(pattern)];
  if (matches.length === 0) return 0;
  const crNumbers = matches.map(m => parseInt(m[1])).sort((a, b) => b - a);
  console.log(`  最新: CR${String(crNumbers[0]).padStart(5, '0')}`);
  return crNumbers[0];
}

async function createRegistrationPath(crNumber: number): Promise<{ registrationPath: string; destinationUrl: string }> {
  const crStr = String(crNumber).padStart(5, '0');
  const registrationPath = `TikTok広告-スキルプラス-LP${LP_NUMBER}-CR${crStr}`;
  console.log(`  UTAGE経路作成: ${registrationPath}`);
  const createFormUrl = `${UTAGE_BASE_URL}/funnel/${FUNNEL_CONFIG.funnelId}/tracking/create`;
  const formHtml = await authedGet(createFormUrl);
  let formToken: string;
  try { formToken = extractCsrfToken(formHtml); } catch { formToken = ''; }
  let formAction = '';
  const formRegex = /<form[^>]*action=["']([^"']*)["'][^>]*>([\s\S]*?)<\/form>/gi;
  let formMatch: RegExpExecArray | null;
  while ((formMatch = formRegex.exec(formHtml)) !== null) {
    if (formMatch[2].includes('name="name"') || formMatch[2].includes('name="group_id"')) { formAction = formMatch[1]; break; }
  }
  if (!formAction) formAction = `${UTAGE_BASE_URL}/funnel/${FUNNEL_CONFIG.funnelId}/tracking`;
  const postUrl = formAction.startsWith('http') ? formAction : `${UTAGE_BASE_URL}${formAction}`;
  const body = new URLSearchParams({ _token: formToken, name: registrationPath, group_id: FUNNEL_CONFIG.groupId, step_id: FUNNEL_CONFIG.stepId });
  const postResp = await fetch(postUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': sessionCookies, 'Referer': createFormUrl },
    body: body.toString(), redirect: 'manual',
  });
  sessionCookies = mergeCookies(sessionCookies, postResp.headers);
  let listingHtml = '';
  if (postResp.status === 302) {
    const loc = postResp.headers.get('location') || '';
    listingHtml = await authedGet(loc.startsWith('http') ? loc : `${UTAGE_BASE_URL}${loc}`);
  } else { listingHtml = await postResp.text(); }
  let foundIdx = listingHtml.indexOf(registrationPath);
  let foundHtml = foundIdx !== -1 ? listingHtml : '';
  if (foundIdx === -1) {
    const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${FUNNEL_CONFIG.funnelId}/tracking`);
    foundIdx = html.indexOf(registrationPath); if (foundIdx !== -1) foundHtml = html;
  }
  if (foundIdx === -1) {
    for (let page = 2; page <= 10; page++) {
      const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${FUNNEL_CONFIG.funnelId}/tracking?page=${page}`);
      foundIdx = html.indexOf(registrationPath); if (foundIdx !== -1) { foundHtml = html; break; }
      if (!html.includes(`page=${page + 1}`)) break;
    }
  }
  if (foundIdx === -1) throw new Error(`登録経路が見つかりません: ${registrationPath}`);
  const context = foundHtml.substring(Math.max(0, foundIdx - 500), foundIdx + 3000);
  const urlPattern = new RegExp(`https://school\\.addness\\.co\\.jp/p/${FUNNEL_CONFIG.stepId}\\?ftid=[a-zA-Z0-9]+`);
  const urlMatch = context.match(urlPattern);
  if (!urlMatch) throw new Error(`遷移先URL取得失敗: ${registrationPath}`);
  console.log(`  → ${urlMatch[0]}`);
  return { registrationPath, destinationUrl: urlMatch[0] };
}

// ===== Smart+作成 =====
async function getCtaId(advertiserId: string): Promise<string> {
  if (ctaCache.has(advertiserId)) return ctaCache.get(advertiserId)!;
  const data = await tiktokGet('/v1.3/smart_plus/ad/get/', { advertiser_id: advertiserId, page_size: '5' });
  const ctaId = data.data?.list?.[0]?.ad_configuration?.call_to_action_id || '';
  ctaCache.set(advertiserId, ctaId);
  return ctaId;
}

async function createSmartPlusCampaign(advId: string, name: string): Promise<string> {
  const data = await tiktokApi('/v1.3/smart_plus/campaign/create/', {
    advertiser_id: advId, campaign_name: name, objective_type: 'LEAD_GENERATION',
    budget_mode: 'BUDGET_MODE_INFINITE', budget_optimize_on: false,
    request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
  });
  return String(data.data.campaign_id);
}

async function createSmartPlusAdGroup(advId: string, campaignId: string, pixelId: string): Promise<string> {
  const data = await tiktokApi('/v1.3/smart_plus/adgroup/create/', {
    advertiser_id: advId, campaign_id: campaignId, adgroup_name: `${getJstDateStr()} 25-54`,
    budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET', budget: DAILY_BUDGET,
    billing_event: 'OCPM', bid_type: 'BID_TYPE_NO_BID',
    optimization_goal: 'CONVERT', optimization_event: 'ON_WEB_REGISTER',
    pixel_id: pixelId, promotion_type: 'LEAD_GENERATION', promotion_target_type: 'EXTERNAL_WEBSITE',
    placement_type: 'PLACEMENT_TYPE_NORMAL', placements: ['PLACEMENT_TIKTOK'],
    comment_disabled: true, schedule_type: 'SCHEDULE_FROM_NOW', schedule_start_time: getScheduleStartTime(),
    targeting_spec: { location_ids: ['1861060'], age_groups: ['AGE_25_34', 'AGE_35_44', 'AGE_45_54'] },
    request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
  });
  return String(data.data.adgroup_id);
}

async function createSmartPlusAd(
  advId: string, adgroupId: string, adName: string, videoIds: string[],
  identityId: string, identityBcId: string, landingPageUrl: string,
): Promise<string> {
  const creative_list = videoIds.map(vid => {
    const ci: any = {
      ad_format: 'SINGLE_VIDEO', video_info: { video_id: vid },
      identity_id: identityId, identity_type: 'BC_AUTH_TT', identity_authorized_bc_id: identityBcId,
    };
    const cover = videoCoverMap.get(vid);
    if (cover) ci.image_info = [{ web_uri: cover }];
    return { creative_info: ci };
  });
  const data = await tiktokApi('/v1.3/smart_plus/ad/create/', {
    advertiser_id: advId, adgroup_id: adgroupId, ad_name: adName, creative_list,
    ad_text_list: [{ ad_text: AD_TEXT }],
    landing_page_url_list: [{ landing_page_url: landingPageUrl }],
    ad_configuration: { call_to_action_id: await getCtaId(advId) },
    operation_status: 'ENABLE',
    request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
  });
  return String(data.data?.ad_id || data.data?.smart_plus_ad_id);
}

// ===== メイン =====
async function main() {
  console.log('===== CR00291 + CR00159 バッチ再出稿（SP1/SP2/SP3） =====');
  console.log(`JST ${getJstNow().getUTCHours()}時 → ${isAfter15Jst() ? '翌日0時配信' : '本日即配信'}`);
  console.log(`配信開始: ${getScheduleStartTime()}`);
  console.log(`広告名日付: ${getJstDateStr()}\n`);

  const prisma = new PrismaClient();
  const results: { cr: string; account: string; adId: string; adName: string }[] = [];

  try {
    await utageLogin();
    let latestCr = await getLatestCrNumber();

    for (const cr of CRS) {
      console.log(`\n${'#'.repeat(60)}`);
      console.log(`# ${cr.label} (${cr.videos.length}本)`);
      console.log('#'.repeat(60));

      for (const targetAdvId of TARGET_ACCOUNTS) {
        const isSameAccount = targetAdvId === SOURCE_ADV;
        const label = targetAdvId === '7474920444831875080' ? 'SP1' : targetAdvId === '7592868952431362066' ? 'SP2' : 'SP3';

        console.log(`\n--- ${cr.label} → ${label} (${isSameAccount ? '再出稿' : '横展開'}) ---`);

        const advertiser = await prisma.advertiser.findUnique({
          where: { tiktokAdvertiserId: targetAdvId },
          select: { pixelId: true, identityId: true, identityAuthorizedBcId: true, name: true },
        });
        if (!advertiser?.pixelId || !advertiser?.identityId) {
          console.log(`  ⚠ ${label}: pixelId/identityId未設定 → スキップ`);
          continue;
        }
        console.log(`  アカウント: ${advertiser.name}`);

        // 動画準備
        videoCoverMap.clear();
        let finalVideoIds: string[];
        if (isSameAccount) {
          finalVideoIds = cr.videos.map(v => v.videoId);
          await prepareCoverImages(targetAdvId, finalVideoIds);
        } else {
          const mapping = await downloadAndUploadVideos(targetAdvId, cr.videos);
          finalVideoIds = cr.videos.map(v => mapping[v.videoId]).filter(Boolean);
          console.log(`  動画アップロード: ${finalVideoIds.length}/${cr.videos.length}本成功`);
        }

        // UTAGE
        const newCrNumber = latestCr + 1;
        latestCr = newCrNumber;
        const { destinationUrl } = await createRegistrationPath(newCrNumber);

        const crStr = String(newCrNumber).padStart(5, '0');
        const adName = `${getJstDateStr()}/${cr.creator}/${cr.crName}/LP${LP_NUMBER}-CR${crStr}`;
        const landingPageUrl = `${destinationUrl}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;
        console.log(`  広告名: ${adName}`);

        const campaignId = await createSmartPlusCampaign(targetAdvId, adName);
        console.log(`  キャンペーンID: ${campaignId}`);
        const adgroupId = await createSmartPlusAdGroup(targetAdvId, campaignId, advertiser.pixelId);
        console.log(`  広告グループID: ${adgroupId}`);
        const adId = await createSmartPlusAd(targetAdvId, adgroupId, adName, finalVideoIds, advertiser.identityId, advertiser.identityAuthorizedBcId || '', landingPageUrl);
        console.log(`  広告ID: ${adId}`);

        results.push({ cr: cr.label, account: label, adId, adName });
      }
    }

    console.log('\n\n===== 完了サマリ =====');
    for (const r of results) {
      console.log(`  ${r.cr} → ${r.account}: ${r.adName} | ad_id: ${r.adId}`);
    }
    console.log(`\n日予算: ¥${DAILY_BUDGET}/アカウント`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => { console.error('\n===== エラー ====='); console.error(err); process.exit(1); });
