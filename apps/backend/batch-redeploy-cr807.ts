/**
 * CR00807 追加出稿（動画IDを直接指定）
 * - AI_1, AI_2, AI_3 に個別再出稿（3件）
 * - AI_1のまとめ広告グループ(1861681791506497)に追加（1件）
 * - 全て通常API（手動ターゲティング）、ディープファネル最適化あり
 */

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

const UTAGE_BASE_URL = 'https://school.addness.co.jp';
const UTAGE_LOGIN_URL = 'https://school.addness.co.jp/operator/GYbKT7Y9d0eR/login';
const UTAGE_EMAIL = process.env.UTAGE_EMAIL || 'chiba.nobuteru@team.addness.co.jp';
const UTAGE_PASSWORD = process.env.UTAGE_PASSWORD || 'bC4F6mkV';

const TIKTOK_FUNNEL_MAP = {
  1: { funnelId: 'a09j9jop95LF', groupId: 'EFnsGw3gAdba', stepId: 'r2RHcL0PdGIY' },
};

const AI_AD_TEXT = 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）';

const EXCLUSION_AUDIENCE_MAP: Record<string, string[]> = {
  '7468288053866561553': ['194977234', '194405484', '195006413'],
  '7523128243466551303': ['194977234', '194405486', '195006413'],
  '7543540647266074641': ['194977234', '194405488', '195006413'],
};

// CR00807情報
const SOURCE_ADV_ID = '7468288053866561553'; // AI_1
const SOURCE_VIDEO_ID = 'v10033g50000d5rnnavog65tl3n69bs0'; // material_id=7599678317318897671
const CR_CREATOR = '石黒研太';
const CR_NAME = 'AI副業の嘘2（AI訴求）毎日投稿';

// まとめ広告グループID（前回作成済み）
const MULTI_ADGROUP_ID = '1861681791506497';
const MULTI_CAMPAIGN_ID = '1861681760917585';

