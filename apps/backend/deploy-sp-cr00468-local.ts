/**
 * SP CR00468 (Smart+, 動画21本) を SP2・SP3 にローカルから横展開
 * 動画DL→UL→UTAGE→Smart+キャンペーン/広告グループ/広告作成
 */
import axios from 'axios';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
dotenv.config();

const prisma = new PrismaClient();
const TIKTOK_API = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const UTAGE_BASE_URL = 'https://school.addness.co.jp';
const OPERATOR_LOGIN_URL = 'https://school.addness.co.jp/operator/GYbKT7Y9d0eR/login';

const SP1_ID = '7474920444831875080';
const SOURCE_AD_ID = '1858931396655186';

const targets = [
  { id: '7592868952431362066', name: 'SP2', pixelId: '7606956193143210002', identityId: '55fc7dd2-572d-5945-8363-0b45f294473c' },
  { id: '7616545514662051858', name: 'SP3', pixelId: '7617659343252586503', identityId: '6fac7e18-0297-5ad3-9849-1de69197cd95' },
];
const BC_ID = '7440019834009829392';
const SP_LP_CONFIG = { funnelId: '3lS3x3dXa6kc', groupId: 'sOiiROJBAVIu', stepId: 'doc7hffUAVTv' };

// ========== TikTok API ==========
async function tiktokGet(path: string, params: any) {
  return (await axios.get(`${TIKTOK_API}${path}`, { headers: { 'Access-Token': ACCESS_TOKEN }, params })).data;
}
async function tiktokPost(path: string, data: any) {
  return (await axios.post(`${TIKTOK_API}${path}`, data, { headers: { 'Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } })).data;
}

async function uploadVideo(advertiserId: string, buffer: Buffer, filename: string): Promise<string> {
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('advertiser_id', advertiserId);
  form.append('upload_type', 'UPLOAD_BY_FILE');
  form.append('video_file', buffer, { filename, contentType: 'video/mp4' });
  form.append('video_signature', crypto.createHash('md5').update(buffer).digest('hex'));
  form.append('file_name', filename);
  const resp = await axios.post(`${TIKTOK_API}/v1.3/file/video/ad/upload/`, form, {
    headers: { 'Access-Token': ACCESS_TOKEN, ...form.getHeaders() },
    timeout: 300000, maxContentLength: Infinity, maxBodyLength: Infinity,
  });
  const data = resp.data?.data;
  return Array.isArray(data) ? data[0]?.video_id : data?.video_id;
}

// ========== UTAGE ==========
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
  const m = html.match(/<input[^>]+name=["']_token["'][^>]+value=["']([^"']+)["']/) ||
            html.match(/value=["']([^"']+)["'][^>]+name=["']_token["']/) ||
            html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/);
  if (m) return m[1];
  throw new Error('CSRFトークン取得失敗');
}

async function utageLogin() {
  const email = process.env.UTAGE_EMAIL;
  const password = process.env.UTAGE_PASSWORD;
  if (!email || !password) throw new Error('UTAGE_EMAIL/UTAGE_PASSWORD未設定');
  console.log('  UTAGE: ログイン中...');
  const loginPage = await fetch(OPERATOR_LOGIN_URL, { redirect: 'manual' });
  sessionCookies = mergeCookies('', loginPage);
  csrfToken = extractCsrfToken(await loginPage.text());
  const loginResp = await fetch(OPERATOR_LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': sessionCookies, 'Referer': OPERATOR_LOGIN_URL },
    body: new URLSearchParams({ _token: csrfToken, email, password }).toString(),
    redirect: 'manual',
  });
  sessionCookies = mergeCookies(sessionCookies, loginResp);
  const location = loginResp.headers.get('location') || '';
  if (loginResp.status === 302 && !location.includes('/login')) {
    const rUrl = location.startsWith('http') ? location : `${UTAGE_BASE_URL}${location}`;
    const rResp = await fetch(rUrl, { headers: { 'Cookie': sessionCookies }, redirect: 'manual' });
    sessionCookies = mergeCookies(sessionCookies, rResp);
    console.log('  UTAGE: ログイン成功');
  } else throw new Error('UTAGEログイン失敗');
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
  const trackingHtml = await utageGet(`${UTAGE_BASE_URL}/funnel/${SP_LP_CONFIG.funnelId}/tracking`);
  const matches = [...trackingHtml.matchAll(/TikTok広告-スキルプラス-LP2-CR(\d+)/g)];
  const latestCr = matches.length > 0 ? Math.max(...matches.map(m => parseInt(m[1]))) : 0;
  const newCr = latestCr + 1;
  const crStr = String(newCr).padStart(5, '0');
  const registrationPath = `TikTok広告-スキルプラス-LP2-CR${crStr}`;
  console.log(`    最新CR: ${latestCr} → 新規: ${registrationPath}`);

  const formHtml = await utageGet(`${UTAGE_BASE_URL}/funnel/${SP_LP_CONFIG.funnelId}/tracking/create`);
  let formToken: string;
  try { formToken = extractCsrfToken(formHtml); } catch { formToken = csrfToken; }

  let formAction = '';
  const formRegex = /<form[^>]*action=["']([^"']*)["'][^>]*>([\s\S]*?)<\/form>/gi;
  let fm: RegExpExecArray | null;
  while ((fm = formRegex.exec(formHtml)) !== null) {
    if (fm[2].includes('name="name"') || fm[2].includes('name="group_id"')) { formAction = fm[1]; break; }
  }
  if (!formAction) formAction = `${UTAGE_BASE_URL}/funnel/${SP_LP_CONFIG.funnelId}/tracking`;
  const postUrl = formAction.startsWith('http') ? formAction : `${UTAGE_BASE_URL}${formAction}`;

  const postResp = await fetch(postUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': sessionCookies, 'Referer': `${UTAGE_BASE_URL}/funnel/${SP_LP_CONFIG.funnelId}/tracking/create` },
    body: new URLSearchParams({ _token: formToken, name: registrationPath, group_id: SP_LP_CONFIG.groupId, step_id: SP_LP_CONFIG.stepId }).toString(),
    redirect: 'manual',
  });
  sessionCookies = mergeCookies(sessionCookies, postResp);

  let listHtml = '';
  if (postResp.status === 302) {
    const loc = postResp.headers.get('location') || '';
    listHtml = await utageGet(loc.startsWith('http') ? loc : `${UTAGE_BASE_URL}${loc}`);
  } else listHtml = await postResp.text();

  let idx = listHtml.indexOf(registrationPath);
  if (idx === -1) { listHtml = await utageGet(`${UTAGE_BASE_URL}/funnel/${SP_LP_CONFIG.funnelId}/tracking`); idx = listHtml.indexOf(registrationPath); }
  if (idx === -1) throw new Error(`UTAGE: ${registrationPath}が見つかりません`);

  const context = listHtml.substring(Math.max(0, idx - 500), idx + 3000);
  const urlMatch = context.match(new RegExp(`https://school\\.addness\\.co\\.jp/p/${SP_LP_CONFIG.stepId}\\?ftid=[a-zA-Z0-9]+`));
  if (!urlMatch) throw new Error('UTAGE: LP URL取得失敗');
  console.log(`    LP: ${urlMatch[0]}`);
  return { registrationPath, destinationUrl: urlMatch[0], crNumber: newCr };
}

// ========== メイン ==========
async function main() {
  console.log('=== SP CR00468 横展開（ローカル実行） ===\n');

  // 1. 元広告のSmart+データ取得
  console.log('1. Smart+ 元広告データ取得...');
  const smartResp = await tiktokGet('/v1.3/smart_plus/ad/get/', {
    advertiser_id: SP1_ID,
    page_size: 50,
  });
  const allAds = smartResp.data?.list || [];
  const sourceAd = allAds.find((a: any) => a.ad_name?.includes('CR00468'));
  if (!sourceAd) throw new Error('CR00468がSmart+ APIで見つかりません');

  const videoIds = (sourceAd.creative_list || []).map((c: any) => c?.creative_info?.video_info?.video_id).filter(Boolean);
  const adTexts = (sourceAd.ad_text_list || []).map((t: any) => t.ad_text).filter(Boolean);
  console.log(`  広告名: ${sourceAd.ad_name}`);
  console.log(`  動画数: ${videoIds.length}本`);
  console.log(`  広告文: ${adTexts[0]?.substring(0, 60)}`);

  // 2. 動画ダウンロード（1回だけ）
  console.log('\n2. 動画ダウンロード中...');
  const videoBuffers = new Map<string, Buffer>();

  // バッチでビデオ情報取得
  const videoInfoResp = await tiktokGet('/v1.3/file/video/ad/info/', {
    advertiser_id: SP1_ID,
    video_ids: JSON.stringify(videoIds),
  });
  const videoInfos = videoInfoResp.data?.list || [];

  for (let i = 0; i < videoIds.length; i++) {
    const vid = videoIds[i];
    const info = videoInfos.find((v: any) => v.video_id === vid);
    const url = info?.preview_url || info?.video_url;
    if (!url) { console.log(`  [${i}] ${vid}: URLなし、スキップ`); continue; }
    try {
      const buf = await axios.get(url, { responseType: 'arraybuffer', timeout: 300000 });
      videoBuffers.set(vid, Buffer.from(buf.data));
      console.log(`  [${i}/${videoIds.length}] ${vid}: ${(buf.data.byteLength / 1024 / 1024).toFixed(1)}MB`);
    } catch (e: any) {
      console.log(`  [${i}] ${vid}: DLエラー ${e.message?.substring(0, 50)}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`  DL完了: ${videoBuffers.size}/${videoIds.length}本`);

  // 3. 各ターゲットに横展開
  for (const target of targets) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 CR00468 → ${target.name} (${target.id})`);

    try {
      // 3a. 動画アップロード
      console.log('  3a. 動画アップロード...');
      const newVideoIds: string[] = [];
      let uploaded = 0;
      for (const [origVid, buffer] of videoBuffers) {
        const newVid = await uploadVideo(target.id, buffer, `sp_cross_${Date.now()}_${uploaded}.mp4`);
        newVideoIds.push(newVid);
        uploaded++;
        console.log(`    [${uploaded}/${videoBuffers.size}] ${newVid}`);
        await new Promise(r => setTimeout(r, 500));
      }
      console.log(`    アップロード完了: ${newVideoIds.length}本`);

      // 少し待つ
      console.log('    動画処理待ち（15秒）...');
      await new Promise(r => setTimeout(r, 15000));

      // 3b. UTAGE登録経路作成
      console.log('  3b. UTAGE登録経路作成...');
      const utage = await createUtageRegistrationPath();

      // 3c. Smart+キャンペーン作成
      const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const dateStr = `${String(jst.getUTCFullYear()).slice(2)}${String(jst.getUTCMonth() + 1).padStart(2, '0')}${String(jst.getUTCDate()).padStart(2, '0')}`;
      const crStr = String(utage.crNumber).padStart(5, '0');
      const adName = `${dateStr}/清水絢吾/スマプラ/CVポイント検証/LP2-CR${crStr}`;

      console.log(`  3c. Smart+キャンペーン作成: ${adName}`);
      const campResp = await tiktokPost('/v1.3/smart_plus/campaign/create/', {
        advertiser_id: target.id,
        campaign_name: adName,
      });
      if (campResp.code !== 0) throw new Error(`Campaign failed: ${JSON.stringify(campResp)}`);
      const campaignId = String(campResp.data?.campaign_id);
      console.log(`    campaign_id: ${campaignId}`);

      // 3d. Smart+広告グループ作成
      console.log('  3d. Smart+広告グループ作成...');
      const agResp = await tiktokPost('/v1.3/smart_plus/adgroup/create/', {
        advertiser_id: target.id,
        campaign_id: campaignId,
        adgroup_name: `${dateStr} スマプラ`,
        budget: 5000,
        pixel_id: target.pixelId,
      });
      if (agResp.code !== 0) throw new Error(`AdGroup failed: ${JSON.stringify(agResp)}`);
      const adgroupId = String(agResp.data?.adgroup_id);
      console.log(`    adgroup_id: ${adgroupId}`);

      // 3e. Smart+広告作成（全動画をcreative_listに）
      console.log('  3e. Smart+広告作成...');
      const lpUrl = `${utage.destinationUrl}${utage.destinationUrl.includes('?') ? '&' : '?'}utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;
      const creativeList = newVideoIds.map(vid => ({
        video_id: vid,
        identity_id: target.identityId,
        identity_type: 'BC_AUTH_TT',
      }));

      const adResp = await tiktokPost('/v1.3/smart_plus/ad/create/', {
        advertiser_id: target.id,
        adgroup_id: adgroupId,
        ad_name: adName,
        creative_list: creativeList,
        ad_text_list: adTexts.map(t => ({ ad_text: t })),
        landing_page_url_list: [{ landing_page_url: lpUrl }],
      });
      if (adResp.code !== 0) throw new Error(`Ad failed: ${JSON.stringify(adResp)}`);
      const adId = adResp.data?.ad_id || adResp.data?.ad_ids?.[0];

      console.log(`  ✅ 成功!`);
      console.log(`    Ad ID: ${adId}`);
      console.log(`    Ad Name: ${adName}`);
      console.log(`    UTAGE経路: ${utage.registrationPath}`);
      console.log(`    LP: ${lpUrl.substring(0, 80)}...`);
      console.log(`    動画: ${newVideoIds.length}本`);
      console.log(`    日予算: ¥5,000`);

    } catch (e: any) {
      console.log(`  ❌ エラー: ${e.message?.substring(0, 300)}`);
      if (e.response?.data) console.log(`    API: ${JSON.stringify(e.response.data).substring(0, 300)}`);
    }
  }

  await prisma.$disconnect();
  console.log('\n\n=== 完了 ===');
}

main().catch(console.error);
