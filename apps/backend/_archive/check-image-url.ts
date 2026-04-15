import * as dotenv from 'dotenv';
dotenv.config();

const TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const API = 'https://business-api.tiktok.com/open_api';
const ADV_ID = '7474920444831875080'; // SP1

async function main() {
  // LP2-CR00494のSmart+広告から画像情報を取得
  const params = new URLSearchParams();
  params.set('advertiser_id', ADV_ID);
  params.set('filtering', JSON.stringify({ smart_plus_ad_ids: ['1859608524699041'] }));
  const resp = await fetch(`${API}/v1.3/smart_plus/ad/get/?${params}`, { headers: { 'Access-Token': TOKEN } });
  const data = await resp.json() as any;
  const ad = data.data?.list?.[0];
  if (!ad) { console.log('Ad not found'); return; }

  console.log('creative_list length:', ad.creative_list?.length);
  const creative = ad.creative_list?.[0];
  console.log('\n=== creative_info ===');
  console.log('ad_format:', creative?.creative_info?.ad_format);
  console.log('image_info:', JSON.stringify(creative?.creative_info?.image_info, null, 2));

  // web_uriから画像URLを取得する方法を確認
  const webUri = creative?.creative_info?.image_info?.[0]?.web_uri;
  console.log('\nweb_uri:', webUri);

  // /v1.3/file/image/ad/info/ で画像情報を取得
  if (webUri) {
    const imgParams = new URLSearchParams();
    imgParams.set('advertiser_id', ADV_ID);
    imgParams.set('image_ids', JSON.stringify([webUri]));
    const imgResp = await fetch(`${API}/v1.3/file/image/ad/info/?${imgParams}`, { headers: { 'Access-Token': TOKEN } });
    const imgData = await imgResp.json() as any;
    console.log('\n=== image/ad/info response ===');
    console.log(JSON.stringify(imgData, null, 2).slice(0, 1000));
  }

  // 全creativeの画像情報を表示
  console.log('\n=== 全creative画像一覧 ===');
  for (let i = 0; i < (ad.creative_list?.length || 0); i++) {
    const c = ad.creative_list[i];
    const ci = c.creative_info;
    const imgs = ci?.image_info || [];
    console.log(`[${i}] format=${ci?.ad_format}, images=${imgs.length}, web_uris=${imgs.map((img: any) => img.web_uri).join(', ')}`);
  }
}
main();
