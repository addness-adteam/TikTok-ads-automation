/**
 * スキルプラス3アカウント × 複数動画1広告 Smart+出稿スクリプト
 *
 * 使い方:
 *   npx tsx apps/backend/deploy-sp-multi-video.ts
 *
 * 処理:
 *   1. SP1から動画ID一覧を元にvideo情報を取得
 *   2. SP2/SP3には動画をDL→再アップロード
 *   3. 各アカウントでUTAGE登録経路を作成
 *   4. Smart+キャンペーン→広告グループ→広告（複数動画1広告）を作成
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

const FUNNEL_CONFIG = { funnelId: '3lS3x3dXa6kc', groupId: 'sOiiROJBAVIu', stepId: 'doc7hffUAVTv' };
const APPEAL = 'スキルプラス';
const LP_NUMBER = 2;
const DAILY_BUDGET = 5000;
const AD_TEXT = 'スキルで独立するなら学んでおきたい本質のスキル活用術特商法（https://skill.addness.co.jp/tokushoho）';

// SP1をソースとする動画一覧（SP1上のvideo_id）- 重複除外済み50本
const SOURCE_ADVERTISER_ID = '7474920444831875080'; // SP1
const SOURCE_VIDEO_IDS = [
  // --- CR00389 CPAが安いCR（Smart+ 9本） ---
  'v10033g50000d53oaavog65ubhl50sdg',
  'v10033g50000d5pcpqfog65im07g3uhg',
  'v10033g50000d5m847fog65j19ous5ig',
  'v10033g50000d3oatbvog65o47fni300',
  'v10033g50000d5i9eqnog65gre3a7a10',
  'v10033g50000d4a7uo7og65lc7nq1t60',
  'v10033g50000d5uuc17og65rh1umbkag',
  'v10033g50000d5r2d07og65mjr9hrqug',
  'v10033g50000d3qq2ofog65vhp9ja2q0',
  // --- 個別CR ---
  'v10033g50000d5uutlfog65o2279nu30', // CR00407 後悔書く＿箱＿手書き風
  'v10033g50000d5ms5e7og65pd3hoh9s0', // CR00291 AI副業の嘘セミナー
  'v10033g50000d4a0cknog65n6u4ng0g0', // 台本３
  'v10033g50000d5i978fog65o0nku13j0', // CR00258 おーい会社員_良いサービス
  // --- 広告名2025-10-30 #1（17本、重複除外） ---
  'v10033g50000d4408vfog65qlrnp8cu0',
  'v10033g50000d42t977og65g2f5j52j0',
  'v10033g50000d41jflnog65hh7u38fkg',
  'v10033g50000d41jegfog65rsmg53vb0',
  'v10033g50000d41jdtnog65ksg5nggug',
  'v10033g50000d41jdb7og65tr2tdfhpg',
  'v10033g50000d3sgb0nog65komg77jd0',
  'v10033g50000d3qq617og65ivolehqgg',
  'v10033g50000d3q83afog65pi7bskqlg',
  'v10033g50000d4408vfog65ke17vvii0',
  'v10033g50000d4408vfog65tdj0bs7kg',
  'v10033g50000d4417r7og65g8isc7phg',
  'v10033g50000d44c6lfog65mh2mi3280',
  'v10033g50000d44hl5nog65nu13dvpo0',
  'v10033g50000d44nmlfog65qratfa620',
  'v10033g50000d44tbdvog65jq6qlbq90',
  'v10033g50000d4539tnog65kub70tgo0',
  // --- 広告名2025-10-30 #2（22本、重複除外） ---
  'v10033g50000d3pqv67og65kbm6kce40',
  'v10033g50000d3jjhd7og65kjmr77ht0',
  'v10033g50000d447k27og65g2f75d2m0',
  'v10033g50000d3pqv5nog65ob4jbvmv0',
  'v10033g50000d3jjho7og65tpkd1alq0',
  'v10033g50000d3qq2ofog65tfetphdeg',
  'v10033g50000d3pqv5nog65gcn9r8fb0',
  'v10033g50000d4889anog65rdkd85j90',
  'v10033g50000d3qq61fog65mr67vuq40',
  'v10033g50000d488gfvog65s7qu281mg',
  'v10033g50000d41unvnog65vo6v5u1u0',
  'v10033g50000d488gfnog65itedcejlg',
  'v10033g50000d488gfnog65ge10l1gd0',
  'v10033g50000d3pqv5nog65p0ctfu9u0',
  'v10033g50000d3pqv5nog65uu0heud60',
  'v10033g50000d3pqv5vog65lcmufjm70',
  'v10033g50000d488gfnog65qu8hc4feg',
  'v10033g50000d3pqv5nog65gkctctb90',
  'v10033g50000d48idavog65r60okcft0',
  'v10033g50000d48h9ffog65voa8gf4pg',
];

// 出稿先3アカウント
const TARGET_ACCOUNTS = [
  { advertiserId: '7474920444831875080', name: 'スキルプラス1', isSameAsSource: true },
  { advertiserId: '7592868952431362066', name: 'スキルプラス2', isSameAsSource: false },
  { advertiserId: '7616545514662051858', name: 'スキルプラス3', isSameAsSource: false },
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

function getJstScheduleTime(): string {
  if (isAfter15Jst()) {
    const d = getDeliveryDate();
    d.setUTCDate(d.getUTCDate() - 1);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} 15:00:00`;
  } else {
    const t = new Date(Date.now() + 5 * 60 * 1000);
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}:${String(t.getUTCSeconds()).padStart(2, '0')}`;
  }
}

// ===== TikTok API =====
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
  if (data.code !== 0) throw new Error(`TikTok API エラー: ${data.message} (code: ${data.code})`);
  return data;
}

// ===== 動画DL/アップロード =====
async function getVideoDownloadUrl(advertiserId: string, videoId: string): Promise<string> {
  const data = await tiktokGet('/v1.3/file/video/ad/info/', {
    advertiser_id: advertiserId,
    video_ids: JSON.stringify([videoId]),
  });
  const video = data.data?.list?.[0];
  const url = video?.preview_url || video?.video_url;
  if (!url) throw new Error(`動画URLが取得できません: ${videoId}`);
  return url;
}

/** URL経由で動画をアップロード（ディスク不要） */
async function uploadVideoByUrl(advertiserId: string, videoUrl: string, filename: string): Promise<string> {
  const data = await tiktokApi('/v1.3/file/video/ad/upload/', {
    advertiser_id: advertiserId,
    upload_type: 'UPLOAD_BY_URL',
    video_url: videoUrl,
    file_name: filename,
  });
  const result = data.data;
  const newVideoId = Array.isArray(result) ? result[0]?.video_id : result?.video_id;
  if (!newVideoId) throw new Error('動画アップロード: video_idが返されませんでした');
  return newVideoId;
}

