import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const ACCOUNTS = [
  { id: '7468288053866561553', name: 'AI_1' },
  { id: '7523128243466551303', name: 'AI_2' },
  { id: '7543540647266074641', name: 'AI_3' },
  { id: '7580666710525493255', name: 'AI_4' },
  { id: '7474920444831875080', name: 'SP1' },
  { id: '7592868952431362066', name: 'SP2' },
  { id: '7616545514662051858', name: 'SP3' },
  { id: '7247073333517238273', name: 'SNS1' },
  { id: '7543540100849156112', name: 'SNS2' },
  { id: '7543540381615800337', name: 'SNS3' },
];

async function getMaxCR(advertiserId: string, advName: string) {
  let maxCR = 0;
  // 通常広告
  const resp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/ad/get/', {
    headers: { 'Access-Token': ACCESS_TOKEN },
    params: { advertiser_id: advertiserId, page_size: 100 },
  });
  const ads = resp.data.data?.list || [];
  for (const ad of ads) {
    const m = ad.ad_name?.match(/CR(\d{4,5})/);
    if (m) maxCR = Math.max(maxCR, parseInt(m[1]));
  }

  // Smart+
  const spResp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/ad/get/', {
    headers: { 'Access-Token': ACCESS_TOKEN },
    params: { advertiser_id: advertiserId, page_size: 100 },
  });
  const spAds = spResp.data.data?.list || [];
  for (const ad of spAds) {
    const m = ad.ad_name?.match(/CR(\d{4,5})/);
    if (m) maxCR = Math.max(maxCR, parseInt(m[1]));
  }

  return maxCR;
}

async function main() {
  let globalMax = 0;
  for (const acc of ACCOUNTS) {
    const max = await getMaxCR(acc.id, acc.name);
    if (max > 0) console.log(`${acc.name}: 最大CR番号 = CR${String(max).padStart(5, '0')}`);
    globalMax = Math.max(globalMax, max);
  }
  console.log(`\n全体の最大: CR${String(globalMax).padStart(5, '0')}`);
  console.log(`次に使うべき番号: CR${String(globalMax + 1).padStart(5, '0')}, CR${String(globalMax + 2).padStart(5, '0')}`);
}

main().catch(console.error);
