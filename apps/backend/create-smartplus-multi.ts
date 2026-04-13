/**
 * 複数動画でSmart+キャンペーンを1つ作成
 * npx tsx apps/backend/create-smartplus-multi.ts
 */
import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import { getUtageCrMax, reserveNextCrNumber } from './src/utage/cr-reservation';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const UTAGE_BASE_URL = 'https://school.addness.co.jp';
const UTAGE_LOGIN_URL = 'https://school.addness.co.jp/operator/GYbKT7Y9d0eR/login';
const UTAGE_EMAIL = process.env.UTAGE_EMAIL || 'chiba.nobuteru@team.addness.co.jp';
const UTAGE_PASSWORD = process.env.UTAGE_PASSWORD || 'bC4F6mkV';

const TIKTOK_FUNNEL_MAP: Record<string, Record<number, { funnelId: string; groupId: string; stepId: string }>> = {
  'AI': {
    1: { funnelId: 'a09j9jop95LF', groupId: 'EFnsGw3gAdba', stepId: 'r2RHcL0PdGIY' },
  },
};

// ===== 設定 =====
const ADVERTISER_ID = '7468288053866561553'; // AI_1
const APPEAL = 'AI';
const LP_NUMBER = 1;
const DAILY_BUDGET = 3000;

const VIDEOS = [
  { adName: '260407/高橋海斗/【ねねさん】Claude_Code/LP1-CR01131', videoId: 'v10033g50000d73jgovog65rempsvtcg' },
  { adName: '260406/鈴木織大/おい会社員_1年後悔/LP1-CR01172', videoId: 'v10033g50000d10mfl7og65trcf42l5g' },
  { adName: '260406/高橋海斗/やれやめろ＿編集強化/LP1-CR01169', videoId: 'v10033g50000d5reklnog65uj38psptg' },
  { adName: '260404/在中悠也/説明しようAI_冒頭1_林社長/LP1-CR01161', videoId: 'v10033g50000d34k1pnog65l9k1377d0' },
  { adName: '260402/石黒研太/AI全部やめました渋谷Ver/LP1-CR01144', videoId: 'v10033g50000d6onmc7og65m24ip5vig' },
  { adName: '260405/AI/一撃YouTube動画作成_途中CTAあり/LP1-CR01165', videoId: 'v10033g50000d6pv7lnog65gfhdsgfug' },
];

const AD_TEXT = 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）';

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
  throw new Error('CSRFトークン取得失敗');
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
  }
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
  if (data.code !== 0) throw new Error(`TikTok API エラー: ${data.message} (code: ${data.code})\n${JSON.stringify(data, null, 2)}`);
  return data;
}

async function tiktokGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`TikTok API エラー: ${data.message}`);
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
  const config = TIKTOK_FUNNEL_MAP[APPEAL]![LP_NUMBER]!;
  console.log(`2. 最新CR番号を取得中... (${APPEAL} LP${LP_NUMBER}、全ページ走査)`);
  const maxCr = await getUtageCrMax(authedGet, UTAGE_BASE_URL, config.funnelId, APPEAL, LP_NUMBER);
  console.log(`   UTAGE最大CR番号: ${maxCr === 0 ? '(該当なし)' : `CR${String(maxCr).padStart(5, '0')}`}`);
  return maxCr;
}

async function createRegistrationPath(crNumber: number): Promise<{ registrationPath: string; destinationUrl: string }> {
  const config = TIKTOK_FUNNEL_MAP[APPEAL]![LP_NUMBER]!;
  const crStr = String(crNumber).padStart(5, '0');
  const registrationPath = `TikTok広告-${APPEAL}-LP${LP_NUMBER}-CR${crStr}`;
  console.log(`   UTAGE経路作成: ${registrationPath}`);

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

  console.log(`   → ${urlMatch[0]}`);
  return { registrationPath, destinationUrl: urlMatch[0] };
}

