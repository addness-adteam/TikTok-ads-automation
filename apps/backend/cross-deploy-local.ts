/**
 * ローカル実行用の横展開スクリプト
 * Vercelのタイムアウトを回避して、動画+画像混合のSmart+広告を横展開する
 *
 * 使い方:
 *   npx tsx apps/backend/cross-deploy-local.ts <source_advertiser_id> <source_ad_id> <target_advertiser_id> [daily_budget]
 *
 * 例:
 *   npx tsx apps/backend/cross-deploy-local.ts 7474920444831875080 1859608524699041 7592868952431362066
 *   npx tsx apps/backend/cross-deploy-local.ts 7474920444831875080 1859608524699041 7592868952431362066 5000
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
  'AI': 3000, 'SNS': 3000, 'スキルプラス': 5000,
};

const DEFAULT_AD_TEXT: Record<string, string> = {
  'AI': 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）',
  'SNS': 'SNSで独立するなら学んでおきたい本質のSNSマーケ特商法（https://skill.addness.co.jp/tokushoho）',
  'スキルプラス': 'スキルで独立するなら学んでおきたい本質のスキル活用術特商法（https://skill.addness.co.jp/tokushoho）',
};

const ACCOUNT_APPEAL_MAP: Record<string, string> = {
  '7468288053866561553': 'AI', '7523128243466551303': 'AI',
  '7543540647266074641': 'AI', '7580666710525493255': 'AI',
  '7247073333517238273': 'SNS', '7543540100849156112': 'SNS', '7543540381615800337': 'SNS',
  '7474920444831875080': 'スキルプラス', '7592868952431362066': 'スキルプラス', '7616545514662051858': 'スキルプラス',
};

// 除外オーディエンス: アカウントごとのTikTok用除外オーディエンスID
const EXCLUSION_AUDIENCE_MAP: Record<string, string> = {
  '7468288053866561553': '194405484', // AI_1
  '7523128243466551303': '194405486', // AI_2
  '7543540647266074641': '194405488', // AI_3
  '7580666710525493255': '194416060', // AI_4（名前: TikTok除外リスト）
};

// AI導線のオプトイン除外オーディエンス（全アカウント共通ID）
const AI_OPTIN_EXCLUSION_AUDIENCE_ID = '194977234';

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
  // 現在UTCから5分後を開始時刻とする（TikTok APIはUTCで受け取る）
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

// ===== 元広告情報取得（Smart+対応） =====
async function getSourceAdDetail(advertiserId: string, adId: string) {
  console.log('1. 元広告の情報を取得中...');

  const spData = await tiktokGet('/v1.3/smart_plus/ad/get/', {
    advertiser_id: advertiserId,
    filtering: JSON.stringify({ smart_plus_ad_ids: [adId] }),
  });
  const ad = spData.data?.list?.[0];
  if (!ad) throw new Error(`Smart+広告が見つかりません: ${adId}`);

  const adName = ad.smart_plus_ad_name || ad.ad_name || '';
  const creativeList = ad.creative_list || [];

  // creative_listから動画IDと画像IDを抽出
  const videoIds: string[] = [];
  const imageIds: string[] = [];

  for (const creative of creativeList) {
    const ci = creative?.creative_info;
    if (ci?.ad_format === 'CAROUSEL_ADS') {
      const imgs = ci?.image_info || [];
      for (const img of imgs) {
        if (img.web_uri) imageIds.push(img.web_uri);
      }
    } else {
      const videoId = ci?.video_info?.video_id;
      if (videoId && videoId !== 'N/A') videoIds.push(videoId);
    }
  }

  // video_idが'N/A'の場合フォールバック: ad/get API
  if (videoIds.length === 0 && creativeList.length > 0) {
    console.log('   creative_listからvideo_id取得失敗、ad/getでフォールバック...');
    try {
      const adResp = await tiktokGet('/v1.3/ad/get/', {
        advertiser_id: advertiserId,
        filtering: JSON.stringify({ ad_ids: [adId] }),
        fields: JSON.stringify(['ad_id', 'video_id']),
      });
      for (const a of (adResp.data?.list || [])) {
        if (a.video_id) videoIds.push(a.video_id);
      }
    } catch { /* ignore */ }
  }

  // Smart+のcreative_listにvideo_id=N/Aが含まれる場合、
  // creative_listに対応するtiktok_item_idで再取得
  if (videoIds.length === 0 && creativeList.length > 0) {
    console.log('   ad/getフォールバックも失敗、creative_listのtiktok_item_idを確認...');
    for (const creative of creativeList) {
      const tiktokItemId = creative?.tiktok_item_id;
      if (tiktokItemId) videoIds.push(tiktokItemId);
    }
  }

  // Smart+の広告から直接video_idリストを取得するフォールバック
  if (videoIds.length === 0 && creativeList.length > 0) {
    console.log('   最終フォールバック: ad_configurationからvideo情報を検索...');
    // creativeのvideo_infoからvideo_idを探索（入れ子構造が異なる場合）
    for (const creative of creativeList) {
      const ci = creative?.creative_info;
      // video_idが直接格納されている場合
      if (ci?.video_id && ci.video_id !== 'N/A') videoIds.push(ci.video_id);
      // tiktok_item_idフォールバック
      if (ci?.tiktok_item_id) videoIds.push(ci.tiktok_item_id);
    }
  }

  // 広告文
  const adTexts: string[] = (ad.ad_text_list || []).map((t: any) => t.ad_text).filter(Boolean);
  // LP URL
  const landingPageUrls: string[] = (ad.landing_page_url_list || []).map((l: any) => l.landing_page_url).filter(Boolean);

  console.log(`   広告名: ${adName}`);
  console.log(`   動画: ${videoIds.length}本, 画像: ${imageIds.length}枚`);

  return { adName, videoIds, imageIds, adTexts, landingPageUrls };
}

