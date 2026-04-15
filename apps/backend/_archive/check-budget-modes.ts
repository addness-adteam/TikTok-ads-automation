import axios from 'axios';

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SP1 = '7474920444831875080';

async function main() {
  // 今日作った4つのadgroupを比較
  const ids = [
    '1862150173126849', // CR00613
    '1862150030125057', // CR00614
    '1862150264740002', // CR00616
    '1862150389794833', // CR00617
  ];

  const resp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/adgroup/get/', {
    headers: { 'Access-Token': ACCESS_TOKEN },
    params: {
      advertiser_id: SP1,
      filtering: JSON.stringify({ adgroup_ids: ids }),
    },
  });

  const ags = resp.data.data?.list || [];
  for (const ag of ags) {
    console.log(`${ag.adgroup_id} | budget: ${ag.budget} | mode: ${ag.budget_mode} | ${ag.adgroup_name}`);
  }
}

main().catch(console.error);