// ===== カバー画像 =====
async function getVideoCoverUrl(videoId: string): Promise<string | null> {
  for (let i = 0; i < 5; i++) {
    try {
      const data = await tiktokGet('/v1.3/file/video/ad/info/', {
        advertiser_id: ADVERTISER_ID,
        video_ids: JSON.stringify([videoId]),
      });
      const video = data.data?.list?.[0];
      if (video?.video_cover_url) return video.video_cover_url;
    } catch {}
    await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}

async function uploadCoverImage(coverUrl: string): Promise<string | null> {
  try {
    const imgResp = await fetch(coverUrl);
    if (!imgResp.ok) return null;
    const buffer = Buffer.from(await imgResp.arrayBuffer());
    const FormData = require('form-data');
    const axios = require('axios');
    const form = new FormData();
    form.append('advertiser_id', ADVERTISER_ID);
    form.append('upload_type', 'UPLOAD_BY_FILE');
    form.append('image_signature', crypto.createHash('md5').update(buffer).digest('hex'));
    form.append('image_file', buffer, { filename: `cover_${Date.now()}.jpg`, contentType: 'image/jpeg' });
    const resp = await axios.post(`${TIKTOK_API_BASE}/v1.3/file/image/ad/upload/`, form, {
      headers: { 'Access-Token': ACCESS_TOKEN, ...form.getHeaders() },
      timeout: 30000,
    });
    if (resp.data.code !== 0) return null;
    return resp.data.data?.web_uri || resp.data.data?.image_id;
  } catch { return null; }
}

// ===== メイン =====
async function main() {
  const prisma = new PrismaClient();

  try {
    const advertiser = await prisma.advertiser.findUnique({
      where: { tiktokAdvertiserId: ADVERTISER_ID },
      select: { pixelId: true, identityId: true, identityAuthorizedBcId: true, name: true },
    });
    if (!advertiser?.pixelId || !advertiser.identityId || !advertiser.identityAuthorizedBcId) {
      throw new Error('アカウント情報不足');
    }

    const dateStr = getJstDateStr();
    const jstHour = getJstNow().getUTCHours();

    console.log('===== Smart+マルチクリエイティブ作成 =====');
    console.log(`アカウント: ${advertiser.name} (${ADVERTISER_ID})`);
    console.log(`導線: ${APPEAL} LP${LP_NUMBER}`);
    console.log(`動画数: ${VIDEOS.length}本`);
    console.log(`日予算: ¥${DAILY_BUDGET}`);
    console.log(`配信開始: ${isAfter15Jst() ? '翌日0時JST' : '本日即時'} (現在JST ${jstHour}時)`);
    console.log(`広告名日付: ${dateStr}\n`);

    // 1. UTAGE
    await utageLogin();
    const utageMax = await getLatestCrNumber();

    // 2. 各動画ごとにUTAGE経路を作成（CR番号は予約テーブルで原子的に採番）
    console.log(`\n3. ${VIDEOS.length}件のUTAGE登録経路を作成中...`);
    const creatives: { videoId: string; crNumber: number; crStr: string; registrationPath: string; lpUrl: string; coverWebUri: string | null; srcAdName: string }[] = [];

    for (let i = 0; i < VIDEOS.length; i++) {
      const newCr = await reserveNextCrNumber(prisma, APPEAL, LP_NUMBER, utageMax);
      const { registrationPath, destinationUrl } = await createRegistrationPath(newCr);
      const lpUrl = `${destinationUrl}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;
      creatives.push({
        videoId: VIDEOS[i].videoId,
        crNumber: newCr,
        crStr: String(newCr).padStart(5, '0'),
        registrationPath,
        lpUrl,
        coverWebUri: null,
        srcAdName: VIDEOS[i].adName,
      });
    }

    // 3. カバー画像取得＆アップロード
    console.log(`\n4. カバー画像取得中（${VIDEOS.length}本）...`);
    for (const c of creatives) {
      const coverUrl = await getVideoCoverUrl(c.videoId);
      if (coverUrl) {
        c.coverWebUri = await uploadCoverImage(coverUrl);
        console.log(`   ${c.crStr}: ${c.coverWebUri ? 'OK' : 'SKIP'}`);
      } else {
        console.log(`   ${c.crStr}: カバー画像なし`);
      }
    }

    // 4. キャンペーン名（元CR番号を列挙）
    const srcCrs = VIDEOS.map(v => {
      const m = v.adName.match(/CR(\d+)/i);
      return m ? `CR${m[1]}` : '';
    }).filter(Boolean);
    const campaignName = `${dateStr}/スマプラ/${srcCrs.join('_')}/LP${LP_NUMBER}-CR${creatives[0].crStr}`;

    console.log(`\n5. キャンペーン作成: ${campaignName}`);

    // 除外オーディエンス
    const excludedAudiences = ['194977234', '194405484']; // AI_1: AIオプトイン + 除外

    const campaignData = await tiktokApi('/v1.3/smart_plus/campaign/create/', {
      advertiser_id: ADVERTISER_ID,
      campaign_name: campaignName,
      objective_type: 'LEAD_GENERATION',
      budget_mode: 'BUDGET_MODE_INFINITE',
      budget_optimize_on: false,
      request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
    });
    const campaignId = String(campaignData.data.campaign_id);
    console.log(`   キャンペーンID: ${campaignId}`);

    // 5. 広告グループ（手動ターゲティング + ディープファネル最適化）
    const ageGroups = ['AGE_25_34', 'AGE_35_44', 'AGE_45_54'];
    console.log(`\n6. 広告グループ作成（年齢25-54, 手動ターゲティング, ディープファネル: COMPLETE_PAYMENT）`);
    const adgroupData = await tiktokApi('/v1.3/smart_plus/adgroup/create/', {
      advertiser_id: ADVERTISER_ID,
      campaign_id: campaignId,
      adgroup_name: `${dateStr} 25-34, 35-44, 45-54`,
      budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET',
      budget: DAILY_BUDGET,
      billing_event: 'OCPM',
      bid_type: 'BID_TYPE_NO_BID',
      optimization_goal: 'CONVERT',
      optimization_event: 'ON_WEB_REGISTER',
      deep_external_action: 'COMPLETE_PAYMENT',
      pixel_id: advertiser.pixelId,
      promotion_type: 'LEAD_GENERATION',
      promotion_target_type: 'EXTERNAL_WEBSITE',
      placement_type: 'PLACEMENT_TYPE_NORMAL',
      placements: ['PLACEMENT_TIKTOK'],
      comment_disabled: true,
      schedule_type: 'SCHEDULE_FROM_NOW',
      schedule_start_time: getJstScheduleTime(),
      targeting_optimization_mode: 'MANUAL',
      targeting_spec: {
        location_ids: ['1861060'],
        age_groups: ageGroups,
        excluded_audience_ids: excludedAudiences,
      },
      request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
    });
    const adgroupId = String(adgroupData.data.adgroup_id);
    console.log(`   広告グループID: ${adgroupId}`);

    // ターゲティング検証
    console.log('   ターゲティング検証中（5秒待機）...');
    await new Promise(r => setTimeout(r, 5000));
    try {
      const verifyResp = await tiktokGet('/v1.3/smart_plus/adgroup/get/', {
        advertiser_id: ADVERTISER_ID,
        adgroup_ids: JSON.stringify([adgroupId]),
      });
      const actual = verifyResp.data?.list?.[0]?.targeting_spec;
      const actualAges = actual?.age_groups || [];
      const actualExcluded = actual?.excluded_audience_ids || [];
      const ageOk = ageGroups.every(g => actualAges.includes(g));
      const excludeOk = excludedAudiences.every(id => actualExcluded.includes(id));
      if (!ageOk || !excludeOk) {
        console.log(`   ⚠ ターゲティング不一致 → 修正`);
        await tiktokApi('/v1.3/smart_plus/adgroup/update/', {
          advertiser_id: ADVERTISER_ID,
          adgroup_id: adgroupId,
          targeting_spec: { location_ids: ['1861060'], age_groups: ageGroups, excluded_audience_ids: excludedAudiences },
        });
        console.log('   ✅ 修正完了');
      } else {
        console.log(`   ✅ ターゲティングOK（年齢: ${actualAges.length}グループ, 除外: ${actualExcluded.length}件）`);
      }
    } catch (e: any) {
      console.log(`   ⚠ 検証失敗（続行）: ${e.message}`);
    }

    // 6. 広告作成（6つのクリエイティブ）
    console.log(`\n7. Smart+広告作成（${creatives.length}クリエイティブ）`);

    // CTA ID取得
    const ctaData = await tiktokGet('/v1.3/smart_plus/ad/get/', {
      advertiser_id: ADVERTISER_ID,
      page_size: '5',
    });
    const ctaId = ctaData.data?.list?.[0]?.ad_configuration?.call_to_action_id || '';
    console.log(`   CTA ID: ${ctaId}`);

    const creativeList = creatives.map(c => {
      const info: any = {
        ad_format: 'SINGLE_VIDEO',
        video_info: { video_id: c.videoId },
        identity_id: advertiser.identityId,
        identity_type: 'BC_AUTH_TT',
        identity_authorized_bc_id: advertiser.identityAuthorizedBcId,
      };
      if (c.coverWebUri) {
        info.image_info = [{ web_uri: c.coverWebUri }];
      }
      return { creative_info: info };
    });

    const landingPageUrlList = creatives.map(c => ({ landing_page_url: c.lpUrl }));

    const adData = await tiktokApi('/v1.3/smart_plus/ad/create/', {
      advertiser_id: ADVERTISER_ID,
      adgroup_id: adgroupId,
      ad_name: campaignName,
      creative_list: creativeList,
      ad_text_list: [{ ad_text: AD_TEXT }],
      landing_page_url_list: landingPageUrlList,
      ad_configuration: { call_to_action_id: ctaId },
      operation_status: 'ENABLE',
      request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
    });
    const adId = String(adData.data?.ad_id || adData.data?.smart_plus_ad_id);
    console.log(`   広告ID: ${adId}`);

    // ===== 結果表示 =====
    console.log('\n===== 作成完了 =====');
    console.log(`キャンペーン名: ${campaignName}`);
    console.log(`キャンペーンID: ${campaignId}`);
    console.log(`広告グループID: ${adgroupId}`);
    console.log(`広告ID: ${adId}`);
    console.log(`日予算: ¥${DAILY_BUDGET}`);
    console.log(`手動ターゲティング: 年齢25-54, 除外オーディエンス2件`);
    console.log(`ディープファネル: COMPLETE_PAYMENT`);
    console.log(`配信開始: ${getJstScheduleTime()}`);
    console.log('\nクリエイティブ一覧:');
    for (const c of creatives) {
      console.log(`  CR${c.crStr}: ${c.srcAdName}`);
      console.log(`    UTAGE: ${c.registrationPath}`);
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
