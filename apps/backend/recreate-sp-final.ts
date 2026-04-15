/**
 * スマプラ最終版: ディープファネル最適化を正しく設定
 * 正しいパラメータ: deep_funnel_optimization_status, deep_funnel_optimization_event, deep_funnel_event_source, deep_funnel_event_source_id
 * （deep_external_actionはSmart+では効かない）
 */
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';
const ADV = '7468288053866561553';
const PIXEL_ID = '7395091852346654737';
const IDENTITY_ID = '6fac7e18-0297-5ad3-9849-1de69197cd95';
const BC_ID = '7440019834009829392';

const AD_TEXT = 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）';
const LP_URL = 'https://school.addness.co.jp/p/r2RHcL0PdGIY?ftid=Q8OAxDH76Gmf&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid';
const AD_NAME = '260409/スマプラ/CR01131_CR01172_CR01169_CR01161_CR01144_CR01165/LP1-CR01192';

const VIDS = [
  'v10033g50000d73jgovog65rempsvtcg',
  'v10033g50000d10mfl7og65trcf42l5g',
  'v10033g50000d5reklnog65uj38psptg',
  'v10033g50000d34k1pnog65l9k1377d0',
  'v10033g50000d6onmc7og65m24ip5vig',
  'v10033g50000d6pv7lnog65gfhdsgfug',
];

// 前回アップロード済みカバー画像
const COVERS = [
  'ad-site-i18n-sg/20260408c7c7a46709e5a14d425594a4',
  'ad-site-i18n-sg/20260408c7c769d3398e5c9f4702b62f',
  'ad-site-i18n-sg/20260408c7c7e245a944a0324612a7da',
  'ad-site-i18n-sg/20260408c7c7a59ac86a1ab848ee89bb',
  'ad-site-i18n-sg/20260408c7c766da7a30df2f4dce9f3b',
  'ad-site-i18n-sg/20260408c7c72c432a242db54a018890',
];

