/**
 * SP3マルチ動画キャンペーン リトライ2
 * - 横展開と同じパラメータで試行
 */

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SP3 = '7616545514662051858';

import { PrismaClient } from '@prisma/client';

const SP3_VIDEO_IDS = [
  'v10033g50000d7aghp7og65jm8eun9jg', 'v10033g50000d7aghrfog65lvohfp0sg',
  'v10033g50000d7aghtvog65q2b04iodg', 'v10033g50000d7agi17og65lbb4qi6fg',
  'v10033g50000d7agi3fog65kc5cr05u0', 'v10033g50000d7agi6vog65kml799790',
  'v10033g50000d7agia7og65mkk95eerg', 'v10033g50000d7agidfog65g6rpfvqvg',
  'v10033g50000d7agihfog65i8549kdmg', 'v10033g50000d7agikvog65jt7hhd850',
  'v10033g50000d7agionog65o5m680a20', 'v10033g50000d7agirvog65hrk0avasg',
  'v10033g50000d7agivvog65vhipenms0', 'v10033g50000d7agj47og65nldlb3ong',
  'v10033g50000d7agj7fog65kg6hsdvbg', 'v10033g50000d7agjbfog65hlou5qt80',
  'v10033g50000d7agjenog65knkierukg', 'v10033g50000d7agjhvog65h2e93fa10',
  'v10033g50000d7agjkvog65ktneagjbg', 'v10033g50000d7agjo7og65nge2a7hpg',
  'v10033g50000d7agjqvog65jie3ujdr0', 'v10033g50000d7agjufog65r1p516i10',
  'v10033g50000d7agk27og65rg5plgg80',
];

const LANDING_PAGE_URL = 'https://school.addness.co.jp/p/doc7hffUAVTv?ftid=ER7SW3k2TQmN&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid';
const AD_NAME = '260408/清水絢吾/セミまとめ+追加動画/LP2-CR00598';
const AD_TEXT = 'スキルで独立するなら学んでおきたい本質のスキル活用術特商法（https://skill.addness.co.jp/tokushoho）';

function getScheduleStartTime(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  if (jst.getUTCHours() >= 15) {
    return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')} 15:00:00`;
  }
  const t = new Date(Date.now() + 5 * 60 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}:${String(t.getUTCSeconds()).padStart(2, '0')}`;
}

async function tiktokApi(endpoint: string, body: any): Promise<any> {
  console.log(`  API: ${endpoint}`);
  console.log(`  params: ${JSON.stringify(body).substring(0, 300)}`);
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Access-Token': ACCESS_TOKEN },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (data.code !== 0) {
    console.error(`  Error: ${JSON.stringify(data)}`);
    throw new Error(`${data.message} (code: ${data.code})`);
  }
  return data;
}

async function tiktokGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const adv = await prisma.advertiser.findUnique({
      where: { tiktokAdvertiserId: SP3 },
      select: { pixelId: true, identityId: true, identityAuthorizedBcId: true, name: true },
    });
    if (!adv) throw new Error('SP3 not found');

    const ctaData = await tiktokGet('/v1.3/smart_plus/ad/get/', { advertiser_id: SP3, page_size: '5' });
    const ctaId = ctaData.data?.list?.[0]?.ad_configuration?.call_to_action_id || '';

    // 横展開と全く同じパラメータで作成
    console.log('=== キャンペーン作成（横展開と同じパラメータ） ===');
    const data = await tiktokApi('/v1.3/smart_plus/campaign/create/', {
      advertiser_id: SP3,
      campaign_name: AD_NAME,
      objective_type: 'LEAD_GENERATION',
      budget_optimize_on: false,
      budget_mode: 'BUDGET_MODE_INFINITE',
      request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
    });
    const campaignId = String(data.data.campaign_id);
    console.log(`キャンペーンID: ${campaignId}`);

    console.log('=== 広告グループ作成 ===');
    const agData = await tiktokApi('/v1.3/smart_plus/adgroup/create/', {
      advertiser_id: SP3,
      campaign_id: campaignId,
      adgroup_name: '260408 25-54',
      budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET',
      budget: 5000,
      billing_event: 'OCPM',
      bid_type: 'BID_TYPE_NO_BID',
      optimization_goal: 'CONVERT',
      optimization_event: 'ON_WEB_REGISTER',
      pixel_id: adv.pixelId,
      promotion_type: 'LEAD_GENERATION',
      promotion_target_type: 'EXTERNAL_WEBSITE',
      placement_type: 'PLACEMENT_TYPE_NORMAL',
      placements: ['PLACEMENT_TIKTOK'],
      comment_disabled: true,
      schedule_type: 'SCHEDULE_FROM_NOW',
      schedule_start_time: getScheduleStartTime(),
      targeting_optimization_mode: 'MANUAL',
      targeting_spec: {
        location_ids: ['1861060'],
        age_groups: ['AGE_25_34', 'AGE_35_44', 'AGE_45_54'],
      },
      request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
    });
    const adgroupId = String(agData.data.adgroup_id);
    console.log(`広告グループID: ${adgroupId}`);

    console.log('=== 広告作成 ===');
    const creative_list = SP3_VIDEO_IDS.map(videoId => ({
      creative_info: {
        ad_format: 'SINGLE_VIDEO',
        video_info: { video_id: videoId },
        identity_id: adv.identityId,
        identity_type: 'BC_AUTH_TT',
        identity_authorized_bc_id: adv.identityAuthorizedBcId,
      },
    }));

    const adData = await tiktokApi('/v1.3/smart_plus/ad/create/', {
      advertiser_id: SP3,
      adgroup_id: adgroupId,
      ad_name: AD_NAME,
      creative_list,
      ad_text_list: [{ ad_text: AD_TEXT }],
      landing_page_url_list: [{ landing_page_url: LANDING_PAGE_URL }],
      ad_configuration: { call_to_action_id: ctaId },
      operation_status: 'ENABLE',
      request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
    });
    const adId = String(adData.data?.ad_id || adData.data?.smart_plus_ad_id);
    console.log(`広告ID: ${adId}`);

    console.log('\n===== SP3マルチ動画 完了 =====');
    console.log(`広告名: ${AD_NAME}`);
    console.log(`キャンペーンID: ${campaignId}`);
    console.log(`広告グループID: ${adgroupId}`);
    console.log(`広告ID: ${adId}`);
    console.log(`動画数: ${SP3_VIDEO_IDS.length}本`);

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
