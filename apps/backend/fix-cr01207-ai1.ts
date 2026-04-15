import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const AI1 = '7468288053866561553';

async function main() {
  // 誤って作成したSNS版を停止
  console.log('1. 誤作成のSNS版(1862148866683122)を停止...');
  const disableResp = await axios.post(
    'https://business-api.tiktok.com/open_api/v1.3/ad/status/update/',
    {
      advertiser_id: AI1,
      ad_ids: ['1862148866683122'],
      operation_status: 'DISABLE',
    },
    { headers: { 'Access-Token': ACCESS_TOKEN } },
  );
  console.log('停止結果:', JSON.stringify(disableResp.data));
}

main().catch(console.error);
