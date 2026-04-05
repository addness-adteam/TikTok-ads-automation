/**
 * SNS CR横展開 - 動画アップロード済みから再開
 * video_idは取得済み、UTAGE→キャンペーン→広告グループ→広告を作成
 */
import axios from 'axios';
import * as crypto from 'crypto';

const TIKTOK_API = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

const TARGET_ADVERTISER_ID = '7543540100849156112'; // SNS2
const TARGET_PIXEL_ID = '7388088697557663760';
const TARGET_IDENTITY_ID = '6fac7e18-0297-5ad3-9849-1de69197cd95';
const TARGET_BC_ID = '7440019834009829392';

// アップロード済みの動画ID
const deploys = [
  {
    label: 'CR00579 問題ないです/ひったくりVer',
    sourceAdName: '251106/村上幸太朗/問題ないです/ひったくりVer_リール投稿/LP1-CR00579',
    sourceAdText: 'SNSで独立するなら学んでおきたい本質のSNSマーケ特商法（https://skill.addness.co.jp/tokushoho）',
    newVideoId: 'v10033g50000d6u2grfog65snqg2788g',
    // 既に作成済み
    campaignId: '1860110657721361',
    thumbnailImageId: 'ad-site-i18n-sg/20260319c7c75e166cc3e9dd4c9590c4',
    adName: '260320/村上幸太朗/問題ないです/LP1-CR29527',
    utageRegistrationPath: 'TikTok広告-SNS-LP1-CR29527',
    utageDestinationUrl: 'https://school.addness.co.jp/p/wZhilaQY1Huv?ftid=9x9ebuGVTPWc',
    crNumber: 29527,
  },
  {
    label: 'CR00567 マジで意味ないです冒頭11',
    sourceAdName: '251103/清水絢吾/マジで意味ないです冒頭11/LP1-CR00567',
    sourceAdText: 'SNSで独立するなら学んでおきたい本質のSNSマーケ特商法（https://skill.addness.co.jp/tokushoho）',
    newVideoId: 'v10033g50000d6u2iofog65sbem965g0',
    campaignId: '1860110669108226',
    thumbnailImageId: 'ad-site-i18n-sg/20260319c7c7b479801f8a184d70ae7f',
    adName: '260320/清水絢吾/マジで意味ないです冒頭11/LP1-CR29528',
    utageRegistrationPath: 'TikTok広告-SNS-LP1-CR29528',
    utageDestinationUrl: 'https://school.addness.co.jp/p/wZhilaQY1Huv?ftid=851wLWoUUILJ',
    crNumber: 29528,
  },
  {
    label: 'CR00566 マジで意味ないです冒頭12',
    sourceAdName: '251103/清水絢吾/マジで意味ないです冒頭12/LP1-CR00566',
    sourceAdText: 'SNSで独立するなら学んでおきたい本質のSNSマーケ特商法（https://skill.addness.co.jp/tokushoho）',
    newVideoId: 'v10033g50000d6u2o8fog65ja1p28gng',
    campaignId: '1860110632160338',
    thumbnailImageId: 'ad-site-i18n-sg/20260319c7c7949afed9d3ac476c9c5c',
    adName: '260320/清水絢吾/マジで意味ないです冒頭12/LP1-CR29529',
    utageRegistrationPath: 'TikTok広告-SNS-LP1-CR29529',
    utageDestinationUrl: 'https://school.addness.co.jp/p/wZhilaQY1Huv?ftid=ZAgvQyhsHSTN',
    crNumber: 29529,
  },
];

async function tiktokGet(path: string, params: any) {
  const res = await axios.get(`${TIKTOK_API}${path}`, {
    headers: { 'Access-Token': ACCESS_TOKEN },
    params,
  });
  return res.data;
}

async function tiktokPost(path: string, data: any) {
  const res = await axios.post(`${TIKTOK_API}${path}`, data, {
    headers: { 'Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' },
  });
  return res.data;
}

// 動画情報確認（ステータス含む）
async function checkVideoStatus(videoId: string) {
  const resp = await tiktokGet('/v1.3/file/video/ad/info/', {
    advertiser_id: TARGET_ADVERTISER_ID,
    video_ids: JSON.stringify([videoId]),
  });
  const video = resp.data?.list?.[0];
  console.log(`    video_id=${videoId}: status=${video?.video_status}, displayable=${video?.displayable}`);
  return video;
}

