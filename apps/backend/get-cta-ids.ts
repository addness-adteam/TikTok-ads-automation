import axios from 'axios';
const T = 'https://business-api.tiktok.com/open_api';
const K = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

async function main() {
  for (const [name, id] of [['SP1', '7474920444831875080'], ['SP2', '7592868952431362066'], ['SP3', '7616545514662051858']]) {
    console.log(`\n=== ${name} ===`);
    try {
      const r = await axios.get(`${T}/v1.3/creative/call_to_action/get/`, {
        headers: { 'Access-Token': K },
        params: { advertiser_id: id },
      });
      const ctas = r.data?.data?.list || r.data?.data || [];
      if (Array.isArray(ctas)) {
        for (const c of ctas.slice(0, 10)) {
          console.log(`  ${c.call_to_action_id} | ${c.call_to_action} | ${c.display_name}`);
        }
      } else {
        console.log(JSON.stringify(r.data, null, 2).substring(0, 500));
      }
    } catch (e: any) {
      console.log(`  Error: ${e.response?.data?.message || e.message}`);
      // 別のエンドポイント
      try {
        const r2 = await axios.get(`${T}/v1.3/tool/call_to_action/get/`, {
          headers: { 'Access-Token': K },
          params: { advertiser_id: id, objective_type: 'LEAD_GENERATION' },
        });
        console.log('  tool/call_to_action:', JSON.stringify(r2.data?.data).substring(0, 500));
      } catch (e2: any) {
        console.log(`  tool/call_to_action error: ${e2.response?.data?.message || e2.message}`);
      }
    }
  }
}
main().catch(console.error);
