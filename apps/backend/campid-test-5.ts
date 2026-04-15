/**
 * キャンペーンIDテスト: 同一動画×5キャンペーン（1-1-1）
 * 動画: 石黒研太/AI全部やめました渋谷Ver
 * アカウント: AI_1
 */
import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';
const ADV = '7468288053866561553'; // AI_1
const VIDEO_ID = 'v10033g50000d6onmc7og65m24ip5vig';
const VIDEO_NAME = '石黒研太/AI全部やめました渋谷Ver';
const NUM_CAMPAIGNS = 5;

const UTAGE_BASE_URL = 'https://school.addness.co.jp';
const UTAGE_LOGIN_URL = 'https://school.addness.co.jp/operator/GYbKT7Y9d0eR/login';
const UTAGE_EMAIL = process.env.UTAGE_EMAIL || 'chiba.nobuteru@team.addness.co.jp';
const UTAGE_PASSWORD = process.env.UTAGE_PASSWORD || 'bC4F6mkV';
const FUNNEL = { funnelId: 'a09j9jop95LF', groupId: 'EFnsGw3gAdba', stepId: 'r2RHcL0PdGIY' };
const AD_TEXT = 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）';
const EXCLUDED = ['194977234', '194405484', '195006413'];

let cookies = '';
function merge(existing: string, headers: Headers): string {
  const raw = headers.get('set-cookie'); if (!raw) return existing;
  const m = new Map<string, string>();
  if (existing) existing.split('; ').forEach(c => { const [k] = c.split('='); m.set(k, c); });
  raw.split(/,(?=\s*[a-zA-Z_]+=)/).map(c => c.split(';')[0].trim()).forEach(c => { const [k] = c.split('='); m.set(k, c); });
  return [...m.values()].join('; ');
}
function csrf(html: string): string {
  const m = html.match(/<input[^>]+name=["']_token["'][^>]+value=["']([^"']+)["']/) || html.match(/value=["']([^"']+)["'][^>]+name=["']_token["']/);
  return m ? m[1] : '';
}
function getJstNow(): Date { return new Date(Date.now() + 9 * 3600000); }
function isAfter15(): boolean { return getJstNow().getUTCHours() >= 15; }
function dateStr(): string {
  const d = getJstNow(); if (isAfter15()) d.setUTCDate(d.getUTCDate() + 1);
  return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}
function scheduleTime(): string {
  if (isAfter15()) {
    const d = getJstNow();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} 15:00:00`;
  }
  const t = new Date(Date.now() + 300000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}:00`;
}

async function api(ep: string, body: any): Promise<any> {
  const r = await fetch(`${BASE}${ep}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Access-Token': ACCESS_TOKEN }, body: JSON.stringify(body) });
  const d = await r.json();
  if (d.code !== 0) throw new Error(`${ep}: ${d.message} (${d.code})`);
  return d;
}
async function get(ep: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams(); for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const r = await fetch(`${BASE}${ep}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } }); return r.json();
}

async function utageLogin() {
  const pr = await fetch(UTAGE_LOGIN_URL, { redirect: 'manual' });
  cookies = merge('', pr.headers);
  const t = csrf(await pr.text());
  const lr = await fetch(UTAGE_LOGIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies, 'Referer': UTAGE_LOGIN_URL }, body: new URLSearchParams({ _token: t, email: UTAGE_EMAIL, password: UTAGE_PASSWORD }).toString(), redirect: 'manual' });
  cookies = merge(cookies, lr.headers);
  const loc = lr.headers.get('location') || '';
  if (lr.status === 302 && !loc.includes('/login')) {
    const rr = await fetch(loc.startsWith('http') ? loc : `${UTAGE_BASE_URL}${loc}`, { headers: { 'Cookie': cookies }, redirect: 'manual' });
    cookies = merge(cookies, rr.headers);
  }
}

async function authedGet(url: string): Promise<string> {
  const r = await fetch(url, { headers: { 'Cookie': cookies }, redirect: 'manual' });
  cookies = merge(cookies, r.headers);
  if (r.status === 302) { const l = r.headers.get('location') || ''; const u = l.startsWith('http') ? l : `${UTAGE_BASE_URL}${l}`; if (u.includes('/login')) { await utageLogin(); return authedGet(url); } return authedGet(u); }
  return r.text();
}