// ===== メディアダウンロード・アップロード =====
async function downloadAndUploadVideos(
  sourceAdvertiserId: string, targetAdvertiserId: string, videoIds: string[],
): Promise<Record<string, string>> {
  if (videoIds.length === 0) return {};

  console.log(`\n2a. 動画 ${videoIds.length}本をダウンロード → ターゲットにアップロード...`);

  // 動画情報取得
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
    console.log(`   ${(buffer.length / 1024 / 1024).toFixed(1)}MB ダウンロード完了`);

    // アップロード
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
    // data が配列の場合は data[0].video_id、オブジェクトの場合は data.video_id
    const newVideoId = Array.isArray(respData)
      ? respData[0]?.video_id
      : (respData.video_id || respData.id);
    if (!newVideoId) {
      throw new Error(`動画アップロード後のvideo_idが取得できません: ${JSON.stringify(respData).substring(0, 200)}`);
    }
    mapping[videoId] = newVideoId;
    console.log(`   アップロード完了 → ${newVideoId}`);

    // 動画の処理完了を待ち、カバー画像をアップロード
    const coverUrl = await waitForVideoReady(targetAdvertiserId, newVideoId);
    if (coverUrl) {
      const coverImageId = await uploadCoverImage(targetAdvertiserId, coverUrl, newVideoId);
      if (coverImageId) videoCoverMap.set(newVideoId, coverImageId);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  return mapping;
}

/** 動画の処理完了を待ち、video_cover_urlを返す */
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
  console.log(`   ⚠ サムネイル生成待ちタイムアウト（続行）`);
  return null;
}

// video_id → cover_image_id のマッピングを保持
const videoCoverMap = new Map<string, string>();

/** ターゲットアカウントのCTA IDを既存Smart+広告から取得 */
const ctaCache = new Map<string, string>();
async function getCtaId(advertiserId: string): Promise<string> {
  if (ctaCache.has(advertiserId)) return ctaCache.get(advertiserId)!;
  const data = await tiktokGet('/v1.3/smart_plus/ad/get/', {
    advertiser_id: advertiserId,
    page_size: '5',
  });
  const ads = data.data?.list || [];
  const ctaId = ads[0]?.ad_configuration?.call_to_action_id || '';
  console.log(`   CTA ID: ${ctaId} (既存広告から取得)`);
  ctaCache.set(advertiserId, ctaId);
  return ctaId;
}

/** サムネイルURLをダウンロードしてターゲットアカウントにimage uploadし、image_idを返す */
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
    if (uploadResp.data.code !== 0) {
      console.log(`   ⚠ カバー画像アップロード失敗: ${uploadResp.data.message}`);
      return null;
    }
    const respData = uploadResp.data.data;
    const imageId = Array.isArray(respData) ? respData[0]?.image_id : respData.image_id;
    console.log(`   カバー画像アップロード完了 → ${imageId}`);
    return imageId;
  } catch (e: any) {
    console.log(`   ⚠ カバー画像処理エラー: ${e.message}`);
    return null;
  }
}

