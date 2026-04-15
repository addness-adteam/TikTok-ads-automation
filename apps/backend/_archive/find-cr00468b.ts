import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SP1 = '7474920444831875080';

async function tiktokGet(endpoint: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const resp = await fetch(`https://business-api.tiktok.com/open_api${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

async function main() {
  // 直接ad_id指定で取得
  console.log('=== ad_id直接指定 ===');
  const r1 = await tiktokGet('/v1.3/ad/get/', {
    advertiser_id: SP1,
    filtering: JSON.stringify({ ad_ids: ['1858931396655186'] }),
    fields: JSON.stringify(['ad_id', 'ad_name', 'operation_status', 'campaign_id', 'adgroup_id', 'video_id', 'ad_text']),
  });
  console.log(JSON.stringify(r1, null, 2));

  // Smart+キャンペーンも確認
  console.log('\n=== Smart+キャンペーン一覧 ===');
  const r2 = await tiktokGet('/v1.3/smart_plus/campaign/get/', {
    advertiser_id: SP1,
    page_size: '100',
  });
  if (r2.code === 0 && r2.data?.list) {
    for (const c of r2.data.list) {
      const name = c.campaign_name || c.smart_plus_ad_name || '';
      if (name.includes('CR00468') || name.includes('468')) {
        console.log(JSON.stringify(c, null, 2));
      }
    }
    // 全キャンペーン名も表示
    console.log('\n全キャンペーン:');
    for (const c of r2.data.list) {
      console.log(`  ${c.smart_plus_ad_id} | ${c.campaign_name || c.smart_plus_ad_name || 'N/A'} | ${c.operation_status}`);
    }
  }
}
main();
