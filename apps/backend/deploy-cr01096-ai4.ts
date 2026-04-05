/**
 * CR01096をAI_4に横展開（全年齢 + 3除外オーディエンス）
 * ソース: AI_2 (7523128243466551303) ad_id: 1860420037916834
 * ターゲット: AI_4 (7580666710525493255)
 */
import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const UTAGE_BASE_URL = 'https://school.addness.co.jp';
const UTAGE_LOGIN_URL = 'https://school.addness.co.jp/operator/GYbKT7Y9d0eR/login';
const UTAGE_EMAIL = process.env.UTAGE_EMAIL || 'chiba.nobuteru@team.addness.co.jp';
const UTAGE_PASSWORD = process.env.UTAGE_PASSWORD || 'bC4F6mkV';

const FUNNEL_CONFIG = { funnelId: 'a09j9jop95LF', groupId: 'EFnsGw3gAdba', stepId: 'r2RHcL0PdGIY' };

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

async function utageLogin(): Promise<void> {
  console.log('\n3. UTAGEログイン中...');
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
  console.log('4. 最新CR番号を取得中... (AI LP1)');
  const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${FUNNEL_CONFIG.funnelId}/tracking`);
  const pattern = /TikTok広告-AI-LP1-CR(0\d{4})/g;
  const matches = [...html.matchAll(pattern)];
  if (matches.length === 0) { console.log('   既存の登録経路なし'); return 0; }
  const crNumbers = matches.map(m => parseInt(m[1])).sort((a, b) => b - a);
  console.log(`   最新CR番号: CR${String(crNumbers[0]).padStart(5, '0')} (${matches.length}件中)`);
  return crNumbers[0];
}

async function createRegistrationPath(crNumber: number): Promise<{ registrationPath: string; destinationUrl: string }> {
  const crStr = String(crNumber).padStart(5, '0');
  const registrationPath = `TikTok広告-AI-LP1-CR${crStr}`;
  console.log(`5. UTAGE登録経路作成中: ${registrationPath}`);

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

  console.log(`   作成完了: ${urlMatch[0]}`);
  return { registrationPath, destinationUrl: urlMatch[0] };
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
        console.log('   サムネイル取得OK');
        return video.video_cover_url;
      }
    } catch { /* retry */ }
  }
  console.log('   サムネイル生成待ちタイムアウト（続行）');
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
    const respData = uploadResp.data.data;
    const imageId = Array.isArray(respData) ? respData[0]?.image_id : respData.image_id;
    console.log(`   カバー画像アップロード完了 → ${imageId}`);
    return imageId;
  } catch (e: any) {
    console.log(`   カバー画像処理エラー: ${e.message}`);
    return null;
  }
}

async function main() {
  const SOURCE_ADV = '7523128243466551303'; // AI_2
  const SOURCE_AD = '1860420037916834';
  const TARGET_ADV = '7580666710525493255'; // AI_4
  const DAILY_BUDGET = 3000;

  console.log('===== CR01096 → AI_4 横展開（全年齢 + 3除外オーディエンス） =====\n');

  const prisma = new PrismaClient();
  try {
    const target = await prisma.advertiser.findUnique({
      where: { tiktokAdvertiserId: TARGET_ADV },
      select: { pixelId: true, identityId: true, identityAuthorizedBcId: true, name: true },
    });
    if (!target?.pixelId || !target?.identityId) throw new Error('pixel/identity未設定');
    console.log(`展開先: ${target.name}`);

    // 1. ソース広告の動画IDを取得（通常広告）
    console.log('\n1. 元広告の情報を取得中...');
    const adResp = await tiktokGet('/v1.3/ad/get/', {
      advertiser_id: SOURCE_ADV,
      filtering: JSON.stringify({ ad_ids: [SOURCE_AD] }),
      fields: JSON.stringify(['ad_id', 'ad_name', 'video_id', 'ad_text', 'landing_page_url']),
    });
    const ad = adResp.data?.list?.[0];
    if (!ad) throw new Error('広告が見つかりません');

    const adName = ad.ad_name;
    const videoId = ad.video_id;
    console.log(`   広告名: ${adName}`);
    console.log(`   動画ID: ${videoId}`);

    // 2. 前回アップロード済みの動画とカバー画像を再利用
    const newVideoId = 'v10033g50000d7354ovog65sd2comclg';
    const coverImageId = 'ad-site-i18n-sg/20260327c7c7965e81d1761844aebf5b';
    console.log(`\n2. 前回アップロード済み動画を再利用: ${newVideoId}`);
    console.log(`   カバー画像: ${coverImageId}`);

    // 3. UTAGE登録経路作成
    await utageLogin();
    const latestCr = await getLatestCrNumber();
    // CR01128は前回の失敗で作成済みなのでそのまま使う
    const newCrNumber = latestCr <= 1128 ? 1128 : latestCr + 1;
    const { registrationPath, destinationUrl } = await createRegistrationPath(newCrNumber);

    // 4. 広告名生成
    const parts = adName.split('/');
    const creator = parts.length >= 2 ? parts[1] : '横展開';
    const crName = parts.length >= 3 ? parts[2] : '横展開CR';
    const crStr = String(newCrNumber).padStart(5, '0');
    const newAdName = `${getJstDateStr()}/${creator}/${crName}/LP1-CR${crStr}`;
    const landingPageUrl = `${destinationUrl}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;

    console.log(`\n6. 広告名: ${newAdName}`);
    console.log(`   LP URL: ${landingPageUrl}\n`);

    // 7. 前回作成済みキャンペーンを再利用
    const campaignId = '1860808210689201';
    console.log(`7. 既存キャンペーンを再利用: ${campaignId}`);

    // 8. Smart+広告グループ作成（全年齢 + 3除外オーディエンス）
    console.log(`8. Smart+広告グループ作成中... (日予算: ¥${DAILY_BUDGET})`);
    console.log('   ターゲティング: 全年齢');
    console.log('   除外: TikTokAIオプトイン全期間(194977234), 年収100万以下類似(195006413), TikTok除外リスト(194416060)');

    const adgData = await tiktokApi('/v1.3/smart_plus/adgroup/create/', {
      advertiser_id: TARGET_ADV,
      campaign_id: campaignId,
      adgroup_name: `${getJstDateStr()} 全年齢`,
      budget_mode: 'BUDGET_MODE_INFINITE',
      billing_event: 'OCPM',
      bid_type: 'BID_TYPE_NO_BID',
      optimization_goal: 'CONVERT',
      optimization_event: 'ON_WEB_REGISTER',
      pixel_id: target.pixelId,
      promotion_type: 'LEAD_GENERATION',
      promotion_target_type: 'EXTERNAL_WEBSITE',
      placement_type: 'PLACEMENT_TYPE_NORMAL',
      placements: ['PLACEMENT_TIKTOK'],
      comment_disabled: true,
      schedule_type: 'SCHEDULE_FROM_NOW',
      schedule_start_time: getScheduleStartTime(),
      targeting_spec: {
        location_ids: ['1861060'],
        excluded_custom_audience_ids: ['194977234', '195006413', '194416060'],
      },
      request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
    });
    const adgroupId = String(adgData.data.adgroup_id);
    console.log(`   広告グループID: ${adgroupId}`);

    // 9. Smart+広告作成
    console.log('9. Smart+広告作成中...');

    // CTA ID取得
    const ctaData = await tiktokGet('/v1.3/smart_plus/ad/get/', { advertiser_id: TARGET_ADV, page_size: '5' });
    const ctaAds = ctaData.data?.list || [];
    const ctaId = ctaAds[0]?.ad_configuration?.call_to_action_id || '';
    console.log(`   CTA ID: ${ctaId}`);

    const creativeInfo: any = {
      ad_format: 'SINGLE_VIDEO',
      video_info: { video_id: newVideoId },
      identity_id: target.identityId,
      identity_type: 'BC_AUTH_TT',
      identity_authorized_bc_id: target.identityAuthorizedBcId || '',
    };
    if (coverImageId) {
      creativeInfo.image_info = [{ web_uri: coverImageId }];
    }

    const adText = 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）';

    const adData = await tiktokApi('/v1.3/smart_plus/ad/create/', {
      advertiser_id: TARGET_ADV,
      adgroup_id: adgroupId,
      ad_name: newAdName,
      creative_list: [{ creative_info: creativeInfo }],
      ad_text_list: [{ ad_text: adText }],
      landing_page_url_list: [{ landing_page_url: landingPageUrl }],
      ad_configuration: { call_to_action_id: ctaId },
      operation_status: 'ENABLE',
      request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
    });
    const adId = String(adData.data?.ad_id || adData.data?.smart_plus_ad_id);
    console.log(`   広告ID: ${adId}`);

    console.log('\n===== 横展開完了 =====');
    console.log(`広告名: ${newAdName}`);
    console.log(`CR番号: CR${crStr}`);
    console.log(`UTAGE経路: ${registrationPath}`);
    console.log(`キャンペーンID: ${campaignId}`);
    console.log(`広告グループID: ${adgroupId}`);
    console.log(`広告ID: ${adId}`);
    console.log(`日予算: ¥${DAILY_BUDGET}`);
    console.log('ターゲティング: 全年齢 + 除外3件');

    // 仮説検証登録
    try {
      await prisma.hypothesisTest.create({
        data: {
          channelType: 'AI',
          hypothesis: `${adName}を${target.name}に横展開（全年齢ターゲ + 3除外オーディエンス）。元アカウントでの個別予約CPO602円実績を基に検証`,
          status: 'RUNNING',
          adId: adId,
          adName: newAdName,
          account: target.name || TARGET_ADV,
        },
      });
      console.log('\n仮説検証を登録しました');
    } catch (e: any) {
      console.log(`\n仮説登録スキップ: ${e.message}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => { console.error('\n===== エラー ====='); console.error(err); process.exit(1); });
