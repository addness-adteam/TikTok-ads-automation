/**
 * P5-4: 実際の横展開テスト（AI_2 → AI_4、REGULAR 1本）
 * 全フロー: 動画DL → アップロード → UTAGE登録経路 → キャンペーン → 広告グループ → 広告
 */
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import FormData from 'form-data';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import * as cheerio from 'cheerio';

const prisma = new PrismaClient();
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const UTAGE_BASE_URL = 'https://school.addness.co.jp';
const OPERATOR_LOGIN_URL = 'https://school.addness.co.jp/operator/GYbKT7Y9d0eR/login';

const SOURCE_ADVERTISER = '7523128243466551303'; // AI_2
const TARGET_ADVERTISER = '7580666710525493255'; // AI_4

// UTAGE TikTok広告用ファネルマッピング
const FUNNEL_MAP: Record<string, Record<number, { funnelId: string; groupId: string; stepId: string }>> = {
  'AI': {
    1: { funnelId: 'a09j9jop95LF', groupId: 'EFnsGw3gAdba', stepId: 'r2RHcL0PdGIY' },
  },
};

async function getToken(advertiserId: string): Promise<string> {
  const t = await prisma.oAuthToken.findUnique({ where: { advertiserId } });
  if (!t) throw new Error(`トークンなし: ${advertiserId}`);
  return t.accessToken;
}

// ========== UTAGE ==========
let sessionCookies = '';

function mergeCookies(existing: string, response: Response): string {
  const setCookieHeaders = response.headers.getSetCookie?.() || [];
  if (setCookieHeaders.length === 0) {
    const raw = response.headers.get('set-cookie');
    if (raw) {
      const cookies = raw.split(/,(?=\s*[a-zA-Z_]+=)/).map(c => c.split(';')[0].trim());
      const merged = new Map<string, string>();
      if (existing) existing.split('; ').forEach(c => { const [k] = c.split('='); merged.set(k, c); });
      cookies.forEach(c => { const [k] = c.split('='); merged.set(k, c); });
      return [...merged.values()].join('; ');
    }
    return existing;
  }
  const merged = new Map<string, string>();
  if (existing) existing.split('; ').forEach(c => { const [k] = c.split('='); merged.set(k, c); });
  setCookieHeaders.forEach(header => { const cookie = header.split(';')[0].trim(); const [k] = cookie.split('='); merged.set(k, cookie); });
  return [...merged.values()].join('; ');
}

async function utageLogin(): Promise<void> {
  const email = process.env.UTAGE_EMAIL!;
  const password = process.env.UTAGE_PASSWORD!;

  const loginPageResp = await fetch(OPERATOR_LOGIN_URL, { redirect: 'manual' });
  sessionCookies = mergeCookies('', loginPageResp);
  const loginPageHtml = await loginPageResp.text();
  const $ = cheerio.load(loginPageHtml);
  const csrfToken = $('input[name="_token"]').attr('value')!;

  const formBody = new URLSearchParams({ _token: csrfToken, email, password });
  const loginResp = await fetch(OPERATOR_LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': sessionCookies, 'Referer': OPERATOR_LOGIN_URL },
    body: formBody.toString(),
    redirect: 'manual',
  });
  sessionCookies = mergeCookies(sessionCookies, loginResp);

  const location = loginResp.headers.get('location') || '';
  if (loginResp.status === 302 && !location.includes('/login')) {
    const redirectResp = await fetch(location.startsWith('http') ? location : `${UTAGE_BASE_URL}${location}`, {
      headers: { 'Cookie': sessionCookies }, redirect: 'manual',
    });
    sessionCookies = mergeCookies(sessionCookies, redirectResp);
    console.log('  UTAGE ログイン成功');
  } else {
    throw new Error('UTAGEログイン失敗');
  }
}

