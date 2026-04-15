/**
 * AI_3にスマプラ作成（AI_1と同じ6動画）
 */
import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';
const ADV = '7543540647266074641'; // AI_3
const SRC_ADV = '7468288053866561553'; // AI_1

const UTAGE_BASE_URL = 'https://school.addness.co.jp';
const UTAGE_LOGIN_URL = 'https://school.addness.co.jp/operator/GYbKT7Y9d0eR/login';
const UTAGE_EMAIL = process.env.UTAGE_EMAIL || 'chiba.nobuteru@team.addness.co.jp';
const UTAGE_PASSWORD = process.env.UTAGE_PASSWORD || 'bC4F6mkV';
const FUNNEL = { funnelId: 'a09j9jop95LF', groupId: 'EFnsGw3gAdba', stepId: 'r2RHcL0PdGIY' };

const AD_TEXT = 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）';
const SRC_VIDS = [
  { videoId: 'v10033g50000d73jgovog65rempsvtcg', name: '高橋海斗/ねねさんClaude_Code' },
  { videoId: 'v10033g50000d10mfl7og65trcf42l5g', name: '鈴木織大/おい会社員_1年後悔' },
  { videoId: 'v10033g50000d5reklnog65uj38psptg', name: '高橋海斗/やれやめろ編集強化' },
  { videoId: 'v10033g50000d34k1pnog65l9k1377d0', name: '在中悠也/説明しようAI冒頭1林社長' },
  { videoId: 'v10033g50000d6onmc7og65m24ip5vig', name: '石黒研太/AI全部やめました渋谷Ver' },
  { videoId: 'v10033g50000d6pv7lnog65gfhdsgfug', name: '鈴木織大/一撃YouTube動画作成途中CTAあり' },
];

