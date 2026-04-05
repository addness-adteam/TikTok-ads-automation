import axios from 'axios';
const T = 'https://business-api.tiktok.com/open_api';
const K = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
async function main() {
  // SP2のアップロード済み動画のinfo確認
  const vid = 'v10033g50000d6u3ennog65jhbniiupg'; // SP2の1本目
  const r = await axios.get(`${T}/v1.3/file/video/ad/info/`, {
    headers: { 'Access-Token': K },
    params: { advertiser_id: '7592868952431362066', video_ids: JSON.stringify([vid]) },
  });
  const info = r.data?.data?.list?.[0];
  console.log('video_cover_url:', info?.video_cover_url);
  console.log('poster_url:', info?.poster_url);
  // 全フィールドを確認
  console.log('\n全フィールド:', JSON.stringify(info, null, 2));
}
main().catch(e => console.error(e.response?.data || e.message));