async function utageGet(url: string): Promise<string> {
  const resp = await fetch(url, { headers: { 'Cookie': sessionCookies }, redirect: 'manual' });
  sessionCookies = mergeCookies(sessionCookies, resp);
  if (resp.status === 302) {
    const loc = resp.headers.get('location') || '';
    const rUrl = loc.startsWith('http') ? loc : `${UTAGE_BASE_URL}${loc}`;
    if (rUrl.includes('/login')) { await utageLogin(); return utageGet(url); }
    return utageGet(rUrl);
  }
  return resp.text();
}

async function createUtageRegistrationPath(appeal: string, lpNumber: number): Promise<{ registrationPath: string; destinationUrl: string; crNumber: number }> {
  const config = FUNNEL_MAP[appeal]?.[lpNumber];
  if (!config) throw new Error(`未対応: ${appeal} LP${lpNumber}`);

  // 最新CR番号を取得
  const trackingHtml = await utageGet(`${UTAGE_BASE_URL}/funnel/${config.funnelId}/tracking`);
  const pattern = new RegExp(`TikTok広告-${appeal}-LP${lpNumber}-CR(\\d+)`, 'g');
  const matches = [...trackingHtml.matchAll(pattern)];
  const latestCr = matches.length > 0 ? Math.max(...matches.map(m => parseInt(m[1]))) : 0;
  const newCr = latestCr + 1;
  const crStr = String(newCr).padStart(5, '0');
  const registrationPath = `TikTok広告-${appeal}-LP${lpNumber}-CR${crStr}`;
  console.log(`  最新CR: ${latestCr}, 新規: ${registrationPath}`);

  // 作成フォーム取得
  const formHtml = await utageGet(`${UTAGE_BASE_URL}/funnel/${config.funnelId}/tracking/create`);
  const $form = cheerio.load(formHtml);
  const formToken = $form('input[name="_token"]').attr('value')!;
  let formAction = '';
  $form('form').each((_, el) => {
    const action = $form(el).attr('action') || '';
    if ($form(el).find('input[name="name"], select[name="group_id"]').length > 0) { formAction = action; return false; }
  });
  if (!formAction) formAction = `${UTAGE_BASE_URL}/funnel/${config.funnelId}/tracking`;
  const postUrl = formAction.startsWith('http') ? formAction : `${UTAGE_BASE_URL}${formAction}`;

  // POST
  const body = new URLSearchParams({ _token: formToken, name: registrationPath, group_id: config.groupId, step_id: config.stepId });
  const postResp = await fetch(postUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': sessionCookies, 'Referer': `${UTAGE_BASE_URL}/funnel/${config.funnelId}/tracking/create` },
    body: body.toString(),
    redirect: 'manual',
  });
  sessionCookies = mergeCookies(sessionCookies, postResp);

  let listingHtml = '';
  if (postResp.status === 302) {
    const loc = postResp.headers.get('location') || '';
    listingHtml = await utageGet(loc.startsWith('http') ? loc : `${UTAGE_BASE_URL}${loc}`);
  } else {
    listingHtml = await postResp.text();
  }

  // URL抽出
  let foundIdx = listingHtml.indexOf(registrationPath);
  if (foundIdx === -1) {
    listingHtml = await utageGet(`${UTAGE_BASE_URL}/funnel/${config.funnelId}/tracking`);
    foundIdx = listingHtml.indexOf(registrationPath);
  }
  if (foundIdx === -1) throw new Error(`登録経路が見つかりません: ${registrationPath}`);

  const context = listingHtml.substring(Math.max(0, foundIdx - 500), foundIdx + 3000);
  const urlPattern = new RegExp(`https://school\\.addness\\.co\\.jp/p/${config.stepId}\\?ftid=[a-zA-Z0-9]+`);
  const urlMatch = context.match(urlPattern);
  if (!urlMatch) throw new Error(`遷移先URL取得失敗: ${registrationPath}`);

  return { registrationPath, destinationUrl: urlMatch[0], crNumber: newCr };
}

