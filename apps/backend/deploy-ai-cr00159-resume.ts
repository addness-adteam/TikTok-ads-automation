/**
 * AI CR00159 再開 - キャンペーン・UTAGE・動画UL済み → 広告グループ・広告作成
 */
import axios from 'axios';
const TIKTOK_API = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BC_ID = '7440019834009829392';
const adText = 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）';

const deploys = [
  {
    name: 'AI2', id: '7523128243466551303',
    pixelId: '7395091852346654737', identityId: '6fac7e18-0297-5ad3-9849-1de69197cd95',
    ctaId: '7618932408628431890',
    campaignId: '1860116987331794',
    videoId: 'v10033g50000d6u49j7og65n7m8henp0',
    adName: '260320/清水絢吾/林社長/冒頭③_コピー6/LP2-CR00230',
    utageReg: 'TikTok広告-AI-LP2-CR00230',
    utageLp: 'https://school.addness.co.jp/p/EnFeDysozIui?ftid=XWBY8c1nlL52',
  },
  {
    name: 'AI3', id: '7543540647266074641',
    pixelId: '7543912551630061575', identityId: '6fac7e18-0297-5ad3-9849-1de69197cd95',
    ctaId: '7618940642458094610',
    campaignId: '1860117037321570',
    videoId: 'v10033g50000d6u4a8nog65h2q8pl0mg',
    adName: '260320/清水絢吾/林社長/冒頭③_コピー6/LP2-CR00231',
    utageReg: 'TikTok広告-AI-LP2-CR00231',
    utageLp: 'https://school.addness.co.jp/p/EnFeDysozIui?ftid=7SqlLCp451Xj',
  },
];

async function tiktokPost(path: string, data: any) {
  return (await axios.post(`${TIKTOK_API}${path}`, data, { headers: { 'Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } })).data;
}

async function main() {
  for (const d of deploys) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 CR00159 → ${d.name}`);
    console.log(`  キャンペーン: ${d.campaignId}, 動画: ${d.videoId}`);

    try {
      // カバー画像
      const vi = await axios.get(`${TIKTOK_API}/v1.3/file/video/ad/info/`, {
        headers: { 'Access-Token': ACCESS_TOKEN },
        params: { advertiser_id: d.id, video_ids: JSON.stringify([d.videoId]) },
      });
      const coverUrl = vi.data?.data?.list?.[0]?.video_cover_url || '';
      const webUri = coverUrl.match(/(tos-[^~?]+)/)?.[1] || '';

      // 広告グループ作成
      console.log('  1. 広告グループ作成...');
      const agResp = await tiktokPost('/v1.3/smart_plus/adgroup/create/', {
        advertiser_id: d.id, campaign_id: d.campaignId, adgroup_name: '260320 ノンタゲ',
        budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET', budget: 3000,
        bid_type: 'BID_TYPE_NO_BID', billing_event: 'OCPM',
        optimization_goal: 'CONVERT', optimization_event: 'ON_WEB_REGISTER',
        pixel_id: d.pixelId, schedule_type: 'SCHEDULE_FROM_NOW',
        schedule_start_time: new Date(Date.now() + 10 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19),
        pacing: 'PACING_MODE_SMOOTH', skip_learning_phase: true,
        placement_type: 'PLACEMENT_TYPE_AUTOMATIC',
        targeting_spec: { location_ids: ['1861060'], age_groups: ['AGE_18_24', 'AGE_25_34', 'AGE_35_44', 'AGE_45_54', 'AGE_55_100'], gender: 'GENDER_UNLIMITED', languages: ['ja'] },
        promotion_type: 'LEAD_GENERATION', promotion_target_type: 'EXTERNAL_WEBSITE',
        request_id: String(Date.now()) + String(Math.floor(Math.random() * 10000)),
      });
      if (agResp.code !== 0) throw new Error(`AdGroup: ${JSON.stringify(agResp)}`);
      const adgroupId = String(agResp.data?.adgroup_id);
      console.log(`    adgroup_id: ${adgroupId}`);

      // 広告作成
      console.log('  2. 広告作成...');
      const lpUrl = `${d.utageLp}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;
      const adResp = await tiktokPost('/v1.3/smart_plus/ad/create/', {
        advertiser_id: d.id, adgroup_id: adgroupId, ad_name: d.adName,
        creative_list: [{
          creative_info: {
            ad_format: 'SINGLE_VIDEO',
            video_info: { video_id: d.videoId },
            image_info: webUri ? [{ web_uri: webUri }] : [],
            identity_id: d.identityId, identity_type: 'BC_AUTH_TT', identity_authorized_bc_id: BC_ID,
          },
        }],
        ad_text_list: [{ ad_text: adText }],
        landing_page_url_list: [{ landing_page_url: lpUrl }],
        ad_configuration: { call_to_action_id: d.ctaId, creative_auto_add_toggle: true, dark_post_status: 'ON' },
        operation_status: 'ENABLE',
        request_id: String(Date.now()) + String(Math.floor(Math.random() * 10000)),
      });
      if (adResp.code !== 0) throw new Error(`Ad: ${JSON.stringify(adResp)}`);

      console.log(`  ✅ 成功!`);
      console.log(`    Ad Name: ${d.adName}`);
      console.log(`    UTAGE経路: ${d.utageReg}`);
      console.log(`    日予算: ¥3,000`);
    } catch (e: any) {
      console.log(`  ❌ エラー: ${e.message?.substring(0, 300)}`);
    }
  }
  console.log('\n=== 完了 ===');
}
main().catch(console.error);