async function downloadAndUploadImages(
  sourceAdvertiserId: string, targetAdvertiserId: string, imageIds: string[],
): Promise<Record<string, string>> {
  if (imageIds.length === 0) return {};

  console.log(`\n2b. 画像 ${imageIds.length}枚をダウンロード → ターゲットにアップロード...`);

  // 画像情報取得
  const imageInfoData = await tiktokGet('/v1.3/file/image/ad/info/', {
    advertiser_id: sourceAdvertiserId,
    image_ids: JSON.stringify(imageIds),
  });
  const imageInfos = imageInfoData.data?.list || [];

  const FormData = require('form-data');
  const axios = require('axios');
  const mapping: Record<string, string> = {};

  for (let i = 0; i < imageIds.length; i++) {
    const imageId = imageIds[i];
    const info = imageInfos.find((img: any) => img.image_id === imageId);
    const imageUrl = info?.image_url;
    if (!imageUrl) throw new Error(`画像 ${imageId} のURLが取得できません`);

    console.log(`   [${i + 1}/${imageIds.length}] ${imageId} ダウンロード中...`);
    const imgResp = await fetch(imageUrl);
    const buffer = Buffer.from(await imgResp.arrayBuffer());

    // アップロード
    const md5Hash = crypto.createHash('md5').update(buffer).digest('hex');
    const form = new FormData();
    form.append('advertiser_id', targetAdvertiserId);
    form.append('upload_type', 'UPLOAD_BY_FILE');
    form.append('image_signature', md5Hash);
    form.append('image_file', buffer, { filename: `cross_deploy_${Date.now()}_${imageId.split('/').pop()}.jpg`, contentType: 'image/jpeg' });

    const uploadResp = await axios.post(`${TIKTOK_API_BASE}/v1.3/file/image/ad/upload/`, form, {
      headers: { 'Access-Token': ACCESS_TOKEN, ...form.getHeaders() },
      timeout: 30000,
    });
    if (uploadResp.data.code !== 0) throw new Error(`画像アップロード失敗: ${uploadResp.data.message}`);
    const newImageId = uploadResp.data.data.image_id;
    mapping[imageId] = newImageId;
    console.log(`   アップロード完了 → ${newImageId}`);
    await new Promise(r => setTimeout(r, 200));
  }

  return mapping;
}

// ===== UTAGE =====
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

  console.log(`4. 最新CR番号を取得中... (${appeal} LP${lpNumber})`);
  const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${config.funnelId}/tracking`);

  const pattern = new RegExp(`TikTok広告-${appeal}-LP${lpNumber}-CR(0\\d{4})`, 'g');
  const matches = [...html.matchAll(pattern)];
  if (matches.length === 0) { console.log('   既存の登録経路なし、CR00001から開始'); return 0; }

  const crNumbers = matches.map(m => parseInt(m[1])).sort((a, b) => b - a);
  console.log(`   最新CR番号: CR${String(crNumbers[0]).padStart(5, '0')} (${matches.length}件中)`);
  return crNumbers[0];
}

async function createRegistrationPath(appeal: string, lpNumber: number, crNumber: number): Promise<{ registrationPath: string; destinationUrl: string }> {
  const config = TIKTOK_FUNNEL_MAP[appeal]![lpNumber]!;
  const crStr = String(crNumber).padStart(5, '0');
  const registrationPath = `TikTok広告-${appeal}-LP${lpNumber}-CR${crStr}`;
  console.log(`5. UTAGE登録経路作成中: ${registrationPath}`);

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
  if (foundIdx === -1) throw new Error(`作成した登録経路が見つかりません: ${registrationPath}`);

  const context = foundHtml.substring(Math.max(0, foundIdx - 500), foundIdx + 3000);
  const urlPattern = new RegExp(`https://school\\.addness\\.co\\.jp/p/${config.stepId}\\?ftid=[a-zA-Z0-9]+`);
  const urlMatch = context.match(urlPattern);
  if (!urlMatch) throw new Error(`遷移先URLの取得に失敗: ${registrationPath}`);

  console.log(`   作成完了: ${urlMatch[0]}`);
  return { registrationPath, destinationUrl: urlMatch[0] };
}

// ===== Smart+広告作成 =====
async function createSmartPlusCampaign(advertiserId: string, campaignName: string): Promise<string> {
  console.log('7. Smart+キャンペーン作成中...');
  const requestId = String(Date.now()) + String(Math.floor(Math.random() * 100000));
  const data = await tiktokApi('/v1.3/smart_plus/campaign/create/', {
    advertiser_id: advertiserId,
    campaign_name: campaignName,
    objective_type: 'LEAD_GENERATION',
    budget_mode: 'BUDGET_MODE_INFINITE',
    budget_optimize_on: false,
    request_id: requestId,
  });
  const campaignId = String(data.data.campaign_id);
  console.log(`   キャンペーンID: ${campaignId}`);
  return campaignId;
}

