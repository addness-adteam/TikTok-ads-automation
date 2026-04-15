/**
 * CR00568（ROAS300%勝ちCR集）の50動画を6本ずつに分割してSP1にSmart+出稿
 * - ホリエモン冒頭③×ダイジェスト を除外 → 49本
 * - 7キャンペーン×6本 + 1キャンペーン×7本 = 8キャンペーン
 */

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

const UTAGE_BASE_URL = 'https://school.addness.co.jp';
const UTAGE_LOGIN_URL = 'https://school.addness.co.jp/operator/GYbKT7Y9d0eR/login';
const UTAGE_EMAIL = process.env.UTAGE_EMAIL || 'chiba.nobuteru@team.addness.co.jp';
const UTAGE_PASSWORD = process.env.UTAGE_PASSWORD || 'bC4F6mkV';

const SP1 = '7474920444831875080';
const FUNNEL_CONFIG = { funnelId: '3lS3x3dXa6kc', groupId: 'sOiiROJBAVIu', stepId: 'doc7hffUAVTv' };
const DEFAULT_BUDGET = 5000;
const AD_TEXT = 'スキルで独立するなら学んでおきたい本質のスキル活用術特商法（https://skill.addness.co.jp/tokushoho）';

// CR00568の全50動画から「ホリエモン冒頭③×ダイジェスト」(v10033g50000d4889anog65rdkd85j90)を除外した49本
const ALL_VIDEOS = [
  'v10033g50000d53oaavog65ubhl50sdg', // セミナー開催決定 ver2_冒頭2
  'v10033g50000d5pcpqfog65im07g3uhg', // 1日2時間あったら
  'v10033g50000d5m847fog65j19ous5ig', // はいそこまで（外）
  'v10033g50000d3oatbvog65o47fni300', // ジャパ高「学び方」で未来は変わる
  'v10033g50000d5i9eqnog65gre3a7a10', // おーい会社員_今スキルプラス入る人
  'v10033g50000d4a7uo7og65lc7nq1t60', // セミナー開催決定 ver2_冒頭1
  'v10033g50000d5uuc17og65rh1umbkag', // X広告_荻野
  'v10033g50000d5r2d07og65mjr9hrqug', // 冒頭2_二極化
  'v10033g50000d3qq2ofog65vhp9ja2q0', // 冒頭①(演出あり)_おい会社員
  'v10033g50000d5uutlfog65o2279nu30', // 後悔描く_箱up_手書き風
  'v10033g50000d5ms5e7og65pd3hoh9s0', // AI副業の嘘セミナー
  'v10033g50000d4a0cknog65n6u4ng0g0', // 台本３-tiktok
  'v10033g50000d5i978fog65o0nku13j0', // おーい会社員_良いサービス
  'v10033g50000d4408vfog65qlrnp8cu0', // TT_冒頭3_マジで意味ないです
  'v10033g50000d42t977og65g2f5j52j0', // セミナー編 TT
  'v10033g50000d41jflnog65hh7u38fkg', // 本質足りてない①
  'v10033g50000d41jegfog65rsmg53vb0', // 本質足りてない②
  'v10033g50000d41jdtnog65ksg5nggug', // 本質足りてない③
  'v10033g50000d41jdb7og65tr2tdfhpg', // 本質足りてない④
  'v10033g50000d3sgb0nog65komg77jd0', // 台本３-tiktok(別ver)
  'v10033g50000d3qq617og65ivolehqgg', // 冒頭①(演出なし)_おい会社員
  'v10033g50000d3q83afog65pi7bskqlg', // セミナー編 TT BGM
  'v10033g50000d4408vfog65ke17vvii0', // TT_冒頭1_マジで意味ないです
  'v10033g50000d4408vfog65tdj0bs7kg', // TT_冒頭2_マジで意味ないです
  'v10033g50000d4417r7og65g8isc7phg', // 冒頭3セミナー開催決定
  'v10033g50000d44c6lfog65mh2mi3280', // セミナー開催決定 ver2_冒頭12
  'v10033g50000d44hl5nog65nu13dvpo0', // 冒頭①_おい会社員(別ver)
  'v10033g50000d44nmlfog65qratfa620', // セミナー開催決定 ver2_冒頭11
  'v10033g50000d44tbdvog65jq6qlbq90', // セミナー編 TT(別ver)
  'v10033g50000d4539tnog65kub70tgo0', // 冒頭①(演出あり)(別ver)
  'v10033g50000d3pqv67og65kbm6kce40', // セミナー開催決定 ver2_冒頭7
  'v10033g50000d3jjhd7og65kjmr77ht0', // 冒頭2セミナー開催決定
  'v10033g50000d447k27og65g2f75d2m0', // セミナーダイジェスト
  'v10033g50000d3pqv5nog65ob4jbvmv0', // セミナー開催決定 ver2_冒頭6
  'v10033g50000d3jjho7og65tpkd1alq0', // 冒頭1セミナー開催決定
  'v10033g50000d3qq2ofog65tfetphdeg', // 冒頭④(演出あり)_おい会社員
  'v10033g50000d3pqv5nog65gcn9r8fb0', // セミナー開催決定 ver2_冒頭3
  // [38] ホリエモン冒頭③×ダイジェスト → 除外
  'v10033g50000d3qq61fog65mr67vuq40', // 冒頭②(演出なし)_おい会社員
  'v10033g50000d488gfvog65s7qu281mg', // 箕輪さん冒頭⑤
  'v10033g50000d41unvnog65vo6v5u1u0', // 冒頭⑤(演出なし)_おい会社員
  'v10033g50000d488gfnog65itedcejlg', // まちがっている_セミナー_強化なし
  'v10033g50000d488gfnog65ge10l1gd0', // 箕輪さん冒頭③
  'v10033g50000d3pqv5nog65p0ctfu9u0', // セミナー開催決定 ver2_冒頭12(別)
  'v10033g50000d3pqv5nog65uu0heud60', // セミナー開催決定 ver2_冒頭2(別)
  'v10033g50000d3pqv5vog65lcmufjm70', // セミナー開催決定 ver2_冒頭10
  'v10033g50000d488gfnog65qu8hc4feg', // まちがっている_セミナー_強化あり
  'v10033g50000d3pqv5nog65gkctctb90', // セミナー開催決定 ver2_冒頭1(別)
  'v10033g50000d48idavog65r60okcft0', // まちがっている(Music_Refresh)
  'v10033g50000d48h9ffog65voa8gf4pg', // 冒頭①(演出なし)(Music_Refresh)
];