const EXCLUDED_AUDIENCES_AI3 = ['194977234', '194405488'];
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
  const m = html.match(/<input[^>]+name=["']_token["'][^>]+value=["']([^"']+)["']/) ||
            html.match(/value=["']([^"']+)["'][^>]+name=["']_token["']/) ||
            html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/);
  if (m) return m[1];
  throw new Error('CSRF失敗');
}

function getJstNow(): Date { return new Date(Date.now() + 9 * 60 * 60 * 1000); }
function isAfter15(): boolean { return getJstNow().getUTCHours() >= 15; }
function getDateStr(): string {
  const d = getJstNow(); if (isAfter15()) d.setUTCDate(d.getUTCDate() + 1);
  return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}
function getScheduleTime(): string {
  if (isAfter15()) {
    const d = getJstNow(); // don't add 1 day, just get the UTC date for 15:00
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} 15:00:00`;
  }
  const t = new Date(Date.now() + 5 * 60 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}:00`;
}

async function api(ep: string, body: any): Promise<any> {
  const r = await fetch(`${BASE}${ep}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Access-Token': ACCESS_TOKEN }, body: JSON.stringify(body) });
  const d = await r.json();
  if (d.code !== 0) throw new Error(`${ep}: ${d.message} (${d.code})`);
  return d;
}
async function get(ep: string, params: Record<string, string>): Promise<any> {
  const r = await fetch(`${BASE}${ep}?${new URLSearchParams(params)}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return r.json();
}

async function utageLogin(): Promise<void> {
  const pr = await fetch(UTAGE_LOGIN_URL, { redirect: 'manual' });
  sessionCookies = mergeCookies('', pr.headers);
  const csrf = extractCsrfToken(await pr.text());
  const lr = await fetch(UTAGE_LOGIN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': sessionCookies, 'Referer': UTAGE_LOGIN_URL },
    body: new URLSearchParams({ _token: csrf, email: UTAGE_EMAIL, password: UTAGE_PASSWORD }).toString(), redirect: 'manual',
  });
  sessionCookies = mergeCookies(sessionCookies, lr.headers);
  const loc = lr.headers.get('location') || '';
  if (lr.status === 302 && !loc.includes('/login')) {
    const rr = await fetch(loc.startsWith('http') ? loc : `${UTAGE_BASE_URL}${loc}`, { headers: { 'Cookie': sessionCookies }, redirect: 'manual' });
    sessionCookies = mergeCookies(sessionCookies, rr.headers);
    console.log('   UTAGE OK');
  } else throw new Error('UTAGE失敗');
}

async function authedGet(url: string): Promise<string> {
  const r = await fetch(url, { headers: { 'Cookie': sessionCookies }, redirect: 'manual' });
  sessionCookies = mergeCookies(sessionCookies, r.headers);
  if (r.status === 302) {
    const loc = r.headers.get('location') || '';
    const u = loc.startsWith('http') ? loc : `${UTAGE_BASE_URL}${loc}`;
    if (u.includes('/login')) { await utageLogin(); return authedGet(url); }
    return authedGet(u);
  }
  return r.text();
}

async function main() {
  const prisma = new PrismaClient();
  const FormData = require('form-data');
  const axios = require('axios');

  try {
    const adv = await prisma.advertiser.findUnique({ where: { tiktokAdvertiserId: ADV }, select: { pixelId: true, identityId: true, identityAuthorizedBcId: true, name: true } });
    if (!adv?.pixelId || !adv.identityId || !adv.identityAuthorizedBcId) throw new Error('DB情報不足');

    const dateStr = getDateStr();
    console.log(`===== AI_3 スマプラ作成 =====`);
    console.log(`アカウント: ${adv.name}`);
    console.log(`ピクセル: ${adv.pixelId}\n`);

    // 債務整理除外確認
    const audResp = await get('/v1.3/dmp/custom_audience/list/', { advertiser_id: ADV, page_size: '100' });
    const excludedIds = [...EXCLUDED_AUDIENCES_AI3];
    for (const a of (audResp.data?.list || [])) {
      if (a.name?.includes('債務整理')) { excludedIds.push(String(a.audience_id)); console.log(`債務整理除外: ${a.audience_id}`); }
    }
    console.log(`除外: ${excludedIds.join(', ')}\n`);

    // 1. 動画（既にアップロード済み）
    const newVids = [
      'v10033g50000d7b5tonog65oto9fl1l0',
      'v10033g50000d7b5ttnog65gbpd0un2g',
      'v10033g50000d7b5u0nog65kuk1jmveg',
      'v10033g50000d7b5u2fog65u86rbp4b0',
      'v10033g50000d7b5u4nog65v7qbjetog',
      'v10033g50000d7b5u7vog65pllsum4b0',
    ];
    console.log('1. 動画: 既にAI_3にアップロード済み');

    // 2. カバー画像
    console.log('\n2. カバー画像取得...');
    const covers: string[] = [];
    for (let i = 0; i < newVids.length; i++) {
      let uri = '';
      for (let retry = 0; retry < 15 && !uri; retry++) {
        if (retry > 0) await new Promise(r => setTimeout(r, 3000));
        const info = await get('/v1.3/file/video/ad/info/', { advertiser_id: ADV, video_ids: JSON.stringify([newVids[i]]) });
        const coverUrl = info.data?.list?.[0]?.video_cover_url;
        if (!coverUrl) continue;
        const img = await fetch(coverUrl);
        if (!img.ok) continue;
        const buf = Buffer.from(await img.arrayBuffer());
        const form = new FormData();
        form.append('advertiser_id', ADV);
        form.append('upload_type', 'UPLOAD_BY_FILE');
        form.append('image_signature', crypto.createHash('md5').update(buf).digest('hex'));
        form.append('image_file', buf, { filename: `c_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`, contentType: 'image/jpeg' });
        const ur = await axios.post(`${BASE}/v1.3/file/image/ad/upload/`, form, {
          headers: { 'Access-Token': ACCESS_TOKEN, ...form.getHeaders() }, timeout: 30000,
        });
        if (ur.data.code === 0) uri = ur.data.data?.image_id || '';
      }
      if (!uri) throw new Error('カバー失敗: ' + SRC_VIDS[i].name);
      covers.push(uri);
      console.log(`   ${SRC_VIDS[i].name}: OK`);
    }

    // 3. UTAGE
    console.log('\n3. UTAGE...');
    await utageLogin();
    const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${FUNNEL.funnelId}/tracking`);
    const ms = [...html.matchAll(/TikTok広告-AI-LP1-CR(0\d{4})/g)];
    const latestCr = ms.length > 0 ? Math.max(...ms.map(m => parseInt(m[1]))) : 0;
    console.log(`   最新: CR${String(latestCr).padStart(5, '0')}`);
    const newCr = latestCr + 1;
    const crStr = String(newCr).padStart(5, '0');
    const regName = `TikTok広告-AI-LP1-CR${crStr}`;
    console.log(`   作成: ${regName}`);

    const formHtml = await authedGet(`${UTAGE_BASE_URL}/funnel/${FUNNEL.funnelId}/tracking/create`);
    let token = ''; try { token = extractCsrfToken(formHtml); } catch {}
    let action = '';
    const fReg = /<form[^>]*action=["']([^"']*)["'][^>]*>([\s\S]*?)<\/form>/gi;
    let fm: RegExpExecArray | null;
    while ((fm = fReg.exec(formHtml)) !== null) { if (fm[2].includes('name="name"')) { action = fm[1]; break; } }
    if (!action) action = `${UTAGE_BASE_URL}/funnel/${FUNNEL.funnelId}/tracking`;
    const pu = action.startsWith('http') ? action : `${UTAGE_BASE_URL}${action}`;
    const pr = await fetch(pu, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': sessionCookies, 'Referer': `${UTAGE_BASE_URL}/funnel/${FUNNEL.funnelId}/tracking/create` },
      body: new URLSearchParams({ _token: token, name: regName, group_id: FUNNEL.groupId, step_id: FUNNEL.stepId }).toString(), redirect: 'manual',
    });
    sessionCookies = mergeCookies(sessionCookies, pr.headers);
    let lHtml = '';
    if (pr.status === 302) { const l = pr.headers.get('location') || ''; lHtml = await authedGet(l.startsWith('http') ? l : `${UTAGE_BASE_URL}${l}`); }
    else lHtml = await pr.text();
    let idx = lHtml.indexOf(regName);
    if (idx === -1) { lHtml = await authedGet(`${UTAGE_BASE_URL}/funnel/${FUNNEL.funnelId}/tracking`); idx = lHtml.indexOf(regName); }
    if (idx === -1) for (let p = 2; p <= 10; p++) { lHtml = await authedGet(`${UTAGE_BASE_URL}/funnel/${FUNNEL.funnelId}/tracking?page=${p}`); idx = lHtml.indexOf(regName); if (idx !== -1) break; }
    if (idx === -1) throw new Error('経路が見つからない');
    const ctx = lHtml.substring(Math.max(0, idx - 500), idx + 3000);
    const urlM = ctx.match(new RegExp(`https://school\\.addness\\.co\\.jp/p/${FUNNEL.stepId}\\?ftid=[a-zA-Z0-9]+`));
    if (!urlM) throw new Error('URL取得失敗');
    const lpUrl = `${urlM[0]}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;
    console.log(`   → ${urlM[0]}`);

    const adName = `${dateStr}/スマプラ/CR01131_CR01172_CR01169_CR01161_CR01144_CR01165/LP1-CR${crStr}`;

    // 4. キャンペーン
    console.log('\n4. キャンペーン...');
    const camp = await api('/v1.3/smart_plus/campaign/create/', {
      advertiser_id: ADV, campaign_name: adName, objective_type: 'LEAD_GENERATION',
      budget_mode: 'BUDGET_MODE_INFINITE', budget_optimize_on: false,
      request_id: Date.now() + '' + Math.floor(Math.random() * 100000),
    });
    const cId = String(camp.data.campaign_id);
    console.log(`   ${cId}`);

    // 5. 広告グループ
    console.log('\n5. 広告グループ（DF + 手動 + 除外）...');
    const ag = await api('/v1.3/smart_plus/adgroup/create/', {
      advertiser_id: ADV, campaign_id: cId, adgroup_name: `${dateStr} 25-34, 35-44, 45-54 DF`,
      budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET', budget: 3000,
      billing_event: 'OCPM', bid_type: 'BID_TYPE_NO_BID',
      optimization_goal: 'CONVERT', optimization_event: 'ON_WEB_REGISTER',
      deep_funnel_optimization_status: 'ON', deep_funnel_optimization_event: 'SHOPPING',
      deep_funnel_event_source: 'PIXEL', deep_funnel_event_source_id: adv.pixelId,
      pixel_id: adv.pixelId, promotion_type: 'LEAD_GENERATION', promotion_target_type: 'EXTERNAL_WEBSITE',
      placement_type: 'PLACEMENT_TYPE_NORMAL', placements: ['PLACEMENT_TIKTOK'],
      comment_disabled: true, schedule_type: 'SCHEDULE_FROM_NOW', schedule_start_time: getScheduleTime(),
      targeting_optimization_mode: 'MANUAL',
      targeting_spec: { location_ids: ['1861060'], age_groups: ['AGE_25_34', 'AGE_35_44', 'AGE_45_54'], excluded_audience_ids: excludedIds },
      request_id: Date.now() + '' + Math.floor(Math.random() * 100000),
    });
    const agId = String(ag.data.adgroup_id);
    console.log(`   ${agId}`);
    await new Promise(r => setTimeout(r, 5000));
    const vr = await get('/v1.3/smart_plus/adgroup/get/', { advertiser_id: ADV, adgroup_ids: JSON.stringify([agId]) });
    const agV = vr.data?.list?.[0];
    const df: Record<string, any> = {};
    for (const [k, v] of Object.entries(agV || {})) { if (k.includes('deep') || k.includes('funnel')) df[k] = v; }
    console.log(`   DF: ${JSON.stringify(df)}`);
    console.log(`   除外: ${JSON.stringify(agV?.targeting_spec?.excluded_audience_ids)}`);

    // 6. 広告
    console.log('\n6. 広告（1広告 × 6動画）...');
    const ctaD = await get('/v1.3/smart_plus/ad/get/', { advertiser_id: ADV, page_size: '5' });
    const ctaId = ctaD.data?.list?.[0]?.ad_configuration?.call_to_action_id || '';
    const cl = newVids.map((vid, i) => ({
      creative_info: {
        ad_format: 'SINGLE_VIDEO', video_info: { video_id: vid },
        identity_id: adv.identityId, identity_type: 'BC_AUTH_TT',
        identity_authorized_bc_id: adv.identityAuthorizedBcId,
        image_info: [{ web_uri: covers[i] }],
      },
    }));
    let adId = '';
    for (let retry = 0; retry < 3; retry++) {
      if (retry > 0) { console.log('   リトライ...'); await new Promise(r => setTimeout(r, 10000)); }
      try {
        const ad = await api('/v1.3/smart_plus/ad/create/', {
          advertiser_id: ADV, adgroup_id: agId, ad_name: adName,
          creative_list: cl, ad_text_list: [{ ad_text: AD_TEXT }],
          landing_page_url_list: [{ landing_page_url: lpUrl }],
          ad_configuration: { call_to_action_id: ctaId },
          operation_status: 'ENABLE',
          request_id: Date.now() + '' + Math.floor(Math.random() * 100000),
        });
        adId = String(ad.data?.ad_id || ad.data?.smart_plus_ad_id);
        break;
      } catch (e: any) { console.log('   ' + e.message); }
    }

    console.log('\n===== 完了 =====');
    console.log(`アカウント: AI_3`);
    console.log(`広告ID: ${adId}`);
    console.log(`広告名: ${adName}`);
    console.log(`CR: CR${crStr}`);
    console.log(`DF: ${JSON.stringify(df)}`);
    console.log(`除外: ${excludedIds}`);
  } finally { await prisma.$disconnect(); }
}

main().catch(e => { console.error(e); process.exit(1); });