const TARGET_ACCOUNTS = [
  '7468288053866561553', // AI_1
  '7523128243466551303', // AI_2
  '7543540647266074641', // AI_3
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

function getJstNow(): Date { return new Date(Date.now() + 9 * 60 * 60 * 1000); }
function isAfter15Jst(): boolean { return getJstNow().getUTCHours() >= 15; }
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

// ===== 動画 =====
async function downloadAndUploadVideo(targetAdvId: string): Promise<string> {
  if (targetAdvId === SOURCE_ADV_ID) {
    console.log('  同一アカウント → 動画再利用');
    return SOURCE_VIDEO_ID;
  }

  console.log('  動画ダウンロード＆アップロード...');
  const videoInfoData = await tiktokGet('/v1.3/file/video/ad/info/', {
    advertiser_id: SOURCE_ADV_ID,
    video_ids: JSON.stringify([SOURCE_VIDEO_ID]),
  });
  const info = videoInfoData.data?.list?.[0];
  const downloadUrl = info?.preview_url || info?.video_url;
  if (!downloadUrl) throw new Error(`動画URLが取得できません: ${SOURCE_VIDEO_ID}`);

  const videoResp = await fetch(downloadUrl);
  const buffer = Buffer.from(await videoResp.arrayBuffer());
  console.log(`  ${(buffer.length / 1024 / 1024).toFixed(1)}MB ダウンロード完了`);

  const FormData = require('form-data');
  const axios = require('axios');
  const form = new FormData();
  form.append('advertiser_id', targetAdvId);
  form.append('upload_type', 'UPLOAD_BY_FILE');
  form.append('video_signature', crypto.createHash('md5').update(buffer).digest('hex'));
  form.append('video_file', buffer, { filename: `cr807_${Date.now()}.mp4`, contentType: 'video/mp4' });

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

async function getAndUploadCover(advertiserId: string, videoId: string): Promise<string | null> {
  for (let i = 0; i < 10; i++) {
    try {
      const data = await tiktokGet('/v1.3/file/video/ad/info/', {
        advertiser_id: advertiserId,
        video_ids: JSON.stringify([videoId]),
      });
      const video = data.data?.list?.[0];
      if (video?.video_cover_url) {
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
    body: formBody.toString(), redirect: 'manual',
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
  const config = TIKTOK_FUNNEL_MAP[1];
  console.log('  最新CR番号取得中 (AI LP1)...');
  const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${config.funnelId}/tracking`);
  const pattern = /TikTok広告-AI-LP1-CR(0\d{4})/g;
  const matches = [...html.matchAll(pattern)];
  if (matches.length === 0) return 0;
  const crNumbers = matches.map(m => parseInt(m[1])).sort((a, b) => b - a);
  console.log(`  最新CR: CR${String(crNumbers[0]).padStart(5, '0')}`);
  return crNumbers[0];
}

async function createRegistrationPath(crNumber: number): Promise<{ registrationPath: string; destinationUrl: string }> {
  const config = TIKTOK_FUNNEL_MAP[1];
  const crStr = String(crNumber).padStart(5, '0');
  const registrationPath = `TikTok広告-AI-LP1-CR${crStr}`;
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
    body: body.toString(), redirect: 'manual',
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

// ===== メイン =====
async function main() {
  const prisma = new PrismaClient();
  const results: any[] = [];

  try {
    console.log('='.repeat(70));
    console.log('===== CR00807 追加出稿（手動ターゲティング + ディープファネル）=====');
    console.log('='.repeat(70));
    console.log(`動画ID: ${SOURCE_VIDEO_ID}`);
    console.log(`日付: ${getJstDateStr()}, 配信: ${getScheduleStartTime()}\n`);

    // STEP 1: 動画アップロード
    console.log('─'.repeat(70));
    console.log('STEP 1: 動画アップロード');
    console.log('─'.repeat(70));
    const videoIds: Record<string, string> = {};
    const coverIds: Record<string, string | null> = {};
    for (const targetAdvId of TARGET_ACCOUNTS) {
      console.log(`\n[→ ${targetAdvId}]`);
      videoIds[targetAdvId] = await downloadAndUploadVideo(targetAdvId);
      coverIds[targetAdvId] = await getAndUploadCover(targetAdvId, videoIds[targetAdvId]);
    }

    // STEP 2: UTAGE登録経路（個別3件 + まとめ1件 = 4件）
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 2: UTAGE登録経路作成');
    console.log('─'.repeat(70));
    await utageLogin();
    const latestCr = await getLatestCrNumber();
    let nextCr = latestCr + 1;

    const utageResults: { target: string; registrationPath: string; destinationUrl: string; crStr: string }[] = [];
    for (const targetAdvId of TARGET_ACCOUNTS) {
      const crNumber = nextCr++;
      const result = await createRegistrationPath(crNumber);
      utageResults.push({ target: targetAdvId, ...result, crStr: String(crNumber).padStart(5, '0') });
    }
    // まとめ用
    const multiCrNumber = nextCr++;
    const multiUtage = await createRegistrationPath(multiCrNumber);
    const multiCrStr = String(multiCrNumber).padStart(5, '0');

    // STEP 3: 個別広告3件
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 3: 個別広告作成（3件）');
    console.log('─'.repeat(70));

    for (let i = 0; i < TARGET_ACCOUNTS.length; i++) {
      const targetAdvId = TARGET_ACCOUNTS[i];
      const utage = utageResults[i];
      const videoId = videoIds[targetAdvId];
      const coverId = coverIds[targetAdvId];

      const adv = await prisma.advertiser.findUnique({
        where: { tiktokAdvertiserId: targetAdvId },
        select: { pixelId: true, identityId: true, identityAuthorizedBcId: true, name: true },
      });
      if (!adv?.pixelId || !adv.identityId) { console.log(`⚠ スキップ: ${targetAdvId}`); continue; }

      const adName = `${getJstDateStr()}/${CR_CREATOR}/${CR_NAME}/LP1-CR${utage.crStr}`;
      const landingPageUrl = `${utage.destinationUrl}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;
      const excludedAudiences = EXCLUSION_AUDIENCE_MAP[targetAdvId] || [];

      console.log(`\n--- [CR00807 → ${adv.name}] ---`);
      try {
        // キャンペーン
        const campData = await tiktokApi('/v1.3/campaign/create/', {
          advertiser_id: targetAdvId,
          campaign_name: adName,
          objective_type: 'LEAD_GENERATION',
          budget_mode: 'BUDGET_MODE_INFINITE',
        });
        const campaignId = String(campData.data.campaign_id);
        console.log(`  → campaign_id: ${campaignId}`);

        // 広告グループ
        const agData = await tiktokApi('/v1.3/adgroup/create/', {
          advertiser_id: targetAdvId,
          campaign_id: campaignId,
          adgroup_name: `${getJstDateStr()} 手動 25-54 DF`,
          promotion_type: 'LEAD_GENERATION',
          promotion_target_type: 'EXTERNAL_WEBSITE',
          placement_type: 'PLACEMENT_TYPE_NORMAL',
          placements: ['PLACEMENT_TIKTOK'],
          location_ids: ['1861060'],
          age_groups: ['AGE_25_34', 'AGE_35_44', 'AGE_45_54'],
          gender: 'GENDER_UNLIMITED',
          languages: ['ja'],
          budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET',
          budget: 3000,
          bid_type: 'BID_TYPE_NO_BID',
          billing_event: 'OCPM',
          optimization_goal: 'CONVERT',
          optimization_event: 'ON_WEB_REGISTER',
          deep_external_action: 'COMPLETE_PAYMENT',
          pixel_id: adv.pixelId,
          schedule_type: 'SCHEDULE_FROM_NOW',
          schedule_start_time: getScheduleStartTime(),
          comment_disabled: true,
          video_download_disabled: true,
          excluded_audience_ids: excludedAudiences,
          pacing: 'PACING_MODE_SMOOTH',
        });
        const adgroupId = String(agData.data.adgroup_id);
        console.log(`  → adgroup_id: ${adgroupId}`);

        // 広告
        const creative: any = {
          ad_name: adName,
          identity_id: adv.identityId,
          identity_type: 'BC_AUTH_TT',
          identity_authorized_bc_id: adv.identityAuthorizedBcId,
          video_id: videoId,
          ad_text: AI_AD_TEXT,
          call_to_action: 'LEARN_MORE',
          landing_page_url: landingPageUrl,
          ad_format: 'SINGLE_VIDEO',
        };
        if (coverId) creative.image_ids = [coverId];

        const adData = await tiktokApi('/v1.3/ad/create/', {
          advertiser_id: targetAdvId,
          adgroup_id: adgroupId,
          creatives: [creative],
        });
        const adId = String(adData.data?.ad_ids?.[0] || 'unknown');
        console.log(`  → ad_id: ${adId}`);

        results.push({ type: '個別再出稿', target: adv.name, adName, crStr: utage.crStr, registrationPath: utage.registrationPath, adId });
        console.log('  ✓ 完了');
      } catch (e: any) {
        console.log(`  ✗ エラー: ${e.message?.substring(0, 300)}`);
        results.push({ type: '個別再出稿', target: adv.name, error: e.message?.substring(0, 200) });
      }
    }

    // STEP 4: まとめ広告グループに追加
    console.log('\n' + '─'.repeat(70));
    console.log('STEP 4: まとめ広告グループに追加（AI_1）');
    console.log('─'.repeat(70));

    const ai1AdvId = '7468288053866561553';
    const ai1Adv = await prisma.advertiser.findUnique({
      where: { tiktokAdvertiserId: ai1AdvId },
      select: { pixelId: true, identityId: true, identityAuthorizedBcId: true, name: true },
    });

    if (ai1Adv?.identityId) {
      const videoId = videoIds[ai1AdvId];
      const coverId = coverIds[ai1AdvId];
      const adName = `${getJstDateStr()}/${CR_CREATOR}/${CR_NAME}/LP1-CR${multiCrStr}`;
      const landingPageUrl = `${multiUtage.destinationUrl}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;

      try {
        const creative: any = {
          ad_name: adName,
          identity_id: ai1Adv.identityId,
          identity_type: 'BC_AUTH_TT',
          identity_authorized_bc_id: ai1Adv.identityAuthorizedBcId,
          video_id: videoId,
          ad_text: AI_AD_TEXT,
          call_to_action: 'LEARN_MORE',
          landing_page_url: landingPageUrl,
          ad_format: 'SINGLE_VIDEO',
        };
        if (coverId) creative.image_ids = [coverId];

        const adData = await tiktokApi('/v1.3/ad/create/', {
          advertiser_id: ai1AdvId,
          adgroup_id: MULTI_ADGROUP_ID,
          creatives: [creative],
        });
        const adId = String(adData.data?.ad_ids?.[0] || 'unknown');
        console.log(`  → ad_id: ${adId}`);

        results.push({ type: '5CRまとめ', target: 'AI_1', adName, crStr: multiCrStr, registrationPath: multiUtage.registrationPath, adId });
        console.log('  ✓ 完了');
      } catch (e: any) {
        console.log(`  ✗ エラー: ${e.message?.substring(0, 300)}`);
      }
    }

    // サマリー
    console.log('\n\n' + '='.repeat(70));
    console.log('===== CR00807 結果サマリー =====');
    console.log('='.repeat(70));
    for (const r of results) {
      if (r.error) {
        console.log(`[${r.type}] ${r.target}: ✗ ${r.error}`);
      } else {
        console.log(`[${r.type}] ${r.target}`);
        console.log(`  広告名: ${r.adName}`);
        console.log(`  CR: CR${r.crStr} | 広告ID: ${r.adId}`);
        console.log(`  UTAGE: ${r.registrationPath}`);
      }
    }
    console.log(`\n成功: ${results.filter(r => !r.error).length}件`);

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => { console.error('\n===== エラー ====='); console.error(err); process.exit(1); });
