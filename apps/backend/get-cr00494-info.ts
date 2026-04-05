import * as dotenv from 'dotenv';
dotenv.config();
const TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const API = 'https://business-api.tiktok.com/open_api';

async function main() {
  const params = new URLSearchParams();
  params.set('advertiser_id', '7474920444831875080');
  params.set('filtering', JSON.stringify({ smart_plus_ad_ids: ['1859608524699041'] }));
  const resp = await fetch(`${API}/v1.3/smart_plus/ad/get/?${params}`, { headers: { 'Access-Token': TOKEN } });
  const data = await resp.json() as any;
  const ad = data.data?.list?.[0];
  if (!ad) { console.log('Not found. Full response:', JSON.stringify(data).slice(0, 500)); return; }

  console.log('ad_name:', ad.smart_plus_ad_name);
  const creatives = ad.creative_list || [];
  console.log('動画数:', creatives.length);

  for (let i = 0; i < Math.min(3, creatives.length); i++) {
    const c = creatives[i];
    console.log(`\n--- creative[${i}] ---`);
    console.log('video_id:', c.tiktok_item_id || c.video_id);
    console.log(JSON.stringify(c).slice(0, 300));
  }
}
main();