// 6本×7グループ + 7本×1グループ = 49本
function splitIntoGroups(videos: string[]): string[][] {
  const groups: string[][] = [];
  let idx = 0;
  // 最初の7グループ: 6本ずつ
  for (let g = 0; g < 7; g++) {
    groups.push(videos.slice(idx, idx + 6));
    idx += 6;
  }
  // 最後の1グループ: 残り7本
  groups.push(videos.slice(idx));
  return groups;
}

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
  }
  const t = new Date(Date.now() + 5 * 60 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}:${String(t.getUTCSeconds()).padStart(2, '0')}`;
}

async function tiktokApi(endpoint: string, body: any): Promise<any> {
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

// ===== カバー画像 =====
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
    return Array.isArray(uploadResp.data.data) ? uploadResp.data.data[0]?.image_id : uploadResp.data.data.image_id;
  } catch { return null; }
}

// ===== UTAGE =====
async function utageLogin(): Promise<void> {
  console.log('UTAGEログイン中...');
  const pageResp = await fetch(UTAGE_LOGIN_URL, { redirect: 'manual' });
  sessionCookies = mergeCookies('', pageResp.headers);
  const csrfToken = extractCsrfToken(await pageResp.text());
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
  const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${FUNNEL_CONFIG.funnelId}/tracking`);
  const pattern = /TikTok広告-スキルプラス-LP2-CR(0\d{4})/g;
  const matches = [...html.matchAll(pattern)];
  if (matches.length === 0) return 0;
  return matches.map(m => parseInt(m[1])).sort((a, b) => b - a)[0];
}

async function createRegistrationPath(crNumber: number): Promise<{ registrationPath: string; destinationUrl: string }> {
  const crStr = String(crNumber).padStart(5, '0');
  const registrationPath = `TikTok広告-スキルプラス-LP2-CR${crStr}`;
  console.log(`  UTAGE: ${registrationPath}`);

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

  console.log(`  → ${urlMatch[0]}`);
  return { registrationPath, destinationUrl: urlMatch[0] };
}

// ===== Smart+作成 =====
const ctaCache = new Map<string, string>();
async function getCtaId(advertiserId: string): Promise<string> {
  if (ctaCache.has(advertiserId)) return ctaCache.get(advertiserId)!;
  const data = await tiktokGet('/v1.3/smart_plus/ad/get/', { advertiser_id: advertiserId, page_size: '5' });
  const ctaId = data.data?.list?.[0]?.ad_configuration?.call_to_action_id || '';
  ctaCache.set(advertiserId, ctaId);
  return ctaId;
}