async function createPath(crNum: number): Promise<string> {
  const name = `TikTok広告-AI-LP1-CR${String(crNum).padStart(5, '0')}`;
  const fUrl = `${UTAGE_BASE_URL}/funnel/${FUNNEL.funnelId}/tracking/create`;
  const fHtml = await authedGet(fUrl);
  const t = csrf(fHtml);
  let action = ''; const re = /<form[^>]*action=["']([^"']*)["'][^>]*>([\s\S]*?)<\/form>/gi; let m: RegExpExecArray | null;
  while ((m = re.exec(fHtml)) !== null) { if (m[2].includes('name="name"')) { action = m[1]; break; } }
  if (!action) action = `${UTAGE_BASE_URL}/funnel/${FUNNEL.funnelId}/tracking`;
  const pu = action.startsWith('http') ? action : `${UTAGE_BASE_URL}${action}`;
  const pr = await fetch(pu, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies, 'Referer': fUrl }, body: new URLSearchParams({ _token: t, name, group_id: FUNNEL.groupId, step_id: FUNNEL.stepId }).toString(), redirect: 'manual' });
  cookies = merge(cookies, pr.headers);
  let html = pr.status === 302 ? await authedGet((pr.headers.get('location') || '').replace(/^(?!http)/, UTAGE_BASE_URL)) : await pr.text();
  if (!html.includes(name)) html = await authedGet(`${UTAGE_BASE_URL}/funnel/${FUNNEL.funnelId}/tracking`);
  if (!html.includes(name)) for (let p = 2; p <= 10; p++) { html = await authedGet(`${UTAGE_BASE_URL}/funnel/${FUNNEL.funnelId}/tracking?page=${p}`); if (html.includes(name)) break; }
  const idx = html.indexOf(name); if (idx === -1) throw new Error('経路見つからず: ' + name);
  const ctx = html.substring(Math.max(0, idx - 500), idx + 3000);
  const urlM = ctx.match(new RegExp(`https://school\\.addness\\.co\\.jp/p/${FUNNEL.stepId}\\?ftid=[a-zA-Z0-9]+`));
  if (!urlM) throw new Error('URL取得失敗');
  return `${urlM[0]}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;
}

async function main() {
  const prisma = new PrismaClient();
  const FormData = require('form-data');
  const axios = require('axios');

  try {
    const adv = await prisma.advertiser.findUnique({ where: { tiktokAdvertiserId: ADV }, select: { pixelId: true, identityId: true, identityAuthorizedBcId: true } });
    if (!adv?.pixelId) throw new Error('DB情報不足');

    const ds = dateStr();
    console.log(`===== キャンペーンIDテスト: ${VIDEO_NAME} × ${NUM_CAMPAIGNS}本 =====`);
    console.log(`AI_1 | ${ds} | ${isAfter15() ? '翌日0時開始' : '即時開始'}\n`);

    // カバー画像
    console.log('カバー画像取得...');
    const vidInfo = await get('/v1.3/file/video/ad/info/', { advertiser_id: ADV, video_ids: JSON.stringify([VIDEO_ID]) });
    const coverUrl = vidInfo.data?.list?.[0]?.video_cover_url;
    let coverUri = '';
    if (coverUrl) {
      const img = await fetch(coverUrl); const buf = Buffer.from(await img.arrayBuffer());
      const form = new FormData();
      form.append('advertiser_id', ADV); form.append('upload_type', 'UPLOAD_BY_FILE');
      form.append('image_signature', crypto.createHash('md5').update(buf).digest('hex'));
      form.append('image_file', buf, { filename: `c_${Date.now()}.jpg`, contentType: 'image/jpeg' });
      const ur = await axios.post(`${BASE}/v1.3/file/image/ad/upload/`, form, { headers: { 'Access-Token': ACCESS_TOKEN, ...form.getHeaders() }, timeout: 30000 });
      coverUri = ur.data.data?.image_id || '';
    }
    console.log(`  ${coverUri ? 'OK' : 'FAIL'}\n`);

    // CTA ID
    const ctaD = await get('/v1.3/smart_plus/ad/get/', { advertiser_id: ADV, page_size: '5' });
    const ctaId = ctaD.data?.list?.[0]?.ad_configuration?.call_to_action_id || '';

    // UTAGE
    console.log('UTAGEログイン...');
    await utageLogin();
    const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${FUNNEL.funnelId}/tracking`);
    const ms = [...html.matchAll(/TikTok広告-AI-LP1-CR(0\d{4})/g)];
    let latestCr = ms.length > 0 ? Math.max(...ms.map(m => parseInt(m[1]))) : 0;
    console.log(`最新CR: CR${String(latestCr).padStart(5, '0')}\n`);

    // 5キャンペーン作成
    const results: { num: number; crStr: string; campId: string; agId: string; adId: string }[] = [];

    for (let i = 0; i < NUM_CAMPAIGNS; i++) {
      const crNum = latestCr + 1 + i;
      const crStr = `CR${String(crNum).padStart(5, '0')}`;
      console.log(`--- ${i + 1}/${NUM_CAMPAIGNS}: ${crStr} ---`);

      // UTAGE
      const lpUrl = await createPath(crNum);
      console.log(`  UTAGE: OK`);

      const adName = `${ds}/${VIDEO_NAME}/LP1-${crStr}`;

      // キャンペーン
      const camp = await api('/v1.3/smart_plus/campaign/create/', {
        advertiser_id: ADV, campaign_name: adName, objective_type: 'LEAD_GENERATION',
        budget_mode: 'BUDGET_MODE_INFINITE', budget_optimize_on: false,
        request_id: Date.now() + '' + Math.floor(Math.random() * 100000),
      });
      const campId = String(camp.data.campaign_id);

      // 広告グループ（DF + 手動 + 除外3件）
      const ag = await api('/v1.3/smart_plus/adgroup/create/', {
        advertiser_id: ADV, campaign_id: campId,
        adgroup_name: `${ds} 25-34, 35-44, 45-54 DF`,
        budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET', budget: 3000,
        billing_event: 'OCPM', bid_type: 'BID_TYPE_NO_BID',
        optimization_goal: 'CONVERT', optimization_event: 'ON_WEB_REGISTER',
        deep_funnel_optimization_status: 'ON', deep_funnel_optimization_event: 'SHOPPING',
        deep_funnel_event_source: 'PIXEL', deep_funnel_event_source_id: adv.pixelId,
        pixel_id: adv.pixelId, promotion_type: 'LEAD_GENERATION', promotion_target_type: 'EXTERNAL_WEBSITE',
        placement_type: 'PLACEMENT_TYPE_NORMAL', placements: ['PLACEMENT_TIKTOK'],
        comment_disabled: true, schedule_type: 'SCHEDULE_FROM_NOW', schedule_start_time: scheduleTime(),
        targeting_optimization_mode: 'MANUAL',
        targeting_spec: { location_ids: ['1861060'], age_groups: ['AGE_25_34', 'AGE_35_44', 'AGE_45_54'], excluded_audience_ids: EXCLUDED },
        request_id: Date.now() + '' + Math.floor(Math.random() * 100000),
      });
      const agId = String(ag.data.adgroup_id);

      // 広告
      let adId = '';
      for (let retry = 0; retry < 3; retry++) {
        if (retry > 0) await new Promise(r => setTimeout(r, 5000));
        try {
          const ad = await api('/v1.3/smart_plus/ad/create/', {
            advertiser_id: ADV, adgroup_id: agId, ad_name: adName,
            creative_list: [{ creative_info: { ad_format: 'SINGLE_VIDEO', video_info: { video_id: VIDEO_ID }, identity_id: adv.identityId, identity_type: 'BC_AUTH_TT', identity_authorized_bc_id: adv.identityAuthorizedBcId, image_info: [{ web_uri: coverUri }] } }],
            ad_text_list: [{ ad_text: AD_TEXT }],
            landing_page_url_list: [{ landing_page_url: lpUrl }],
            ad_configuration: { call_to_action_id: ctaId }, operation_status: 'ENABLE',
            request_id: Date.now() + '' + Math.floor(Math.random() * 100000),
          });
          adId = String(ad.data?.ad_id || ad.data?.smart_plus_ad_id);
          break;
        } catch (e: any) { console.log(`  リトライ: ${e.message}`); }
      }

      console.log(`  camp:${campId} ag:${agId} ad:${adId}`);
      results.push({ num: i + 1, crStr, campId, agId, adId });
    }

    // DF検証（最初の1つだけ）
    await new Promise(r => setTimeout(r, 5000));
    const vr = await get('/v1.3/smart_plus/adgroup/get/', { advertiser_id: ADV, adgroup_ids: JSON.stringify([results[0].agId]) });
    const agV = vr.data?.list?.[0];
    console.log(`\nDF検証: deep_funnel_toggle=${agV?.deep_funnel_toggle}, targeting=${agV?.targeting_optimization_mode}, excluded=${agV?.targeting_spec?.excluded_audience_ids?.length}件`);

    // 結果
    console.log('\n===== 完了 =====');
    console.log(`動画: ${VIDEO_NAME}`);
    console.log(`アカウント: AI_1 | 設定: DF:ON, 手動25-54, 除外3件, 日予算¥3,000\n`);
    for (const r of results) {
      console.log(`${r.num}. ${r.crStr} | camp:${r.campId} | ad:${r.adId}`);
    }
  } finally { await prisma.$disconnect(); }
}

main().catch(e => { console.error(e); process.exit(1); });
