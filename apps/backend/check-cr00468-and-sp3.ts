import axios from 'axios';
const T = 'https://business-api.tiktok.com/open_api';
const K = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

async function main() {
  // 1. ad/get で通常広告として取得
  console.log('=== 1. ad/get ===');
  const r1 = await axios.get(`${T}/v1.3/ad/get/`, {
    headers: { 'Access-Token': K },
    params: {
      advertiser_id: '7474920444831875080',
      filtering: JSON.stringify({ ad_ids: ['1858931396655186'] }),
      fields: JSON.stringify(['ad_id', 'ad_name', 'video_id', 'ad_text', 'landing_page_url', 'creative_type']),
    },
  });
  const ad = r1.data?.data?.list?.[0];
  console.log(JSON.stringify(ad, null, 2));

  // 2. smart_plus/ad/get 全取得でCR00468を探す
  console.log('\n=== 2. Smart+ 全取得 ===');
  let page = 1;
  let found = false;
  while (!found && page <= 20) {
    const r2 = await axios.get(`${T}/v1.3/smart_plus/ad/get/`, {
      headers: { 'Access-Token': K },
      params: {
        advertiser_id: '7474920444831875080',
        page: page,
        page_size: 50,
      },
    });
    const ads = r2.data?.data?.list || [];
    const pageInfo = r2.data?.data?.page_info;
    for (const a of ads) {
      if (a.ad_name?.includes('CR00468')) {
        console.log(`Found on page ${page}!`);
        console.log(`  ad_id: ${a.ad_id}`);
        console.log(`  ad_name: ${a.ad_name}`);
        console.log(`  status: ${a.operation_status}`);
        const vids = (a.creative_list || []).map((c: any) => c?.creative_info?.video_info?.video_id);
        console.log(`  動画数: ${vids.length}`);
        vids.forEach((v: any, i: number) => console.log(`    [${i}] ${v}`));
        const texts = (a.ad_text_list || []).map((t: any) => t.ad_text);
        console.log(`  広告文: ${texts.join(' / ').substring(0, 100)}`);
        found = true;
        break;
      }
    }
    if (!found && (!pageInfo || page * 50 >= pageInfo.total_number)) break;
    page++;
  }
  if (!found) console.log('Smart+ APIでCR00468が見つかりません');

  // 3. SP3 advertiser info
  console.log('\n=== 3. SP3 info ===');
  const r3 = await axios.get(`${T}/v1.3/advertiser/info/`, {
    headers: { 'Access-Token': K },
    params: { advertiser_ids: JSON.stringify(['7616545514662051858']) },
  });
  console.log(JSON.stringify(r3.data?.data?.list?.[0], null, 2));
}
main().catch(e => console.error(e.response?.data || e.message));