// サムネイルアップロード
async function uploadThumbnail(videoId: string): Promise<string> {
  const resp = await tiktokGet('/v1.3/file/video/ad/info/', {
    advertiser_id: TARGET_ADVERTISER_ID,
    video_ids: JSON.stringify([videoId]),
  });
  const coverUrl = resp.data?.list?.[0]?.video_cover_url;
  if (!coverUrl) throw new Error('No video cover URL');

  const imgBuffer = await axios.get(coverUrl, { responseType: 'arraybuffer', timeout: 60000 });
  const imgData = Buffer.from(imgBuffer.data);

  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('advertiser_id', TARGET_ADVERTISER_ID);
  form.append('upload_type', 'UPLOAD_BY_FILE');
  form.append('image_file', imgData, { filename: `thumb_${videoId}.jpg`, contentType: 'image/jpeg' });
  form.append('image_signature', crypto.createHash('md5').update(imgData).digest('hex'));
  form.append('file_name', `thumb_${videoId}.jpg`);

  const uploadResp = await axios.post(`${TIKTOK_API}/v1.3/file/image/ad/upload/`, form, {
    headers: { 'Access-Token': ACCESS_TOKEN, ...form.getHeaders() },
    timeout: 60000,
  });

  const imageId = uploadResp.data?.data?.image_id;
  if (!imageId) throw new Error(`Image upload failed: ${JSON.stringify(uploadResp.data).substring(0, 200)}`);
  return imageId;
}

// ======= UTAGE直接操作 =======
import * as dotenv from 'dotenv';
dotenv.config();

const UTAGE_BASE_URL = 'https://school.addness.co.jp';
const OPERATOR_LOGIN_URL = 'https://school.addness.co.jp/operator/GYbKT7Y9d0eR/login';
const SNS_LP1_CONFIG = { funnelId: 'dZNDzwCgHNBC', groupId: '32FwkcHtFSuj', stepId: 'wZhilaQY1Huv' };

let sessionCookies = '';
let csrfToken = '';

function mergeCookies(existing: string, resp: Response): string {
  const raw = resp.headers.get('set-cookie');
  if (!raw) return existing;
  const cookies = raw.split(/,(?=\s*[a-zA-Z_]+=)/).map(c => c.split(';')[0].trim());
  const merged = new Map<string, string>();
  if (existing) existing.split('; ').forEach(c => { const [k] = c.split('='); merged.set(k, c); });
  cookies.forEach(c => { const [k] = c.split('='); merged.set(k, c); });
  return [...merged.values()].join('; ');
}