async function createSmartPlusAdGroup(
  advertiserId: string, campaignId: string, pixelId: string, budget: number, appeal?: string,
): Promise<string> {
  console.log(`8. Smart+広告グループ作成中... (日予算: ¥${budget})`);

  // 除外オーディエンス構築
  const excludedAudiences: string[] = [];
  const exclusionId = EXCLUSION_AUDIENCE_MAP[advertiserId];
  if (exclusionId) excludedAudiences.push(exclusionId);
  if (appeal === 'AI') excludedAudiences.push(AI_OPTIN_EXCLUSION_AUDIENCE_ID);

  const targetingSpec: any = {
    location_ids: ['1861060'],
    age_groups: ['AGE_25_34', 'AGE_35_44', 'AGE_45_54'],
  };
  if (excludedAudiences.length > 0) {
    targetingSpec.excluded_custom_audience_ids = excludedAudiences;
  }

  console.log(`   除外オーディエンス: ${excludedAudiences.length > 0 ? excludedAudiences.join(', ') : 'なし'}`);

  const data = await tiktokApi('/v1.3/smart_plus/adgroup/create/', {
    advertiser_id: advertiserId,
    campaign_id: campaignId,
    adgroup_name: `${getJstDateStr()} 25-54`,
    budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET',
    budget: budget,
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
  console.log(`   広告グループID: ${adgroupId}`);
  return adgroupId;
}

async function createSmartPlusAd(
  advertiserId: string, adgroupId: string, adName: string,
  videoMapping: Record<string, string>, imageMapping: Record<string, string>,
  identityId: string, identityBcId: string, adTexts: string[], landingPageUrl: string,
): Promise<string> {
  const videoCount = Object.keys(videoMapping).length;
  const imageCount = Object.keys(imageMapping).length;
  console.log(`9. Smart+広告作成中... (動画${videoCount}本 + 画像${imageCount}枚)`);

  // creative_list: 動画 + 画像を混合
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
    // Smart+動画広告にはカバー画像（image_info）が必須 — web_uriで指定
    if (coverImageId) {
      creativeInfo.image_info = [{ web_uri: coverImageId }];
    }
    creative_list.push({ creative_info: creativeInfo });
  }

  for (const newImageId of Object.values(imageMapping)) {
    creative_list.push({
      creative_info: {
        ad_format: 'CAROUSEL_ADS',
        image_info: [{ web_uri: newImageId }],
        identity_id: identityId,
        identity_type: 'BC_AUTH_TT',
        identity_authorized_bc_id: identityBcId,
        music_info: { music_id: '6954068488952498177' },
      },
    });
  }

  const data = await tiktokApi('/v1.3/smart_plus/ad/create/', {
    advertiser_id: advertiserId,
    adgroup_id: adgroupId,
    ad_name: adName,
    creative_list,
    ad_text_list: adTexts.map(text => ({ ad_text: text })),
    landing_page_url_list: [{ landing_page_url: landingPageUrl }],
    ad_configuration: {
      call_to_action_id: await getCtaId(advertiserId),
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
  if (args.length < 3) {
    console.log('使い方: npx tsx apps/backend/cross-deploy-local.ts <source_advertiser_id> <source_ad_id> <target_advertiser_id> [daily_budget]');
    console.log('');
    console.log('例:');
    console.log('  npx tsx apps/backend/cross-deploy-local.ts 7474920444831875080 1859608524699041 7592868952431362066');
    console.log('  npx tsx apps/backend/cross-deploy-local.ts 7474920444831875080 1859608524699041 7592868952431362066 5000');
    process.exit(1);
  }

  const sourceAdvertiserId = args[0];
  const sourceAdId = args[1];
  const targetAdvertiserId = args[2];
  const budgetOverride = args[3] ? parseInt(args[3]) : undefined;

  console.log('===== Smart+横展開（ローカル実行） =====');
  console.log(`元アカウント: ${sourceAdvertiserId}`);
  console.log(`元広告ID: ${sourceAdId}`);
  console.log(`展開先: ${targetAdvertiserId}`);
  console.log();

  const prisma = new PrismaClient();
  try {
    // ターゲットアカウント情報取得
    const targetAdvertiser = await prisma.advertiser.findUnique({
      where: { tiktokAdvertiserId: targetAdvertiserId },
      select: { pixelId: true, identityId: true, identityAuthorizedBcId: true, name: true },
    });
    if (!targetAdvertiser) throw new Error(`DBにアカウントが見つかりません: ${targetAdvertiserId}`);
    if (!targetAdvertiser.pixelId || !targetAdvertiser.identityId) {
      throw new Error('アカウントにpixelId/identityIdが未設定です');
    }
    console.log(`展開先アカウント名: ${targetAdvertiser.name}\n`);

    // 1. 元広告情報取得
    const source = await getSourceAdDetail(sourceAdvertiserId, sourceAdId);

    // appeal/LP推定
    const lpMatch = source.adName.match(/LP(\d+)/i);
    const lpNumber = lpMatch ? parseInt(lpMatch[1]) : 1;
    let appeal = ACCOUNT_APPEAL_MAP[sourceAdvertiserId] || 'AI';
    if (source.adName.includes('SNS') || source.adName.includes('sns')) appeal = 'SNS';
    else if (source.adName.includes('スキル') || source.adName.includes('セミナー')) appeal = 'スキルプラス';

    const dailyBudget = budgetOverride || DEFAULT_DAILY_BUDGET[appeal] || 3000;
    console.log(`   appeal: ${appeal}, LP: ${lpNumber}, 日予算: ¥${dailyBudget}`);

    // 2. メディアダウンロード＆アップロード
    const videoMapping = await downloadAndUploadVideos(sourceAdvertiserId, targetAdvertiserId, source.videoIds);
    const imageMapping = await downloadAndUploadImages(sourceAdvertiserId, targetAdvertiserId, source.imageIds);

    // 3. UTAGE
    await utageLogin();
    const latestCr = await getLatestCrNumber(appeal, lpNumber);
    const newCrNumber = latestCr + 1;
    const { registrationPath, destinationUrl } = await createRegistrationPath(appeal, lpNumber, newCrNumber);

    // 6. 広告名生成
    const parts = source.adName.split('/');
    const creator = parts.length >= 2 ? parts[1] : '横展開';
    const crName = parts.length >= 3 ? parts[2] : '横展開CR';
    const crStr = String(newCrNumber).padStart(5, '0');
    const adName = `${getJstDateStr()}/${creator}/${crName}/LP${lpNumber}-CR${crStr}`;
    const landingPageUrl = `${destinationUrl}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;

    console.log(`\n6. 広告名: ${adName}`);
    console.log(`   LP URL: ${landingPageUrl}\n`);

    // 7-9. Smart+キャンペーン → 広告グループ → 広告
    const campaignId = await createSmartPlusCampaign(targetAdvertiserId, adName);
    const adgroupId = await createSmartPlusAdGroup(targetAdvertiserId, campaignId, targetAdvertiser.pixelId, dailyBudget, appeal);
    const adTexts = source.adTexts.length > 0 ? source.adTexts : [DEFAULT_AD_TEXT[appeal] || ''];
    const adId = await createSmartPlusAd(
      targetAdvertiserId, adgroupId, adName,
      videoMapping, imageMapping, targetAdvertiser.identityId, targetAdvertiser.identityAuthorizedBcId || '', adTexts, landingPageUrl,
    );

    console.log('\n===== 横展開完了 =====');
    console.log(`広告名: ${adName}`);
    console.log(`CR番号: CR${crStr}`);
    console.log(`UTAGE経路: ${registrationPath}`);
    console.log(`キャンペーンID: ${campaignId}`);
    console.log(`広告グループID: ${adgroupId}`);
    console.log(`広告ID: ${adId}`);
    console.log(`日予算: ¥${dailyBudget}`);
    console.log(`動画: ${Object.keys(videoMapping).length}本, 画像: ${Object.keys(imageMapping).length}枚`);

    // 仮説検証を自動登録
    try {
      const sourceAccName = Object.entries(ACCOUNT_APPEAL_MAP).find(([id]) => id === sourceAdvertiserId)?.[0] || sourceAdvertiserId;
      const targetAccName = targetAdvertiser.name || targetAdvertiserId;
      const hypothesis = `${source.adName}を${targetAccName}に横展開。元アカウントでの実績を基に、横展開先でも同等の成績が出るか検証`;
      await prisma.hypothesisTest.create({
        data: {
          channelType: appeal === 'スキルプラス' ? 'SKILL_PLUS' : appeal,
          hypothesis,
          status: 'RUNNING',
          adId: adId,
          adName: adName,
          account: targetAccName,
        },
      });
      console.log(`\n📋 仮説検証を登録しました（自動追跡開始）`);
    } catch (e: any) {
      console.log(`\n⚠ 仮説登録スキップ: ${e.message}`);
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
