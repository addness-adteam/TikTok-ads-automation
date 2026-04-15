/**
 * CR00468 スマプラ再出稿（全動画をcreative_listに入れる）
 *
 * npx tsx apps/backend/redeploy-cr00468.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

const SP1_ID = '7474920444831875080';
const SOURCE_CAMPAIGN_ID = '1858931396653250'; // CR00468のキャンペーン

// UTAGE
const UTAGE_BASE_URL = 'https://school.addness.co.jp';
const UTAGE_LOGIN_URL = 'https://school.addness.co.jp/operator/GYbKT7Y9d0eR/login';
const UTAGE_EMAIL = process.env.UTAGE_EMAIL || 'chiba.nobuteru@team.addness.co.jp';
const UTAGE_PASSWORD = process.env.UTAGE_PASSWORD || 'bC4F6mkV';

const SP_FUNNEL = { funnelId: '3lS3x3dXa6kc', groupId: 'sOiiROJBAVIu', stepId: 'doc7hffUAVTv' };
const AD_TEXT = 'スキルで独立するなら学んでおきたい本質のスキル活用術特商法（https://skill.addness.co.jp/tokushoho）';
const DAILY_BUDGET = 5000;

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
  jst.setUTCDate(jst.getUTCDate() + 1); // 常に翌日
  return jst;
}

function getJstDateStr(): string {
  const d = getDeliveryDate();
  return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

function getJstScheduleTime(): string {
  // 翌日0時JST = 当日15:00 UTC
  const jst = getJstNow();
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')} 15:00:00`;
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
  return resp.json();
}

// UTAGE
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

async function getLatestCrNumber(): Promise<number> {
  console.log('3. 最新CR番号を取得中...');
  const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${SP_FUNNEL.funnelId}/tracking`);
  const pattern = /TikTok広告-スキルプラス-LP2-CR(0\d{4})/g;
  const matches = [...html.matchAll(pattern)];
  if (matches.length === 0) return 0;
  const crNumbers = matches.map(m => parseInt(m[1])).sort((a, b) => b - a);
  console.log(`   最新CR番号: CR${String(crNumbers[0]).padStart(5, '0')}`);
  return crNumbers[0];
}

async function createRegistrationPath(crNumber: number): Promise<{ registrationPath: string; destinationUrl: string }> {
  const crStr = String(crNumber).padStart(5, '0');
  const registrationPath = `TikTok広告-スキルプラス-LP2-CR${crStr}`;
  console.log(`4. UTAGE登録経路作成: ${registrationPath}`);

  const createFormUrl = `${UTAGE_BASE_URL}/funnel/${SP_FUNNEL.funnelId}/tracking/create`;
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
  if (!formAction) formAction = `${UTAGE_BASE_URL}/funnel/${SP_FUNNEL.funnelId}/tracking`;
  const postUrl = formAction.startsWith('http') ? formAction : `${UTAGE_BASE_URL}${formAction}`;

  const body = new URLSearchParams({ _token: formToken, name: registrationPath, group_id: SP_FUNNEL.groupId, step_id: SP_FUNNEL.stepId });
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
    const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${SP_FUNNEL.funnelId}/tracking`);
    foundIdx = html.indexOf(registrationPath);
    if (foundIdx !== -1) foundHtml = html;
  }
  if (foundIdx === -1) {
    for (let page = 2; page <= 10; page++) {
      const html = await authedGet(`${UTAGE_BASE_URL}/funnel/${SP_FUNNEL.funnelId}/tracking?page=${page}`);
      foundIdx = html.indexOf(registrationPath);
      if (foundIdx !== -1) { foundHtml = html; break; }
      if (!html.includes(`page=${page + 1}`)) break;
    }
  }
  if (foundIdx === -1) throw new Error(`登録経路が見つかりません: ${registrationPath}`);

  const context = foundHtml.substring(Math.max(0, foundIdx - 500), foundIdx + 3000);
  const urlMatch = context.match(new RegExp(`https://school\\.addness\\.co\\.jp/p/${SP_FUNNEL.stepId}\\?ftid=[a-zA-Z0-9]+`));
  if (!urlMatch) throw new Error(`遷移先URL取得失敗: ${registrationPath}`);

  console.log(`   作成完了: ${urlMatch[0]}`);
  return { registrationPath, destinationUrl: urlMatch[0] };
}

async function getCtaId(): Promise<string> {
  const data = await tiktokGet('/v1.3/smart_plus/ad/get/', { advertiser_id: SP1_ID, page_size: '5' });
  const ads = data.data?.list || [];
  return ads[0]?.ad_configuration?.call_to_action_id || '';
}

async function main() {
  const prisma = new PrismaClient();

  try {
    // 1. 元キャンペーンの全動画IDとカバー画像を取得
    console.log('1. 元キャンペーンの素材情報取得...');
    const adsResp = await tiktokGet('/v1.3/ad/get/', {
      advertiser_id: SP1_ID,
      filtering: JSON.stringify({ campaign_ids: [SOURCE_CAMPAIGN_ID] }),
      fields: JSON.stringify(['ad_id', 'ad_name', 'video_id', 'image_ids']),
      page_size: '100',
    });
    const sourceAds = adsResp.data?.list || [];
    console.log(`   元広告数: ${sourceAds.length}件`);

    // video_id + image_id（カバー）を収集
    const materials: { videoId: string; imageWebUri: string; adName: string }[] = [];
    for (const ad of sourceAds) {
      if (!ad.video_id) continue;
      materials.push({
        videoId: ad.video_id,
        imageWebUri: ad.image_ids?.[0] || '',
        adName: ad.ad_name || '',
      });
    }
    console.log(`   動画素材: ${materials.length}本`);
    for (const m of materials) {
      console.log(`     ${m.videoId} | ${m.adName}`);
    }

    // DB情報取得
    const adv = await prisma.advertiser.findFirst({ where: { tiktokAdvertiserId: SP1_ID } });
    if (!adv) throw new Error('SP1がDBにありません');
    const identityId = adv.identityId || '';
    const bcId = adv.identityAuthorizedBcId || adv.bcId || '';
    const pixelId = adv.pixelId || '';
    console.log(`   identity: ${identityId}, bcId: ${bcId}, pixel: ${pixelId}`);

    // 2. UTAGEログイン→CR番号取得→登録経路作成
    await utageLogin();
    const latestCr = await getLatestCrNumber();
    const newCrNumber = latestCr + 1;
    const crStr = `CR${String(newCrNumber).padStart(5, '0')}`;
    console.log(`   新CR番号: ${crStr}`);

    const { destinationUrl } = await createRegistrationPath(newCrNumber);
    const landingPageUrl = `${destinationUrl}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;

    // 3. Smart+キャンペーン作成
    const ds = getJstDateStr();
    const adName = `${ds}/セミ/スマ/セミまとめ(CVポイント検証)再出稿/LP2-${crStr}`;
    console.log(`\n5. Smart+キャンペーン作成: ${adName}`);

    const campData = await tiktokApi('/v1.3/smart_plus/campaign/create/', {
      advertiser_id: SP1_ID,
      campaign_name: adName,
      objective_type: 'LEAD_GENERATION',
      budget_mode: 'BUDGET_MODE_INFINITE',
      budget_optimize_on: false,
      request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
    });
    const campaignId = String(campData.data.campaign_id);
    console.log(`   キャンペーンID: ${campaignId}`);

    // 4. Smart+広告グループ作成
    console.log('6. Smart+広告グループ作成...');
    const agData = await tiktokApi('/v1.3/smart_plus/adgroup/create/', {
      advertiser_id: SP1_ID,
      campaign_id: campaignId,
      adgroup_name: `${ds} 25-54`,
      budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET',
      budget: DAILY_BUDGET,
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
      targeting_optimization_mode: 'MANUAL',
      targeting_spec: {
        location_ids: ['1861060'],
        age_groups: ['AGE_25_34', 'AGE_35_44', 'AGE_45_54'],
      },
      request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
    });
    const adgroupId = String(agData.data.adgroup_id);
    console.log(`   広告グループID: ${adgroupId}`);

    // 通常API予算同期
    try {
      await tiktokApi('/v1.3/adgroup/update/', { advertiser_id: SP1_ID, adgroup_id: adgroupId, budget: DAILY_BUDGET });
      console.log(`   通常API予算同期: ¥${DAILY_BUDGET}`);
    } catch (e: any) { console.log(`   予算同期失敗（許容）: ${e.message}`); }

    // ターゲティング検証
    console.log('   ターゲティング検証中（5秒待機）...');
    await new Promise(r => setTimeout(r, 5000));
    const verifyResp = await tiktokGet('/v1.3/smart_plus/adgroup/get/', {
      advertiser_id: SP1_ID,
      adgroup_ids: JSON.stringify([adgroupId]),
    });
    const actual = verifyResp.data?.list?.[0]?.targeting_spec;
    console.log(`   年齢: ${JSON.stringify(actual?.age_groups)}`);

    // 5. Smart+広告作成（全動画をcreative_listに）
    console.log(`\n7. Smart+広告作成（${materials.length}動画）...`);
    const ctaId = await getCtaId();
    console.log(`   CTA ID: ${ctaId}`);

    const creativeList = materials.map(m => ({
      creative_info: {
        ad_format: 'SINGLE_VIDEO',
        video_info: { video_id: m.videoId },
        identity_id: identityId,
        identity_type: 'BC_AUTH_TT',
        identity_authorized_bc_id: bcId,
        ...(m.imageWebUri ? { image_info: [{ web_uri: m.imageWebUri }] } : {}),
      },
    }));

    const adData = await tiktokApi('/v1.3/smart_plus/ad/create/', {
      advertiser_id: SP1_ID,
      adgroup_id: adgroupId,
      ad_name: adName,
      creative_list: creativeList,
      ad_text_list: [{ ad_text: AD_TEXT }],
      landing_page_url_list: [{ landing_page_url: landingPageUrl }],
      ad_configuration: { call_to_action_id: ctaId },
      operation_status: 'ENABLE',
      request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
    });
    const newAdId = String(adData.data?.ad_id || adData.data?.smart_plus_ad_id);

    console.log('\n========================================');
    console.log('✅ 再出稿完了');
    console.log(`   キャンペーン: ${adName}`);
    console.log(`   キャンペーンID: ${campaignId}`);
    console.log(`   広告グループID: ${adgroupId}`);
    console.log(`   広告ID: ${newAdId}`);
    console.log(`   動画数: ${materials.length}本`);
    console.log(`   日予算: ¥${DAILY_BUDGET}`);
    console.log(`   LP: ${landingPageUrl}`);
    console.log(`   CR番号: ${crStr}`);
    console.log('========================================');

    // 6. DB登録
    console.log('\n8. DB登録...');
    const dbAdv = await prisma.advertiser.findFirst({ where: { tiktokAdvertiserId: SP1_ID } });
    if (dbAdv) {
      const dbCamp = await prisma.campaign.create({
        data: { tiktokId: campaignId, name: adName, advertiserId: dbAdv.id, objectiveType: 'LEAD_GENERATION' },
      });
      const dbAg = await prisma.adGroup.create({
        data: { tiktokId: adgroupId, name: `${ds} 25-54`, campaignId: dbCamp.id, initialBudget: DAILY_BUDGET },
      });
      await prisma.ad.create({
        data: { tiktokId: newAdId, name: adName, adGroupId: dbAg.id },
      });
      console.log('   DB登録完了');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