function extractCsrfToken(html: string): string {
  const m = html.match(/<input[^>]+name=["']_token["'][^>]+value=["']([^"']+)["']/);
  if (m) return m[1];
  const m2 = html.match(/value=["']([^"']+)["'][^>]+name=["']_token["']/);
  if (m2) return m2[1];
  const m3 = html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/);
  if (m3) return m3[1];
  throw new Error('CSRFトークン取得失敗');
}

async function utageLogin() {
  const email = process.env.UTAGE_EMAIL;
  const password = process.env.UTAGE_PASSWORD;
  if (!email || !password) throw new Error('UTAGE_EMAIL/UTAGE_PASSWORD未設定');

  console.log('  UTAGE: ログイン中...');
  const loginPage = await fetch(OPERATOR_LOGIN_URL, { redirect: 'manual' });
  sessionCookies = mergeCookies('', loginPage);
  const html = await loginPage.text();
  csrfToken = extractCsrfToken(html);

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
    const redirectUrl = location.startsWith('http') ? location : `${UTAGE_BASE_URL}${location}`;
    const rResp = await fetch(redirectUrl, { headers: { 'Cookie': sessionCookies }, redirect: 'manual' });
    sessionCookies = mergeCookies(sessionCookies, rResp);
    console.log('  UTAGE: ログイン成功');
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

async function createUtageRegistrationPath(): Promise<{ registrationPath: string; destinationUrl: string; crNumber: number }> {
  if (!sessionCookies) await utageLogin();

  // 最新CR番号取得
  const trackingHtml = await utageGet(`${UTAGE_BASE_URL}/funnel/${SNS_LP1_CONFIG.funnelId}/tracking`);
  const pattern = /TikTok広告-SNS-LP1-CR(\d+)/g;
  const matches = [...trackingHtml.matchAll(pattern)];
  const latestCr = matches.length > 0 ? Math.max(...matches.map(m => parseInt(m[1]))) : 0;
  const newCr = latestCr + 1;
  const crStr = String(newCr).padStart(5, '0');
  const registrationPath = `TikTok広告-SNS-LP1-CR${crStr}`;
  console.log(`    最新CR: ${latestCr} → 新規: ${registrationPath}`);

  // 作成フォームページ取得
  const formHtml = await utageGet(`${UTAGE_BASE_URL}/funnel/${SNS_LP1_CONFIG.funnelId}/tracking/create`);
  let formToken: string;
  try { formToken = extractCsrfToken(formHtml); } catch { formToken = csrfToken; }

  // フォームのaction URL取得
  let formAction = '';
  const formRegex = /<form[^>]*action=["']([^"']*)["'][^>]*>([\s\S]*?)<\/form>/gi;
  let fm: RegExpExecArray | null;
  while ((fm = formRegex.exec(formHtml)) !== null) {
    if (fm[2].includes('name="name"') || fm[2].includes('name="group_id"')) { formAction = fm[1]; break; }
  }
  if (!formAction) formAction = `${UTAGE_BASE_URL}/funnel/${SNS_LP1_CONFIG.funnelId}/tracking`;
  const postUrl = formAction.startsWith('http') ? formAction : `${UTAGE_BASE_URL}${formAction}`;

  // POST送信
  const body = new URLSearchParams({
    _token: formToken,
    name: registrationPath,
    group_id: SNS_LP1_CONFIG.groupId,
    step_id: SNS_LP1_CONFIG.stepId,
  });
  const postResp = await fetch(postUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': sessionCookies, 'Referer': `${UTAGE_BASE_URL}/funnel/${SNS_LP1_CONFIG.funnelId}/tracking/create` },
    body: body.toString(),
    redirect: 'manual',
  });
  sessionCookies = mergeCookies(sessionCookies, postResp);

  // リダイレクト先から結果取得
  let listHtml = '';
  if (postResp.status === 302) {
    const loc = postResp.headers.get('location') || '';
    const rUrl = loc.startsWith('http') ? loc : `${UTAGE_BASE_URL}${loc}`;
    listHtml = await utageGet(rUrl);
  } else {
    listHtml = await postResp.text();
  }

  // 一覧から登録経路URLを抽出
  let idx = listHtml.indexOf(registrationPath);
  if (idx === -1) {
    listHtml = await utageGet(`${UTAGE_BASE_URL}/funnel/${SNS_LP1_CONFIG.funnelId}/tracking`);
    idx = listHtml.indexOf(registrationPath);
  }
  if (idx === -1) throw new Error(`UTAGE: 登録経路(${registrationPath})が見つかりません`);

  const context = listHtml.substring(Math.max(0, idx - 500), idx + 3000);
  const urlPattern = new RegExp(`https://school\\.addness\\.co\\.jp/p/${SNS_LP1_CONFIG.stepId}\\?ftid=[a-zA-Z0-9]+`);
  const urlMatch = context.match(urlPattern);
  if (!urlMatch) throw new Error(`UTAGE: 遷移先URL取得失敗`);

  console.log(`    LP URL: ${urlMatch[0]}`);
  return { registrationPath, destinationUrl: urlMatch[0], crNumber: newCr };
}

async function main() {
  console.log('=== SNS CR横展開 再開（動画アップロード済み） ===\n');

  // まず3本目のvideo_idを確認（前回の実行で取れたかもしれない）
  // 前回ログでは3本目のアップロード開始は見えたが結果が切れている
  // → 3本目もアップロードし直す必要があるかも

  // 先に1, 2本目の動画ステータス確認
  console.log('動画ステータス確認...');
  for (const d of deploys) {
    if (d.newVideoId) {
      await checkVideoStatus(d.newVideoId);
    }
  }

  // 3本目の動画がまだなら再アップロード
  if (!deploys[2].newVideoId) {
    console.log('\n3本目の動画を再アップロード...');
    const sourceAd = await tiktokGet('/v1.3/ad/get/', {
      advertiser_id: '7247073333517238273', // SNS1
      filtering: JSON.stringify({ ad_ids: ['1847734887735409'] }),
      fields: JSON.stringify(['ad_id', 'video_id']),
    });
    const videoId = sourceAd.data?.list?.[0]?.video_id;
    console.log(`  元video_id: ${videoId}`);

    const videoInfos = await tiktokGet('/v1.3/file/video/ad/info/', {
      advertiser_id: '7247073333517238273',
      video_ids: JSON.stringify([videoId]),
    });
    const downloadUrl = videoInfos.data?.list?.[0]?.preview_url || videoInfos.data?.list?.[0]?.video_url;
    const videoBuffer = await axios.get(downloadUrl, { responseType: 'arraybuffer', timeout: 300000 });

    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('advertiser_id', TARGET_ADVERTISER_ID);
    form.append('upload_type', 'UPLOAD_BY_FILE');
    form.append('video_file', Buffer.from(videoBuffer.data), { filename: `cross_deploy_cr00566_${Date.now()}.mp4`, contentType: 'video/mp4' });
    form.append('video_signature', crypto.createHash('md5').update(Buffer.from(videoBuffer.data)).digest('hex'));
    form.append('file_name', `cross_deploy_cr00566_${Date.now()}.mp4`);

    const uploadResp = await axios.post(`${TIKTOK_API}/v1.3/file/video/ad/upload/`, form, {
      headers: { 'Access-Token': ACCESS_TOKEN, ...form.getHeaders() },
      timeout: 300000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    const data = uploadResp.data?.data;
    deploys[2].newVideoId = Array.isArray(data) ? data[0]?.video_id : data?.video_id;
    console.log(`  新video_id: ${deploys[2].newVideoId}`);
  }

  // 動画が処理完了するまで少し待つ
  console.log('\n動画処理待ち（30秒）...');
  await new Promise(r => setTimeout(r, 30000));

  // 再度ステータス確認
  console.log('動画ステータス再確認...');
  for (const d of deploys) {
    if (d.newVideoId) {
      await checkVideoStatus(d.newVideoId);
    }
  }

  // ---- 各CRの広告グループ→広告作成（キャンペーン/UTAGE/サムネイルは作成済み） ----
  for (const d of deploys) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 ${d.label}`);
    console.log(`  既存: campaign=${d.campaignId}, adName=${d.adName}`);

    try {
      const campaignId = d.campaignId;
      const adName = d.adName;
      const thumbnailImageId = d.thumbnailImageId;

      // 広告グループ作成
      console.log('  1. 広告グループ作成...');
      const scheduleTime = new Date(Date.now() + 10 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
      const adgroupResp = await tiktokPost('/v1.3/adgroup/create/', {
        advertiser_id: TARGET_ADVERTISER_ID,
        campaign_id: campaignId,
        adgroup_name: `260320 ノンタゲ`,
        promotion_type: 'LEAD_GENERATION',
        promotion_target_type: 'EXTERNAL_WEBSITE',
        placement_type: 'PLACEMENT_TYPE_NORMAL',
        placements: ['PLACEMENT_TIKTOK'],
        budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET',
        budget: 3000,
        bid_type: 'BID_TYPE_NO_BID',
        billing_event: 'OCPM',
        optimization_goal: 'CONVERT',
        pixel_id: TARGET_PIXEL_ID,
        optimization_event: 'ON_WEB_REGISTER',
        schedule_type: 'SCHEDULE_FROM_NOW',
        schedule_start_time: scheduleTime,
        pacing: 'PACING_MODE_SMOOTH',
        skip_learning_phase: true,
        video_download_disabled: true,
        click_attribution_window: 'SEVEN_DAYS',
        view_attribution_window: 'ONE_DAY',
        location_ids: ['1861060'],
        age_groups: ['AGE_18_24', 'AGE_25_34', 'AGE_35_44', 'AGE_45_54', 'AGE_55_100'],
        gender: 'GENDER_UNLIMITED',
        languages: ['ja'],
      });
      if (adgroupResp.code !== 0) throw new Error(`AdGroup create failed: ${JSON.stringify(adgroupResp)}`);
      const adgroupId = String(adgroupResp.data?.adgroup_id);
      console.log(`    adgroup_id: ${adgroupId}`);

      // 広告作成
      console.log('  2. 広告作成...');
      const lpUrl = `${d.utageDestinationUrl}${d.utageDestinationUrl.includes('?') ? '&' : '?'}utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;
      const adResp = await tiktokPost('/v1.3/ad/create/', {
        advertiser_id: TARGET_ADVERTISER_ID,
        adgroup_id: adgroupId,
        creatives: [{
          ad_name: adName,
          identity_id: TARGET_IDENTITY_ID,
          identity_type: 'BC_AUTH_TT',
          identity_authorized_bc_id: TARGET_BC_ID,
          video_id: d.newVideoId,
          image_ids: [thumbnailImageId],
          ad_text: d.sourceAdText,
          call_to_action: 'LEARN_MORE',
          landing_page_url: lpUrl,
          ad_format: 'SINGLE_VIDEO',
        }],
      });
      if (adResp.code !== 0) throw new Error(`Ad create failed: ${JSON.stringify(adResp)}`);
      const newAdId = adResp.data?.ad_ids?.[0] || 'unknown';

      console.log(`  ✅ 成功!`);
      console.log(`    Ad ID: ${newAdId}`);
      console.log(`    Ad Name: ${adName}`);
      console.log(`    UTAGE経路: ${d.utageRegistrationPath}`);
      console.log(`    LP: ${lpUrl.substring(0, 100)}...`);
      console.log(`    日予算: ¥3,000`);

    } catch (e: any) {
      console.log(`  ❌ エラー: ${e.message?.substring(0, 300)}`);
      if (e.response?.data) {
        console.log(`    API応答: ${JSON.stringify(e.response.data).substring(0, 300)}`);
      }
    }
  }

  console.log('\n\n=== 全完了 ===');
}

main().catch(console.error);