async function api(endpoint: string, body: any): Promise<any> {
  const resp = await fetch(`${BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Access-Token': ACCESS_TOKEN },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`${endpoint}: ${data.message} (${data.code})`);
  return data;
}

async function get(endpoint: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const resp = await fetch(`${BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

async function main() {
  // 1. 旧キャンペーン停止
  console.log('1. 旧キャンペーン停止...');
  try {
    await api('/v1.3/smart_plus/campaign/status/update/', {
      advertiser_id: ADV,
      campaign_ids: ['1861909219829826'],
      operation_status: 'DISABLE',
    });
    console.log('   OK');
  } catch (e: any) { console.log('   ' + e.message); }

  // 2. 新キャンペーン
  console.log('\n2. キャンペーン作成...');
  const camp = await api('/v1.3/smart_plus/campaign/create/', {
    advertiser_id: ADV,
    campaign_name: AD_NAME,
    objective_type: 'LEAD_GENERATION',
    budget_mode: 'BUDGET_MODE_INFINITE',
    budget_optimize_on: false,
    request_id: Date.now() + '' + Math.floor(Math.random() * 100000),
  });
  const campaignId = String(camp.data.campaign_id);
  console.log('   ID: ' + campaignId);

  // 3. 広告グループ（ディープファネル正しいパラメータ）
  console.log('\n3. 広告グループ作成...');
  console.log('   deep_funnel_optimization_status: ON');
  console.log('   deep_funnel_optimization_event: SHOPPING');
  console.log('   deep_funnel_event_source: PIXEL');
  const ag = await api('/v1.3/smart_plus/adgroup/create/', {
    advertiser_id: ADV,
    campaign_id: campaignId,
    adgroup_name: '260409 25-34, 35-44, 45-54 DF',
    budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET',
    budget: 3000,
    billing_event: 'OCPM',
    bid_type: 'BID_TYPE_NO_BID',
    optimization_goal: 'CONVERT',
    optimization_event: 'ON_WEB_REGISTER',
    // ディープファネル（Smart+用の正しいパラメータ）
    deep_funnel_optimization_status: 'ON',
    deep_funnel_optimization_event: 'SHOPPING',
    deep_funnel_event_source: 'PIXEL',
    deep_funnel_event_source_id: PIXEL_ID,
    pixel_id: PIXEL_ID,
    promotion_type: 'LEAD_GENERATION',
    promotion_target_type: 'EXTERNAL_WEBSITE',
    placement_type: 'PLACEMENT_TYPE_NORMAL',
    placements: ['PLACEMENT_TIKTOK'],
    comment_disabled: true,
    schedule_type: 'SCHEDULE_FROM_NOW',
    schedule_start_time: '2026-04-08 15:00:00',
    targeting_optimization_mode: 'MANUAL',
    targeting_spec: {
      location_ids: ['1861060'],
      age_groups: ['AGE_25_34', 'AGE_35_44', 'AGE_45_54'],
      excluded_audience_ids: ['194977234', '194405484', '195006413'],
    },
    request_id: Date.now() + '' + Math.floor(Math.random() * 100000),
  });
  const adgroupId = String(ag.data.adgroup_id);
  console.log('   ID: ' + adgroupId);

  // 検証
  console.log('   検証中...');
  await new Promise(r => setTimeout(r, 5000));
  const v = await get('/v1.3/smart_plus/adgroup/get/', {
    advertiser_id: ADV,
    adgroup_ids: JSON.stringify([adgroupId]),
  });
  const agData = v.data?.list?.[0];
  const deepFields: Record<string, any> = {};
  for (const [k, val] of Object.entries(agData || {})) {
    if (k.includes('deep') || k.includes('funnel')) deepFields[k] = val;
  }
  console.log('   deep_funnel:', JSON.stringify(deepFields));
  console.log('   targeting_mode:', agData?.targeting_optimization_mode);
  console.log('   excluded:', JSON.stringify(agData?.targeting_spec?.excluded_audience_ids));

  // 4. 広告作成
  console.log('\n4. 広告作成（1広告 × 6動画）...');
  const ctaData = await get('/v1.3/smart_plus/ad/get/', { advertiser_id: ADV, page_size: '5' });
  const ctaId = ctaData.data?.list?.[0]?.ad_configuration?.call_to_action_id || '';

  const creativeList = VIDS.map((vid, i) => ({
    creative_info: {
      ad_format: 'SINGLE_VIDEO',
      video_info: { video_id: vid },
      identity_id: IDENTITY_ID,
      identity_type: 'BC_AUTH_TT',
      identity_authorized_bc_id: BC_ID,
      image_info: [{ web_uri: COVERS[i] }],
    },
  }));

  // リトライ付き
  let adId = '';
  for (let retry = 0; retry < 3; retry++) {
    if (retry > 0) { console.log('   リトライ...'); await new Promise(r => setTimeout(r, 10000)); }
    try {
      const adData = await api('/v1.3/smart_plus/ad/create/', {
        advertiser_id: ADV,
        adgroup_id: adgroupId,
        ad_name: AD_NAME,
        creative_list: creativeList,
        ad_text_list: [{ ad_text: AD_TEXT }],
        landing_page_url_list: [{ landing_page_url: LP_URL }],
        ad_configuration: { call_to_action_id: ctaId },
        operation_status: 'ENABLE',
        request_id: Date.now() + '' + Math.floor(Math.random() * 100000),
      });
      adId = String(adData.data?.ad_id || adData.data?.smart_plus_ad_id);
      break;
    } catch (e: any) {
      console.log('   エラー: ' + e.message);
    }
  }

  console.log('\n===== 完了 =====');
  console.log('キャンペーンID: ' + campaignId);
  console.log('広告グループID: ' + adgroupId);
  console.log('広告ID: ' + adId);
  console.log('ディープファネル: ' + JSON.stringify(deepFields));
}

main().catch(e => { console.error(e); process.exit(1); });
