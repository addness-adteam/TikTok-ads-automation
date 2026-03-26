/**
 * 同一アカウント内でCRを再出稿する汎用スクリプト
 *
 * 使い方:
 *   npx tsx apps/backend/redeploy-ad.ts <advertiser_id> <source_ad_id> [daily_budget]
 *
 * 例:
 *   npx tsx apps/backend/redeploy-ad.ts 7474920444831875080 1859709464799409
 *   npx tsx apps/backend/redeploy-ad.ts 7474920444831875080 1859709464799409 3000
 *
 * 処理フロー:
 *   1. 元広告の情報をTikTok APIから取得（広告名・動画ID・広告文・LP）
 *   2. 広告名からappeal/LP番号を推定
 *   3. UTAGEにログイン → 最新CR番号取得 → 新規登録経路作成
 *   4. 動画サムネイル取得＆アップロード（同一アカウントなので動画再アップロード不要）
 *   5. キャンペーン → 広告グループ → 広告 を作成
 *
 * 注意:
 *   - 同一アカウント内の再出稿専用（別アカウントへは /自動出稿 を使う）
 *   - Smart+配信で作成される（予算調整V2で確実に認識されるため）
 *   - 動画は元広告のものをそのまま再利用
 */

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

// ===== 設定 =====
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

// UTAGE設定
const UTAGE_BASE_URL = 'https://school.addness.co.jp';
const UTAGE_LOGIN_URL = 'https://school.addness.co.jp/operator/GYbKT7Y9d0eR/login';
const UTAGE_EMAIL = process.env.UTAGE_EMAIL || 'chiba.nobuteru@team.addness.co.jp';
const UTAGE_PASSWORD = process.env.UTAGE_PASSWORD || 'bC4F6mkV';

// ファネルマッピング
const TIKTOK_FUNNEL_MAP: Record<string, Record<number, { funnelId: string; groupId: string; stepId: string }>> = {
  'AI': {
    1: { funnelId: 'a09j9jop95LF', groupId: 'EFnsGw3gAdba', stepId: 'r2RHcL0PdGIY' },
    2: { funnelId: 'a09j9jop95LF', groupId: 'bvnhWMTjQAPU', stepId: 'EnFeDysozIui' },
    3: { funnelId: 'a09j9jop95LF', groupId: 'EZL6dqvMuop6', stepId: 'A65xiRBl9HCD' },
    4: { funnelId: 'a09j9jop95LF', groupId: 'hEwR9BcvprDu', stepId: 'T8RHcXJVzGtY' },
    5: { funnelId: 'a09j9jop95LF', groupId: 'ND7cXzKmeiqG', stepId: 'EIQBI7HAVxgd' },
    6: { funnelId: 'a09j9jop95LF', groupId: 'FNFK0iB3rIzl', stepId: 'U8Ba9qy5m0us' },
  },
  'SNS': {
    1: { funnelId: 'dZNDzwCgHNBC', groupId: '32FwkcHtFSuj', stepId: 'wZhilaQY1Huv' },
    2: { funnelId: 'dZNDzwCgHNBC', groupId: 'dLrB2E7U7tq8', stepId: 'AhTvtpaeXyj6' },
    3: { funnelId: 'dZNDzwCgHNBC', groupId: 'L9JO3krgnNYD', stepId: '5UKZIXOKSyV4' },
  },
  'スキルプラス': {
    2: { funnelId: '3lS3x3dXa6kc', groupId: 'sOiiROJBAVIu', stepId: 'doc7hffUAVTv' },
  },
};

const DEFAULT_DAILY_BUDGET: Record<string, number> = {
  'AI': 3000,
  'SNS': 3000,
  'スキルプラス': 5000,
};

const DEFAULT_AD_TEXT: Record<string, string> = {
  'AI': 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）',
  'SNS': 'SNSで独立するなら学んでおきたい本質のSNSマーケ特商法（https://skill.addness.co.jp/tokushoho）',
  'スキルプラス': 'スキルで独立するなら学んでおきたい本質のスキル活用術特商法（https://skill.addness.co.jp/tokushoho）',
};

