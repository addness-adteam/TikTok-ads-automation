import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

const AI_ACCOUNTS = [
  { id: '7468288053866561553', name: 'AI_1' },
  { id: '7523128243466551303', name: 'AI_2' },
  { id: '7543540647266074641', name: 'AI_3' },
  { id: '7580666710525493255', name: 'AI_4' },
];

async function tiktokGet(endpoint: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const resp = await fetch(`https://business-api.tiktok.com/open_api${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

async function main() {
  for (const acct of AI_ACCOUNTS) {
    // Smart+キャンペーンから探す
    const r = await tiktokGet('/v1.3/smart_plus/campaign/get/', { advertiser_id: acct.id, page_size: '100' });
    for (const c of r.data?.list || []) {
      if ((c.campaign_name || '').includes('CR01150')) {
        console.log(`[${acct.name}] Smart+キャンペーン`);
        console.log(`  campaign_id: ${c.campaign_id}`);
        console.log(`  name: ${c.campaign_name}`);
        console.log(`  status: ${c.operation_status}`);
        console.log(`  mode: ${c.smart_plus_adgroup_mode}`);

        // 広告取得
        const ads = await tiktokGet('/v1.3/ad/get/', {
          advertiser_id: acct.id,
          filtering: JSON.stringify({ campaign_ids: [c.campaign_id] }),
          fields: JSON.stringify(['ad_id', 'ad_name', 'video_id', 'image_ids']),
          page_size: '100',
        });
        console.log(`  広告数: ${ads.data?.list?.length || 0}`);
        for (const a of ads.data?.list || []) {
          console.log(`    ${a.video_id} | ${a.ad_name} | img: ${a.image_ids?.[0] || 'none'}`);
        }
        console.log('');
      }
    }

    // 通常広告からも探す
    let page = 1;
    while (true) {
      const resp = await tiktokGet('/v1.3/ad/get/', {
        advertiser_id: acct.id,
        fields: JSON.stringify(['ad_id', 'ad_name', 'video_id', 'image_ids', 'campaign_id', 'operation_status']),
        page_size: '100',
        page: String(page),
      });
      if (resp.code !== 0) break;
      const list = resp.data?.list || [];
      for (const a of list) {
        if ((a.ad_name || '').toUpperCase().includes('CR01150')) {
          console.log(`[${acct.name}] 通常広告`);
          console.log(`  ad_id: ${a.ad_id} | campaign_id: ${a.campaign_id}`);
          console.log(`  name: ${a.ad_name}`);
          console.log(`  video: ${a.video_id} | status: ${a.operation_status}`);
          console.log(`  img: ${a.image_ids?.[0] || 'none'}`);
          console.log('');
        }
      }
      if (list.length < 100) break;
      page++;
    }
  }
}
main();
