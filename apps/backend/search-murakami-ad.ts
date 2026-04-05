import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

const ACCOUNTS = [
  { name: 'AI_1', id: '7468288053866561553' },
  { name: 'AI_2', id: '7523128243466551303' },
  { name: 'AI_3', id: '7543540647266074641' },
  { name: 'AI_4', id: '7580666710525493255' },
  { name: 'SP1', id: '7474920444831875080' },
  { name: 'SP2', id: '7592868952431362066' },
  { name: 'SP3', id: '7616545514662051858' },
  { name: 'SNS1', id: '7247073333517238273' },
  { name: 'SNS2', id: '7543540100849156112' },
  { name: 'SNS3', id: '7543540381615800337' },
];

async function main() {
  for (const account of ACCOUNTS) {
    try {
      const response = await axios.get('https://business-api.tiktok.com/open_api/v1.3/ad/get/', {
        params: {
          advertiser_id: account.id,
          page_size: 100,
          fields: JSON.stringify(['ad_id', 'ad_name', 'campaign_id', 'status', 'opt_status']),
        },
        headers: { 'Access-Token': ACCESS_TOKEN },
      });
      const ads = response.data?.data?.list || [];
      const matched = ads.filter((a: any) =>
        a.ad_name?.includes('村上幸太朗') || a.ad_name?.includes('CR29527')
      );
      const total = response.data?.data?.page_info?.total_number || 0;
      if (matched.length > 0) {
        console.log(`\n★★★ ${account.name} (${account.id}) - ${matched.length}件マッチ ★★★`);
        for (const ad of matched) {
          console.log(`  ${ad.ad_name} (id: ${ad.ad_id}, status: ${ad.status}, opt: ${ad.opt_status})`);
        }
      } else {
        console.log(`${account.name}: ${total}件中マッチなし`);
      }
    } catch (e: any) {
      console.log(`${account.name}: エラー - ${e.message}`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