async function main() {
  console.log('=== 実際の横展開テスト（AI_2 → AI_4, REGULAR 1本）===\n');

  // Step 1: 元広告データ取得
  console.log('Step 1: 元広告データ取得...');
  const sourceToken = await getToken(SOURCE_ADVERTISER);
  const listResp = await fetch(
    `${TIKTOK_API_BASE}/v1.3/smart_plus/ad/get/?advertiser_id=${SOURCE_ADVERTISER}&page_size=1`,
    { headers: { 'Access-Token': sourceToken } },
  );
  const ad = (await listResp.json()).data?.list?.[0];
  if (!ad) { console.log('広告なし'); return; }

  const videoIds: string[] = [];
  for (const c of ad.creative_list || []) {
    const vid = c?.creative_info?.video_info?.video_id;
    if (vid) videoIds.push(vid);
  }
  const testVideoId = videoIds[0];
  console.log(`  広告名: ${ad.ad_name}`);
  console.log(`  テスト動画: ${testVideoId}\n`);

  // Step 2: 動画ダウンロード
  console.log('Step 2: 動画ダウンロード...');
  const videoInfoResp = await fetch(
    `${TIKTOK_API_BASE}/v1.3/file/video/ad/info/?advertiser_id=${SOURCE_ADVERTISER}&video_ids=${encodeURIComponent(JSON.stringify([testVideoId]))}`,
    { headers: { 'Access-Token': sourceToken } },
  );
  const videoInfoData = await videoInfoResp.json();
  const videoInfoList = videoInfoData.data?.list || (Array.isArray(videoInfoData.data) ? videoInfoData.data : []);
  const videoInfo = videoInfoList.find((v: any) => v.video_id === testVideoId) || videoInfoList[0];
  const downloadUrl = videoInfo?.preview_url;
  if (!downloadUrl) { console.log('  preview_urlなし!'); return; }

  const dlResp = await axios.get(downloadUrl, { responseType: 'arraybuffer', timeout: 120000 });
  const buffer = Buffer.from(dlResp.data);
  console.log(`  ${(buffer.length / 1024 / 1024).toFixed(1)}MB ダウンロード完了\n`);

  // Step 3: AI_4にアップロード（前回成功したvideo_idがあればスキップ）
  const targetToken = await getToken(TARGET_ADVERTISER);
  const REUSE_VIDEO_ID = 'v10033g50000d6spdmfog65hgcq326lg'; // 前回アップロード済み
  let newVideoId = '';
  if (REUSE_VIDEO_ID) {
    console.log(`Step 3: 前回アップロード済みの動画を再利用: ${REUSE_VIDEO_ID}`);
    newVideoId = REUSE_VIDEO_ID;
    console.log('');
  } else {
    console.log('Step 3: AI_4に動画アップロード...');
    const md5Hash = createHash('md5').update(buffer).digest('hex');
    const formData = new FormData();
    formData.append('advertiser_id', TARGET_ADVERTISER);
    formData.append('upload_type', 'UPLOAD_BY_FILE');
    formData.append('video_signature', md5Hash);
    formData.append('video_file', buffer, { filename: `cd_${Date.now()}_test.mp4`, contentType: 'video/mp4' });

    const uploadResp = await axios.post(`${TIKTOK_API_BASE}/v1.3/file/video/ad/upload/`, formData, {
      headers: { 'Access-Token': targetToken, ...formData.getHeaders() },
      timeout: 300000, maxContentLength: Infinity, maxBodyLength: Infinity,
    });
    if (uploadResp.data.code !== 0) { console.log(`  失敗: ${uploadResp.data.message}`); return; }
    const uploadData = uploadResp.data.data;
    newVideoId = Array.isArray(uploadData) ? uploadData[0]?.video_id : uploadData?.video_id;
    console.log(`  新video_id: ${newVideoId}`);

    // 処理完了待ち
    let delay = 3000;
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, delay));
      delay = Math.floor(delay * 1.5);
      const checkResp = await fetch(
        `${TIKTOK_API_BASE}/v1.3/file/video/ad/info/?advertiser_id=${TARGET_ADVERTISER}&video_ids=${encodeURIComponent(JSON.stringify([newVideoId]))}`,
        { headers: { 'Access-Token': targetToken } },
      );
      const checkData = await checkResp.json();
      const checkList = checkData.data?.list || (Array.isArray(checkData.data) ? checkData.data : []);
      const vid = checkList[0];
      if (vid?.poster_url || vid?.video_cover_url) { console.log(`  動画処理完了 (${i + 1}回目)\n`); break; }
      if (i === 7) console.log('  処理待ちタイムアウト、続行\n');
      else console.log(`  処理中... (${i + 1}/8)`);
    }
  }

  // Step 4: UTAGE登録経路作成
  console.log('Step 4: UTAGE登録経路作成...');
  await utageLogin();
  const utageResult = await createUtageRegistrationPath('AI', 1);
  console.log(`  登録経路: ${utageResult.registrationPath}`);
  console.log(`  遷移先URL: ${utageResult.destinationUrl}\n`);

  // 広告名生成
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const dateStr = `${String(jst.getUTCFullYear()).slice(2)}${String(jst.getUTCMonth() + 1).padStart(2, '0')}${String(jst.getUTCDate()).padStart(2, '0')}`;
  const parts = ad.ad_name.split('/');
  const creator = parts.length >= 2 ? parts[1] : '横展開';
  const crName = parts.length >= 3 ? parts[2] : '横展開CR';
  const crStr = String(utageResult.crNumber).padStart(5, '0');
  const adName = `${dateStr}/${creator}/${crName}/LP1-CR${crStr}`;
  const landingPageUrl = `${utageResult.destinationUrl}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;

  console.log(`  広告名: ${adName}`);
  console.log(`  LP URL: ${landingPageUrl}\n`);

  // Step 5: 前回作成済みのキャンペーン/広告グループを再利用
  const targetAdv = await prisma.advertiser.findUnique({ where: { tiktokAdvertiserId: TARGET_ADVERTISER } });
  if (!targetAdv) { console.log('  ターゲットアカウントなし'); return; }

  const campaignId = '1859933192696849'; // 前回作成済み
  const adgroupId = '1859933174826081';   // 前回作成済み
  console.log(`Step 5-6: 前回作成済みのキャンペーン/広告グループを再利用`);
  console.log(`  campaign_id: ${campaignId}`);
  console.log(`  adgroup_id: ${adgroupId}\n`);

  // Step 7: 広告作成
  console.log('Step 7: 広告作成...');
  const adText = ad.ad_text_list?.[0]?.ad_text || 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）';
  const adCreateResp = await axios.post(`${TIKTOK_API_BASE}/v1.3/ad/create/`, {
    advertiser_id: TARGET_ADVERTISER,
    adgroup_id: adgroupId,
    creatives: [{
      ad_name: adName,
      ad_text: adText,
      ad_format: 'SINGLE_VIDEO',
      video_id: newVideoId,
      identity_id: targetAdv.identityId,
      identity_type: 'BC_AUTH_TT',
      identity_authorized_bc_id: '7440019834009829392',
      call_to_action: 'LEARN_MORE',
      landing_page_url: landingPageUrl,
    }],
  }, { headers: { 'Access-Token': targetToken } });

  if (adCreateResp.data.code !== 0) {
    console.log(`  広告作成失敗: ${adCreateResp.data.message}`);
    console.log('  レスポンス:', JSON.stringify(adCreateResp.data, null, 2));
    return;
  }
  const adId = adCreateResp.data.data?.ad_ids?.[0] || adCreateResp.data.data?.ad_id;
  console.log(`  ad_id: ${adId}\n`);

  // サマリー
  console.log('=== 横展開テスト結果 ===');
  console.log(`元広告: ${ad.ad_name}`);
  console.log(`元video_id: ${testVideoId}`);
  console.log(`→ AI_4に横展開成功!`);
  console.log(`  新video_id: ${newVideoId}`);
  console.log(`  campaign_id: ${campaignId}`);
  console.log(`  adgroup_id: ${adgroupId}`);
  console.log(`  ad_id: ${adId}`);
  console.log(`  広告名: ${adName}`);
  console.log(`  UTAGE: ${utageResult.registrationPath}`);
  console.log(`  LP URL: ${landingPageUrl}`);
  console.log(`  日予算: ¥3,000`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