// アカウント→除外オーディエンスID マッピング
// 「TikTok用除外オーディエンス」+ AI系は「TikTokAIオプトイン（全期間）」も追加
// ※ cross-deploy.service.ts の exclusionMap と同期すること
const EXCLUDED_AUDIENCE_MAP: Record<string, string[]> = {
  '7468288053866561553': ['194977234', '194405484'],  // AI_1: AIオプトイン + 除外
  '7523128243466551303': ['194977234', '194405486'],  // AI_2: AIオプトイン + 除外
  '7543540647266074641': ['194977234', '194405488'],  // AI_3: AIオプトイン + 除外
  '7580666710525493255': ['194977234', '194416060'],  // AI_4: AIオプトイン + 除外
  '7247073333517238273': [],                           // SNS1
  '7543540100849156112': ['194405491'],                // SNS2: 除外
  '7543540381615800337': [],                           // SNS3
  '7474920444831875080': [],                           // SP1
  '7592868952431362066': [],                           // SP2
  '7616545514662051858': [],                           // SP3
};

// アカウント→appeal マッピング
const ACCOUNT_APPEAL_MAP: Record<string, string> = {
  '7468288053866561553': 'AI',
  '7523128243466551303': 'AI',
  '7543540647266074641': 'AI',
  '7580666710525493255': 'AI',
  '7247073333517238273': 'SNS',
  '7543540100849156112': 'SNS',
  '7543540381615800337': 'SNS',
  '7474920444831875080': 'スキルプラス',
  '7592868952431362066': 'スキルプラス',
};

// ===== ユーティリティ =====
let sessionCookies = '';