async function waitForVideoReady(advertiserId: string, videoId: string): Promise<void> {
  for (let i = 0; i < 15; i++) {
    const data = await tiktokGet('/v1.3/file/video/ad/info/', {
      advertiser_id: advertiserId,
      video_ids: JSON.stringify([videoId]),
    });
    const video = data.data?.list?.[0];
    if (video?.displayable) return;
    const wait = Math.min(5000 * Math.pow(1.5, i), 15000);
    await new Promise(r => setTimeout(r, wait));
  }
  console.log(`   ⚠ 動画 ${videoId} の処理完了待ちタイムアウト（続行）`);
}

/** 動画のカバー画像URLを取得 */
async function getVideoCoverUrl(advertiserId: string, videoId: string): Promise<string | null> {
  for (let i = 0; i < 5; i++) {
    try {
      const data = await tiktokGet('/v1.3/file/video/ad/info/', {
        advertiser_id: advertiserId,
        video_ids: JSON.stringify([videoId]),
      });
      const video = data.data?.list?.[0];
      if (video?.video_cover_url) return video.video_cover_url;
    } catch {}
    await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}

/** カバー画像URLをアカウントにアップロードしてweb_uriを返す */
async function uploadCoverImageByUrl(advertiserId: string, imageUrl: string): Promise<string | null> {
  try {
    const data = await tiktokApi('/v1.3/file/image/ad/upload/', {
      advertiser_id: advertiserId,
      upload_type: 'UPLOAD_BY_URL',
      image_url: imageUrl,
    });
    return data.data?.web_uri || data.data?.image_id || null;
  } catch {
    return null;
  }
}

// ===== UTAGE =====
async function utageLogin(): Promise<void> {
  console.log('\nUTAGEログイン中...');
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
    console.log('ログイン成功\n');
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
  const pattern = new RegExp(`TikTok広告-${APPEAL}-LP${LP_NUMBER}-CR(0\\d{4})`, 'g');
  const matches = [...html.matchAll(pattern)];
  if (matches.length === 0) return 0;
  const crNumbers = matches.map(m => parseInt(m[1])).sort((a, b) => b - a);
  console.log(`最新CR番号: CR${String(crNumbers[0]).padStart(5, '0')} (${matches.length}件中)`);
  return crNumbers[0];
}

async function createRegistrationPath(crNumber: number): Promise<{ registrationPath: string; destinationUrl: string }> {
  const crStr = String(crNumber).padStart(5, '0');
  const registrationPath = `TikTok広告-${APPEAL}-LP${LP_NUMBER}-CR${crStr}`;
  console.log(`  UTAGE登録経路作成: ${registrationPath}`);

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

  console.log(`  → ${urlMatch[0]}`);
  return { registrationPath, destinationUrl: urlMatch[0] };
}

// ===== Smart+ 作成 =====
async function getCtaId(advertiserId: string): Promise<string> {
  const data = await tiktokGet('/v1.3/smart_plus/ad/get/', { advertiser_id: advertiserId, page_size: '5' });
  const ads = data.data?.list || [];
  return ads[0]?.ad_configuration?.call_to_action_id || '';
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

async function createSmartPlusAdGroup(advertiserId: string, campaignId: string, pixelId: string): Promise<string> {
  const ageGroups = ['AGE_25_34', 'AGE_35_44', 'AGE_45_54'];
  const data = await tiktokApi('/v1.3/smart_plus/adgroup/create/', {
    advertiser_id: advertiserId,
    campaign_id: campaignId,
    adgroup_name: `${getJstDateStr()} 25-34, 35-44, 45-54`,
    budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET',
    budget: DAILY_BUDGET,
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
    schedule_start_time: getJstScheduleTime(),
    targeting_spec: { location_ids: ['1861060'], age_groups: ageGroups },
    request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
  });
  const adgroupId = String(data.data.adgroup_id);

  // ターゲティング検証＆修正
  console.log('   ターゲティング検証中（5秒待機）...');
  await new Promise(r => setTimeout(r, 5000));
  try {
    const verifyResp = await tiktokGet('/v1.3/smart_plus/adgroup/get/', {
      advertiser_id: advertiserId,
      adgroup_ids: JSON.stringify([adgroupId]),
    });
    const actual = verifyResp.data?.list?.[0]?.targeting_spec;
    const actualAges = actual?.age_groups || [];
    const ageOk = ageGroups.every(g => actualAges.includes(g)) && actualAges.length === ageGroups.length;
    if (!ageOk) {
      console.log(`   ⚠ ターゲティング不一致 → 修正`);
      await tiktokApi('/v1.3/smart_plus/adgroup/update/', {
        advertiser_id: advertiserId,
        adgroup_id: adgroupId,
        targeting_spec: { location_ids: ['1861060'], age_groups: ageGroups },
      });
      console.log('   ✅ 修正完了');
      await new Promise(r => setTimeout(r, 3000));
    } else {
      console.log('   ✅ ターゲティングOK');
    }
  } catch (e: any) {
    console.log(`   ⚠ 検証失敗（続行）: ${e.message}`);
  }

  return adgroupId;
}

async function createSmartPlusMultiVideoAd(
  advertiserId: string,
  adgroupId: string,
  adName: string,
  videoIds: string[],
  coverWebUris: (string | null)[],
  landingPageUrl: string,
  identityId: string,
  identityBcId: string,
): Promise<string> {
  const ctaId = await getCtaId(advertiserId);
  console.log(`   CTA ID: ${ctaId}`);

  const creativeList = videoIds.map((videoId, idx) => {
    const creativeInfo: any = {
      ad_format: 'SINGLE_VIDEO',
      video_info: { video_id: videoId },
      identity_id: identityId,
      identity_type: 'BC_AUTH_TT',
      identity_authorized_bc_id: identityBcId,
    };
    if (coverWebUris[idx]) {
      creativeInfo.image_info = [{ web_uri: coverWebUris[idx] }];
    }
    return { creative_info: creativeInfo };
  });

  const data = await tiktokApi('/v1.3/smart_plus/ad/create/', {
    advertiser_id: advertiserId,
    adgroup_id: adgroupId,
    ad_name: adName,
    creative_list: creativeList,
    ad_text_list: [{ ad_text: AD_TEXT }],
    landing_page_url_list: [{ landing_page_url: landingPageUrl }],
    ad_configuration: { call_to_action_id: ctaId },
    operation_status: 'ENABLE',
    request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
  });
  return String(data.data?.ad_id || data.data?.smart_plus_ad_id);
}

// ===== メイン =====
async function main() {
  console.log('===== スキルプラス3アカウント × 複数動画Smart+出稿 =====');
  console.log(`ソースアカウント: SP1 (${SOURCE_ADVERTISER_ID})`);
  console.log(`動画数: ${SOURCE_VIDEO_IDS.length}本`);
  console.log(`日予算: ¥${DAILY_BUDGET}`);
  console.log(`LP: LP${LP_NUMBER}（スキルプラス導線）`);
  console.log(`配信開始: ${getJstScheduleTime()}`);
  console.log(`広告名日付: ${getJstDateStr()}`);
  console.log();

  const prisma = new PrismaClient();

  try {
    // 1. アカウント情報取得
    console.log('--- 1. アカウント情報取得 ---');
    const accounts: Array<{
      advertiserId: string;
      name: string;
      pixelId: string;
      identityId: string;
      bcId: string;
      isSameAsSource: boolean;
    }> = [];

    for (const target of TARGET_ACCOUNTS) {
      const adv = await prisma.advertiser.findUnique({
        where: { tiktokAdvertiserId: target.advertiserId },
        select: { pixelId: true, identityId: true, identityAuthorizedBcId: true, name: true },
      });
      if (!adv || !adv.pixelId || !adv.identityId || !adv.identityAuthorizedBcId) {
        throw new Error(`アカウント設定不足: ${target.name} (${target.advertiserId})`);
      }
      accounts.push({
        advertiserId: target.advertiserId,
        name: adv.name || target.name,
        pixelId: adv.pixelId,
        identityId: adv.identityId,
        bcId: adv.identityAuthorizedBcId,
        isSameAsSource: target.isSameAsSource,
      });
      console.log(`  ✅ ${adv.name}: pixel=${adv.pixelId}`);
    }

    // 2. SP2/SP3用に動画をDL→アップロード（1本ずつ処理してOOM防止）
    console.log('\n--- 2. 動画のDL＆アップロード ---');
    const videoIdMap: Record<string, string[]> = {};
    videoIdMap[SOURCE_ADVERTISER_ID] = [...SOURCE_VIDEO_IDS];

    const needsUpload = accounts.filter(a => !a.isSameAsSource);
    if (needsUpload.length > 0) {
      // 各ターゲットアカウントの動画ID配列を初期化
      for (const account of needsUpload) {
        videoIdMap[account.advertiserId] = [];
      }

      console.log(`  ${SOURCE_VIDEO_IDS.length}本 × ${needsUpload.length}アカウント = ${SOURCE_VIDEO_IDS.length * needsUpload.length}回アップロード`);
      console.log(`  ※1本ずつDL→アップロード→メモリ解放\n`);

      for (let i = 0; i < SOURCE_VIDEO_IDS.length; i++) {
        const videoId = SOURCE_VIDEO_IDS[i];
        console.log(`  [${i + 1}/${SOURCE_VIDEO_IDS.length}] ${videoId}`);

        // SP1から動画URLを取得
        const downloadUrl = await getVideoDownloadUrl(SOURCE_ADVERTISER_ID, videoId);

        // 各ターゲットアカウントにURL経由でアップロード（ディスク・メモリ不要）
        for (const account of needsUpload) {
          const newVideoId = await uploadVideoByUrl(account.advertiserId, downloadUrl, `video_${i + 1}.mp4`);
          console.log(`    → ${account.name}: ${newVideoId}`);
          videoIdMap[account.advertiserId].push(newVideoId);
        }
      }

      // 最後にアップロードした動画の処理完了を待つ（最後の数本だけ）
      console.log(`\n  動画処理完了待ち...`);
      for (const account of needsUpload) {
        const ids = videoIdMap[account.advertiserId];
        // 最後の5本だけ待つ（それ以前はアップロード中に処理完了しているはず）
        const lastIds = ids.slice(-5);
        for (const vid of lastIds) {
          await waitForVideoReady(account.advertiserId, vid);
        }
        console.log(`  ✅ ${account.name}のアップロード完了 (${ids.length}本)`);
      }
    }

    // 3. UTAGE登録経路作成（3アカウント分）
    console.log('\n--- 3. UTAGE登録経路作成 ---');
    await utageLogin();
    const latestCr = await getLatestCrNumber();

    const utageResults: Array<{ crNumber: number; registrationPath: string; destinationUrl: string }> = [];
    for (let i = 0; i < accounts.length; i++) {
      const crNumber = latestCr + 1 + i;
      const result = await createRegistrationPath(crNumber);
      utageResults.push({ crNumber, ...result });
    }

    // 4. カバー画像取得＆アップロード
    console.log('\n--- 4. カバー画像取得＆アップロード ---');
    const coverWebUriMap: Record<string, (string | null)[]> = {};

    // SP1のソース動画からカバーURL取得
    console.log('  ソース動画のカバーURL取得中...');
    const sourceCoverUrls: (string | null)[] = [];
    for (let i = 0; i < SOURCE_VIDEO_IDS.length; i++) {
      const coverUrl = await getVideoCoverUrl(SOURCE_ADVERTISER_ID, SOURCE_VIDEO_IDS[i]);
      sourceCoverUrls.push(coverUrl);
      if ((i + 1) % 10 === 0) console.log(`    ${i + 1}/${SOURCE_VIDEO_IDS.length}...`);
    }
    console.log(`  カバーURL取得完了: ${sourceCoverUrls.filter(u => u).length}/${SOURCE_VIDEO_IDS.length}本`);

    // 各アカウントにカバー画像をアップロード
    for (const account of accounts) {
      console.log(`\n  ${account.name}: カバー画像アップロード中...`);
      const covers: (string | null)[] = [];
      for (let i = 0; i < sourceCoverUrls.length; i++) {
        const coverUrl = sourceCoverUrls[i];
        if (coverUrl) {
          const webUri = await uploadCoverImageByUrl(account.advertiserId, coverUrl);
          covers.push(webUri);
        } else {
          covers.push(null);
        }
        if ((i + 1) % 10 === 0) console.log(`    ${i + 1}/${sourceCoverUrls.length}...`);
      }
      coverWebUriMap[account.advertiserId] = covers;
      console.log(`  ✅ ${covers.filter(c => c).length}/${covers.length}枚アップロード完了`);
    }

    // 5. 各アカウントでSmart+出稿
    console.log('\n--- 5. Smart+キャンペーン作成 ---');
    const results: Array<{
      accountName: string;
      adName: string;
      crNumber: string;
      campaignId: string;
      adgroupId: string;
      adId: string;
    }> = [];

    // SP1は既にキャンペーン(1861341763438801)とAdGroup(1861341763441857)が作成済み
    // → 環境変数で指定可能にし、デフォルトは新規作成
    const RESUME_SP1_CAMPAIGN = process.env.RESUME_SP1_CAMPAIGN || '';
    const RESUME_SP1_ADGROUP = process.env.RESUME_SP1_ADGROUP || '';

    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      const utage = utageResults[i];
      const vIds = videoIdMap[account.advertiserId];
      const covers = coverWebUriMap[account.advertiserId];
      const crStr = String(utage.crNumber).padStart(5, '0');
      const adName = `${getJstDateStr()}/ROAS300%勝ちCR集/スキルプラス/LP${LP_NUMBER}-CR${crStr}`;
      const landingPageUrl = `${utage.destinationUrl}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;

      console.log(`\n  ===== ${account.name} =====`);
      console.log(`  広告名: ${adName}`);
      console.log(`  動画数: ${vIds.length}本`);
      console.log(`  LP URL: ${landingPageUrl}`);

      let campaignId: string;
      let adgroupId: string;

      // SP1リジューム対応
      if (account.isSameAsSource && RESUME_SP1_CAMPAIGN && RESUME_SP1_ADGROUP) {
        campaignId = RESUME_SP1_CAMPAIGN;
        adgroupId = RESUME_SP1_ADGROUP;
        console.log(`  [リジューム] キャンペーンID: ${campaignId}, 広告グループID: ${adgroupId}`);
      } else {
        campaignId = await createSmartPlusCampaign(account.advertiserId, adName);
        console.log(`  キャンペーンID: ${campaignId}`);
        adgroupId = await createSmartPlusAdGroup(account.advertiserId, campaignId, account.pixelId);
        console.log(`  広告グループID: ${adgroupId}`);
      }

      const adId = await createSmartPlusMultiVideoAd(
        account.advertiserId, adgroupId, adName,
        vIds, covers, landingPageUrl, account.identityId, account.bcId,
      );
      console.log(`  広告ID: ${adId}`);

      results.push({
        accountName: account.name,
        adName,
        crNumber: `CR${crStr}`,
        campaignId,
        adgroupId,
        adId,
      });
    }

    // 5. 結果サマリー
    console.log('\n\n========================================');
    console.log('===== 出稿完了サマリー =====');
    console.log('========================================');
    for (const r of results) {
      console.log(`\n[${r.accountName}]`);
      console.log(`  広告名: ${r.adName}`);
      console.log(`  CR番号: ${r.crNumber}`);
      console.log(`  キャンペーンID: ${r.campaignId}`);
      console.log(`  広告グループID: ${r.adgroupId}`);
      console.log(`  広告ID: ${r.adId}`);
      console.log(`  日予算: ¥${DAILY_BUDGET}`);
      console.log(`  動画数: ${SOURCE_VIDEO_IDS.length}本`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('\n===== エラー =====');
  console.error(err);
  process.exit(1);
});
