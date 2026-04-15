/**
 * Smart+ adgroup/get APIの動作検証
 * 通常adgroup/getで取れないSmart+広告グループが取得できるか確認
 */
import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SP1 = '7474920444831875080'; // スキルプラス1

// CR00613, CR00614, CR00616, CR00617 のadgroup_id
const ADGROUP_IDS = [
  '1862150173126849', // CR00613
  '1862150030125057', // CR00614
  '1862150264740002', // CR00616
  '1862150389794833', // CR00617
];

async function main() {
  console.log('=== 1. 通常 adgroup/get API ===');
  try {
    const resp1 = await axios.get('https://business-api.tiktok.com/open_api/v1.3/adgroup/get/', {
      headers: { 'Access-Token': ACCESS_TOKEN },
      params: {
        advertiser_id: SP1,
        filtering: JSON.stringify({ adgroup_ids: ADGROUP_IDS }),
      },
    });
    const list1 = resp1.data.data?.list || [];
    console.log(`取得件数: ${list1.length}/${ADGROUP_IDS.length}`);
    for (const ag of list1) {
      console.log(`  ${ag.adgroup_id} | budget: ${ag.budget} | ${ag.adgroup_name}`);
    }
    const foundIds = new Set(list1.map((ag: any) => ag.adgroup_id));
    const missing = ADGROUP_IDS.filter(id => !foundIds.has(id));
    console.log(`通常APIで取得できなかった: ${missing.length > 0 ? missing.join(', ') : 'なし'}`);
  } catch (e: any) {
    console.error('通常API エラー:', e.response?.data || e.message);
  }

  console.log('\n=== 2. Smart+ adgroup/get API ===');
  try {
    const resp2 = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/adgroup/get/', {
      headers: { 'Access-Token': ACCESS_TOKEN },
      params: {
        advertiser_id: SP1,
        adgroup_ids: JSON.stringify(ADGROUP_IDS),
      },
    });
    console.log(`code: ${resp2.data.code}, message: ${resp2.data.message}`);
    const list2 = resp2.data.data?.list || [];
    console.log(`取得件数: ${list2.length}/${ADGROUP_IDS.length}`);
    for (const ag of list2) {
      console.log(`  ${ag.adgroup_id} | budget: ${ag.budget} | budget_mode: ${ag.budget_mode} | ${ag.adgroup_name || '(no name)'}`);
    }
  } catch (e: any) {
    console.error('Smart+ API エラー:', e.response?.data || e.message);
  }
}

main().catch(console.error);
