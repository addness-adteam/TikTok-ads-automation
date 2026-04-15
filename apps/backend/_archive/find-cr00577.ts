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
  // Smart+キャンペーンからCR00577を探す
  const r = await tiktokGet('/v1.3/smart_plus/campaign/get/', { advertiser_id: SP1, page_size: '100' });
  for (const c of r.data?.list || []) {
    if ((c.campaign_name || '').includes('CR00577')) {
      console.log(`campaign_id: ${c.campaign_id}`);
      console.log(`campaign_name: ${c.campaign_name}`);
      console.log(`status: ${c.operation_status}`);
      console.log(`mode: ${c.smart_plus_adgroup_mode}`);
      console.log('');

      // 広告取得
      const ads = await tiktokGet('/v1.3/ad/get/', {
        advertiser_id: SP1,
        filtering: JSON.stringify({ campaign_ids: [c.campaign_id] }),
        fields: JSON.stringify(['ad_id', 'ad_name', 'video_id', 'image_ids']),
        page_size: '100',
      });
      console.log(`広告数: ${ads.data?.list?.length || 0}`);
      for (const a of ads.data?.list || []) {
        console.log(`  ${a.video_id} | ${a.ad_name} | img: ${a.image_ids?.[0] || 'none'}`);
      }
    }
  }
}
main();