function mergeCookies(existing: string, headers: Headers): string {
  const raw = headers.get('set-cookie');
  if (!raw) return existing;
  const cookies = raw.split(/,(?=\s*[a-zA-Z_]+=)/).map(c => c.split(';')[0].trim());
  const merged = new Map<string, string>();
  if (existing) {
    existing.split('; ').forEach(c => { const [k] = c.split('='); merged.set(k, c); });
  }
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

/**
 * JST現在時刻が15時以降かどうかで配信開始日を決定
 * - 15時より前 → 今日付けで即配信開始
 * - 15時以降 → 翌日0時から配信開始
 */
function getJstNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function isAfter15Jst(): boolean {
  return getJstNow().getUTCHours() >= 15;
}

function getDeliveryDate(): Date {
  const jst = getJstNow();
  if (isAfter15Jst()) {
    // 翌日
    jst.setUTCDate(jst.getUTCDate() + 1);
  }
  return jst;
}

function getJstDateStr(): string {
  const d = getDeliveryDate();
  return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

function getJstScheduleTime(): string {
  if (isAfter15Jst()) {
    // 翌日0時JST = 当日15:00 UTC（TikTok APIはUTCで解釈する）
    const d = getDeliveryDate();
    // dはJSTの翌日日付。UTC換算で前日15:00にする
    d.setUTCDate(d.getUTCDate() - 1);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} 15:00:00`;
  } else {
    // 今すぐ開始（現在UTC+5分）
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
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, {
    headers: { 'Access-Token': ACCESS_TOKEN },
  });
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`TikTok API エラー: ${data.message} (code: ${data.code})`);
  }
  return data;
}

// ===== 元広告情報取得 =====
async function getSourceAdInfo(advertiserId: string, adId: string) {
  console.log('1. 元広告の情報を取得中...');

  // まず通常広告APIで取得
  const adData = await tiktokGet('/v1.3/ad/get/', {
    advertiser_id: advertiserId,
    filtering: JSON.stringify({ ad_ids: [adId] }),
    fields: JSON.stringify(['ad_id', 'ad_name', 'ad_text', 'landing_page_url', 'video_id', 'call_to_action', 'call_to_action_id', 'creative_type']),
  });
  const ad = adData.data?.list?.[0];

  if (ad) {
    console.log(`   [通常広告] ${ad.ad_name}`);
    console.log(`   動画ID: ${ad.video_id}`);
    console.log(`   広告文: ${ad.ad_text}`);
    return { adName: ad.ad_name, adText: ad.ad_text, videoId: ad.video_id, landingPageUrl: ad.landing_page_url };
  }

  // 通常APIで見つからない場合 → Smart+広告として取得
  console.log('   通常広告APIで見つからず → Smart+広告として検索...');
  const spData = await tiktokGet('/v1.3/smart_plus/ad/get/', {
    advertiser_id: advertiserId,
    filtering: JSON.stringify({ smart_plus_ad_ids: [adId] }),
  });
  const spAd = spData.data?.list?.[0];
  if (!spAd) throw new Error(`広告が見つかりません（通常/Smart+両方）: ${adId}`);

  const adName = spAd.smart_plus_ad_name || spAd.ad_name || '';
  const creativeList = spAd.creative_list || [];

  // video_idを抽出（creative_listから最初の1本）
  let videoId = '';
  for (const creative of creativeList) {
    const vid = creative?.creative_info?.video_info?.video_id;
    if (vid && vid !== 'N/A') { videoId = vid; break; }
  }
  if (!videoId) throw new Error('Smart+広告からvideo_idを取得できません');

  // 広告文を抽出
  const adTexts: string[] = [];
  for (const creative of creativeList) {
    const texts = creative?.creative_info?.ad_text_list || [];
    for (const t of texts) { if (t && !adTexts.includes(t)) adTexts.push(t); }
  }
  const adText = adTexts[0] || '';

  // LP URLを抽出
  const landingPageUrls: string[] = [];
  for (const creative of creativeList) {
    const urls = creative?.creative_info?.landing_page_urls || [];
    for (const u of urls) { if (u && !landingPageUrls.includes(u)) landingPageUrls.push(u); }
  }

  console.log(`   [Smart+広告] ${adName}`);
  console.log(`   動画ID: ${videoId}`);
  console.log(`   広告文: ${adText}`);

  return { adName, adText, videoId, landingPageUrl: landingPageUrls[0] || '' };
}

// ===== 広告名パース =====
function parseAdInfo(adName: string, advertiserId: string): { appeal: string; lpNumber: number; creator: string; crName: string } {
  // LP番号抽出
  const lpMatch = adName.match(/LP(\d+)/i);
  const lpNumber = lpMatch ? parseInt(lpMatch[1]) : 1;

  // appeal推定（アカウントID → 広告名の手がかり）
  let appeal = ACCOUNT_APPEAL_MAP[advertiserId] || 'AI';
  if (adName.includes('SNS') || adName.includes('sns')) appeal = 'SNS';
  else if (adName.includes('スキル') || adName.includes('セミナー')) appeal = 'スキルプラス';

  // 制作者名・CR名を抽出（YYMMDD/制作者/CR名/LP-CR形式）
  const parts = adName.split('/');
  const creator = parts.length >= 2 ? parts[1] : '横展開';
  const crName = parts.length >= 3 ? parts[2] : '横展開CR';

  return { appeal, lpNumber, creator, crName };
}

// ===== UTAGE =====
async function utageLogin(): Promise<void> {
  console.log('2. UTAGEログイン中...');
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

async function getLatestCrNumber(appeal: string, lpNumber: number): Promise<number> {
  const config = TIKTOK_FUNNEL_MAP[appeal]?.[lpNumber];
  if (!config) throw new Error(`未対応の導線/LP: ${appeal} LP${lpNumber}`);

  console.log(`3. 最新CR番号を取得中... (${appeal} LP${lpNumber})`);
  const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${config.funnelId}/tracking`);

  // 5桁ゼロ埋め形式のみマッチ（過去の手動登録CR29527等を除外）
  const pattern = new RegExp(`TikTok広告-${appeal}-LP${lpNumber}-CR(0\\d{4})`, 'g');
  const matches = [...html.matchAll(pattern)];

  if (matches.length === 0) {
    console.log('   既存の登録経路なし、CR00001から開始');
    return 0;
  }

  const crNumbers = matches.map(m => parseInt(m[1])).sort((a, b) => b - a);
  console.log(`   最新CR番号: CR${String(crNumbers[0]).padStart(5, '0')} (${matches.length}件中)`);
  return crNumbers[0];
}

async function createRegistrationPath(appeal: string, lpNumber: number, crNumber: number): Promise<{ registrationPath: string; destinationUrl: string }> {
  const config = TIKTOK_FUNNEL_MAP[appeal]![lpNumber]!;
  const crStr = String(crNumber).padStart(5, '0');
  const registrationPath = `TikTok広告-${appeal}-LP${lpNumber}-CR${crStr}`;
  console.log(`4. UTAGE登録経路作成中: ${registrationPath}`);

  const createFormUrl = `${UTAGE_BASE_URL}/funnel/${config.funnelId}/tracking/create`;
  const formHtml = await authedGet(createFormUrl);
  let formToken: string;
  try { formToken = extractCsrfToken(formHtml); } catch { formToken = ''; }

  // フォームaction URL取得
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

  // URL抽出（一覧ページ → ページネーション）
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
  if (foundIdx === -1) throw new Error(`作成した登録経路が見つかりません: ${registrationPath}`);

  const context = foundHtml.substring(Math.max(0, foundIdx - 500), foundIdx + 3000);
  const urlPattern = new RegExp(`https://school\\.addness\\.co\\.jp/p/${config.stepId}\\?ftid=[a-zA-Z0-9]+`);
  const urlMatch = context.match(urlPattern);
  if (!urlMatch) throw new Error(`遷移先URLの取得に失敗: ${registrationPath}`);

  console.log(`   作成完了: ${urlMatch[0]}`);
  return { registrationPath, destinationUrl: urlMatch[0] };
}

// ===== Smart+ TikTok広告作成 =====

/** 動画のカバー画像URLを取得 */
async function getVideoCoverUrl(advertiserId: string, videoId: string): Promise<string | null> {
  console.log('5. カバー画像URL取得中...');
  for (let i = 0; i < 10; i++) {
    try {
      const data = await tiktokGet('/v1.3/file/video/ad/info/', {
        advertiser_id: advertiserId,
        video_ids: JSON.stringify([videoId]),
      });
      const video = data.data?.list?.[0];
      if (video?.video_cover_url) {
        console.log(`   カバー画像OK`);
        return video.video_cover_url;
      }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log('   カバー画像取得できず（続行）');
  return null;
}

/** カバー画像をアップロードしてweb_uriを返す */
async function uploadCoverImage(advertiserId: string, coverUrl: string): Promise<string | null> {
  try {
    const imgResp = await fetch(coverUrl);
    if (!imgResp.ok) return null;
    const buffer = Buffer.from(await imgResp.arrayBuffer());

    const FormData = require('form-data');
    const axios = require('axios');
    const form = new FormData();
    form.append('advertiser_id', advertiserId);
    form.append('upload_type', 'UPLOAD_BY_FILE');
    form.append('image_signature', crypto.createHash('md5').update(buffer).digest('hex'));
    form.append('image_file', buffer, { filename: `cover_${Date.now()}.jpg`, contentType: 'image/jpeg' });

    const resp = await axios.post(`${TIKTOK_API_BASE}/v1.3/file/image/ad/upload/`, form, {
      headers: { 'Access-Token': ACCESS_TOKEN, ...form.getHeaders() },
      timeout: 30000,
    });
    if (resp.data.code !== 0) return null;

    const webUri = resp.data.data?.web_uri || resp.data.data?.image_id;
    console.log(`   カバー画像アップロード完了: ${webUri}`);
    return webUri;
  } catch {
    return null;
  }
}

/** 既存Smart+広告からCTA IDを取得 */
async function getCtaId(advertiserId: string): Promise<string> {
  const data = await tiktokGet('/v1.3/smart_plus/ad/get/', {
    advertiser_id: advertiserId,
    page_size: '5',
  });
  const ads = data.data?.list || [];
  const ctaId = ads[0]?.ad_configuration?.call_to_action_id || '';
  console.log(`   CTA ID: ${ctaId}`);
  return ctaId;
}

async function createSmartPlusCampaign(advertiserId: string, adName: string): Promise<string> {
  console.log('6. Smart+キャンペーン作成中...');
  const data = await tiktokApi('/v1.3/smart_plus/campaign/create/', {
    advertiser_id: advertiserId,
    campaign_name: adName,
    objective_type: 'LEAD_GENERATION',
    budget_mode: 'BUDGET_MODE_INFINITE',
    budget_optimize_on: false,
    request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
  });
  const campaignId = String(data.data.campaign_id);
  console.log(`   キャンペーンID: ${campaignId}`);
  return campaignId;
}

async function createSmartPlusAdGroup(advertiserId: string, campaignId: string, pixelId: string, dailyBudget: number, ageGroups: string[] = ['AGE_25_34', 'AGE_35_44', 'AGE_45_54']): Promise<string> {
  const ageLabel = ageGroups.map(g => g.replace('AGE_', '').replace('_', '-')).join(', ');
  const excludedAudiences = EXCLUDED_AUDIENCE_MAP[advertiserId] || [];
  console.log(`7. Smart+広告グループ作成中... (日予算: ¥${dailyBudget}, 年齢: ${ageLabel}, 除外オーディエンス: ${excludedAudiences.length}件)`);

  const targetingSpec: any = {
    location_ids: ['1861060'],
    age_groups: ageGroups,
  };
  if (excludedAudiences.length > 0) {
    targetingSpec.excluded_audience_ids = excludedAudiences;
  }

  const data = await tiktokApi('/v1.3/smart_plus/adgroup/create/', {
    advertiser_id: advertiserId,
    campaign_id: campaignId,
    adgroup_name: `${getJstDateStr()} ${ageLabel}`,
    budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET',
    budget: dailyBudget,
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
    targeting_spec: targetingSpec,
    request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
  });
  const adgroupId = String(data.data.adgroup_id);
  console.log(`   広告グループID: ${adgroupId}`);

  // ターゲティング検証（5秒待ってからAPIで確認）
  console.log('   ターゲティング検証中（5秒待機）...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  try {
    const verifyResp = await tiktokGet('/v1.3/smart_plus/adgroup/get/', {
      advertiser_id: advertiserId,
      adgroup_ids: JSON.stringify([adgroupId]),
    });
    const actual = verifyResp.data?.list?.[0]?.targeting_spec;
    const actualAges = actual?.age_groups || [];
    const actualExcluded = actual?.excluded_audience_ids || [];
    const ageOk = ageGroups.every(g => actualAges.includes(g)) && actualAges.length === ageGroups.length;
    const excludeOk = excludedAudiences.length === 0 || excludedAudiences.every(id => actualExcluded.includes(id));

    if (!ageOk || !excludeOk) {
      console.log(`   ⚠ ターゲティング不一致検出 → 修正API実行`);
      console.log(`     年齢: 期待=${JSON.stringify(ageGroups)} 実際=${JSON.stringify(actualAges)}`);
      console.log(`     除外: 期待=${JSON.stringify(excludedAudiences)} 実際=${JSON.stringify(actualExcluded)}`);
      // Smart+ adgroup update で修正
      await tiktokApi('/v1.3/smart_plus/adgroup/update/', {
        advertiser_id: advertiserId,
        adgroup_id: adgroupId,
        targeting_spec: targetingSpec,
      });
      console.log('   ✅ ターゲティング修正完了');
      // 再度待機
      await new Promise(resolve => setTimeout(resolve, 3000));
    } else {
      console.log(`   ✅ ターゲティング検証OK（年齢: ${ageLabel}, 除外: ${actualExcluded.length}件）`);
    }
  } catch (verifyError: any) {
    console.log(`   ⚠ ターゲティング検証失敗（続行）: ${verifyError.message}`);
  }

  return adgroupId;
}

async function createSmartPlusAd(
  advertiserId: string, adgroupId: string, adName: string,
  videoId: string, coverWebUri: string | null, adText: string,
  landingPageUrl: string, identityId: string, identityBcId: string,
): Promise<string> {
  console.log('8. Smart+広告作成中...');

  const creativeInfo: any = {
    ad_format: 'SINGLE_VIDEO',
    video_info: { video_id: videoId },
    identity_id: identityId,
    identity_type: 'BC_AUTH_TT',
    identity_authorized_bc_id: identityBcId,
  };
  if (coverWebUri) {
    creativeInfo.image_info = [{ web_uri: coverWebUri }];
  }

  const ctaId = await getCtaId(advertiserId);

  const data = await tiktokApi('/v1.3/smart_plus/ad/create/', {
    advertiser_id: advertiserId,
    adgroup_id: adgroupId,
    ad_name: adName,
    creative_list: [{ creative_info: creativeInfo }],
    ad_text_list: [{ ad_text: adText }],
    landing_page_url_list: [{ landing_page_url: landingPageUrl }],
    ad_configuration: {
      call_to_action_id: ctaId,
    },
    operation_status: 'ENABLE',
    request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
  });
  const adId = String(data.data?.ad_id || data.data?.smart_plus_ad_id);
  console.log(`   広告ID: ${adId}`);
  return adId;
}

// ===== メイン =====
async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('使い方: npx tsx apps/backend/redeploy-ad.ts <advertiser_id> <source_ad_id> [daily_budget] [--age 25-44]');
    console.log('');
    console.log('例:');
    console.log('  npx tsx apps/backend/redeploy-ad.ts 7474920444831875080 1859709464799409');
    console.log('  npx tsx apps/backend/redeploy-ad.ts 7474920444831875080 1859709464799409 3000');
    console.log('  npx tsx apps/backend/redeploy-ad.ts 7474920444831875080 1859709464799409 3000 --age 25-44');
    process.exit(1);
  }

  const advertiserId = args[0];
  const sourceAdId = args[1];

  // --age オプション解析
  const ageIdx = args.indexOf('--age');
  let ageGroups = ['AGE_25_34', 'AGE_35_44', 'AGE_45_54']; // デフォルト 25-54
  if (ageIdx !== -1 && args[ageIdx + 1]) {
    const ageSpec = args[ageIdx + 1];
    if (ageSpec === '25-44') {
      ageGroups = ['AGE_25_34', 'AGE_35_44'];
    } else if (ageSpec === '25-34') {
      ageGroups = ['AGE_25_34'];
    } else if (ageSpec === '35-44') {
      ageGroups = ['AGE_35_44'];
    } else if (ageSpec === '25-54') {
      ageGroups = ['AGE_25_34', 'AGE_35_44', 'AGE_45_54'];
    } else {
      console.log(`⚠ 不明な年齢指定: ${ageSpec} → デフォルト(25-54)を使用`);
    }
  }
  // --age以外の位置引数からbudgetを取得
  const budgetArg = args[2] && args[2] !== '--age' ? parseInt(args[2]) : undefined;
  const budgetOverride = budgetArg && !isNaN(budgetArg) ? budgetArg : undefined;

  console.log(`===== 同一アカウント再出稿（Smart+） =====`);
  console.log(`アカウント: ${advertiserId}`);
  console.log(`元広告ID: ${sourceAdId}`);
  console.log(`年齢ターゲット: ${ageGroups.map(g => g.replace('AGE_', '').replace('_', '-')).join(', ')}`);
  console.log();

  // DB からアカウント情報取得
  const prisma = new PrismaClient();
  try {
    const advertiser = await prisma.advertiser.findUnique({
      where: { tiktokAdvertiserId: advertiserId },
      select: { pixelId: true, identityId: true, identityAuthorizedBcId: true, name: true },
    });
    if (!advertiser) throw new Error(`DBにアカウントが見つかりません: ${advertiserId}`);
    if (!advertiser.pixelId || !advertiser.identityId || !advertiser.identityAuthorizedBcId) {
      throw new Error(`アカウントにpixelId/identityId/bcIdが未設定です`);
    }
    console.log(`アカウント名: ${advertiser.name}`);
    const jstHour = getJstNow().getUTCHours();
    if (isAfter15Jst()) {
      console.log(`現在JST ${jstHour}時 → 15時以降のため翌日0時から配信開始`);
    } else {
      console.log(`現在JST ${jstHour}時 → 15時前のため本日付けで即配信開始`);
    }
    console.log(`配信開始: ${getJstScheduleTime()}`);
    console.log(`広告名日付: ${getJstDateStr()}\n`);

    // 1. 元広告情報取得
    const sourceAd = await getSourceAdInfo(advertiserId, sourceAdId);

    // 2. 広告名パース
    const { appeal, lpNumber, creator, crName } = parseAdInfo(sourceAd.adName, advertiserId);
    const dailyBudget = budgetOverride || DEFAULT_DAILY_BUDGET[appeal] || 3000;
    console.log(`   appeal: ${appeal}, LP: ${lpNumber}, 日予算: ¥${dailyBudget}\n`);

    // 3. UTAGE
    await utageLogin();
    const latestCr = await getLatestCrNumber(appeal, lpNumber);
    const newCrNumber = latestCr + 1;
    const { registrationPath, destinationUrl } = await createRegistrationPath(appeal, lpNumber, newCrNumber);

    // 4. 広告名生成
    const crStr = String(newCrNumber).padStart(5, '0');
    const adName = `${getJstDateStr()}/${creator}/${crName}/LP${lpNumber}-CR${crStr}`;
    const landingPageUrl = `${destinationUrl}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;
    console.log(`\n広告名: ${adName}`);
    console.log(`LP URL: ${landingPageUrl}\n`);

    // 5. カバー画像取得＆アップロード
    const coverUrl = await getVideoCoverUrl(advertiserId, sourceAd.videoId);
    let coverWebUri: string | null = null;
    if (coverUrl) {
      coverWebUri = await uploadCoverImage(advertiserId, coverUrl);
    }

    // 6-8. Smart+キャンペーン → 広告グループ → 広告
    const campaignId = await createSmartPlusCampaign(advertiserId, adName);
    const adgroupId = await createSmartPlusAdGroup(advertiserId, campaignId, advertiser.pixelId, dailyBudget, ageGroups);
    const adText = sourceAd.adText || DEFAULT_AD_TEXT[appeal] || '';
    const adId = await createSmartPlusAd(
      advertiserId, adgroupId, adName,
      sourceAd.videoId, coverWebUri, adText,
      landingPageUrl, advertiser.identityId, advertiser.identityAuthorizedBcId,
    );

    console.log('\n===== 再出稿完了 =====');
    console.log(`広告名: ${adName}`);
    console.log(`CR番号: CR${crStr}`);
    console.log(`UTAGE経路: ${registrationPath}`);
    console.log(`キャンペーンID: ${campaignId}`);
    console.log(`広告グループID: ${adgroupId}`);
    console.log(`広告ID: ${adId}`);
    console.log(`日予算: ¥${dailyBudget}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('\n===== エラー =====');
  console.error(err);
  process.exit(1);
});