// ===== メイン =====
async function main() {
  const prisma = new PrismaClient();
  const results: string[] = [];

  try {
    const adv = await prisma.advertiser.findUnique({
      where: { tiktokAdvertiserId: SP1 },
      select: { pixelId: true, identityId: true, identityAuthorizedBcId: true, name: true },
    });
    if (!adv || !adv.pixelId || !adv.identityId) throw new Error('SP1アカウント未設定');

    console.log(`=== CR00568分割出稿 (SP1: ${adv.name}) ===`);
    console.log(`動画数: ${ALL_VIDEOS.length}本（ホリエモン冒頭③×ダイジェスト除外済み）`);

    const groups = splitIntoGroups(ALL_VIDEOS);
    console.log(`グループ数: ${groups.length} (${groups.map(g => g.length + '本').join(', ')})`);

    const jstHour = getJstNow().getUTCHours();
    console.log(`JST ${jstHour}時 | 配信開始: ${getScheduleStartTime()} | 広告名日付: ${getJstDateStr()}\n`);

    // カバー画像を一括取得
    console.log('カバー画像取得中...');
    const coverMap = new Map<string, string>();
    for (let i = 0; i < ALL_VIDEOS.length; i += 50) {
      const batch = ALL_VIDEOS.slice(i, i + 50);
      const data = await tiktokGet('/v1.3/file/video/ad/info/', {
        advertiser_id: SP1,
        video_ids: JSON.stringify(batch),
      });
      for (const video of (data.data?.list || [])) {
        if (video.video_cover_url && video.video_id) {
          const imageId = await uploadCoverImage(SP1, video.video_cover_url, video.video_id);
          if (imageId) coverMap.set(video.video_id, imageId);
        }
      }
    }
    console.log(`カバー画像: ${coverMap.size}/${ALL_VIDEOS.length}件\n`);

    // UTAGE
    await utageLogin();
    let latestCr = await getLatestCrNumber();
    console.log(`最新CR: CR${String(latestCr).padStart(5, '0')}\n`);

    const ctaId = await getCtaId(SP1);

    for (let g = 0; g < groups.length; g++) {
      const group = groups[g];
      console.log(`--- グループ${g + 1}/${groups.length} (${group.length}本) ---`);

      // UTAGE登録
      latestCr++;
      const { registrationPath, destinationUrl } = await createRegistrationPath(latestCr);
      const crStr = String(latestCr).padStart(5, '0');
      const adName = `${getJstDateStr()}/ROAS300%勝ちCR集${g + 1}/スキルプラス/LP2-CR${crStr}`;
      const landingPageUrl = `${destinationUrl}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;

      console.log(`  広告名: ${adName}`);

      // キャンペーン
      const campData = await tiktokApi('/v1.3/smart_plus/campaign/create/', {
        advertiser_id: SP1,
        campaign_name: adName,
        objective_type: 'LEAD_GENERATION',
        budget_optimize_on: false,
        budget_mode: 'BUDGET_MODE_INFINITE',
        request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
      });
      const campaignId = String(campData.data.campaign_id);

      // 広告グループ
      const agData = await tiktokApi('/v1.3/smart_plus/adgroup/create/', {
        advertiser_id: SP1,
        campaign_id: campaignId,
        adgroup_name: `${getJstDateStr()} 25-54`,
        budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET',
        budget: DEFAULT_BUDGET,
        billing_event: 'OCPM',
        bid_type: 'BID_TYPE_NO_BID',
        optimization_goal: 'CONVERT',
        optimization_event: 'ON_WEB_REGISTER',
        pixel_id: adv.pixelId,
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
      const adgroupId = String(agData.data.adgroup_id);

      // 広告
      const creative_list = group.map(videoId => {
        const creativeInfo: any = {
          ad_format: 'SINGLE_VIDEO',
          video_info: { video_id: videoId },
          identity_id: adv.identityId,
          identity_type: 'BC_AUTH_TT',
          identity_authorized_bc_id: adv.identityAuthorizedBcId,
        };
        const coverId = coverMap.get(videoId);
        if (coverId) creativeInfo.image_info = [{ web_uri: coverId }];
        return { creative_info: creativeInfo };
      });

      const adData = await tiktokApi('/v1.3/smart_plus/ad/create/', {
        advertiser_id: SP1,
        adgroup_id: adgroupId,
        ad_name: adName,
        creative_list,
        ad_text_list: [{ ad_text: AD_TEXT }],
        landing_page_url_list: [{ landing_page_url: landingPageUrl }],
        ad_configuration: { call_to_action_id: ctaId },
        operation_status: 'ENABLE',
        request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
      });
      const adId = String(adData.data?.ad_id || adData.data?.smart_plus_ad_id);

      console.log(`  → ad_id: ${adId} | campaign: ${campaignId}\n`);
      results.push(`グループ${g + 1} (${group.length}本) | ${adName} | ad_id: ${adId} | CR${crStr}`);
    }

    console.log('\n========================================');
    console.log('全グループ完了');
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
