import * as dotenv from 'dotenv';
dotenv.config();

const TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const ADV_ID = '7474920444831875080'; // SP1
const AD_ID = '1859972718388450'; // LP2-CR00507

async function main() {
  // TikTok APIから直接日別レポートを取得
  const params = new URLSearchParams();
  params.set('advertiser_id', ADV_ID);
  params.set('data_level', 'AUCTION_AD');
  params.set('report_type', 'BASIC');
  params.set('dimensions', JSON.stringify(['stat_time_day', 'ad_id']));
  params.set('metrics', JSON.stringify(['impressions', 'clicks', 'spend', 'ctr', 'cpc', 'cpm']));
  params.set('start_date', '2026-03-14');
  params.set('end_date', '2026-03-20');
  params.set('page', '1');
  params.set('page_size', '1000');

  const url = `https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/?${params.toString()}`;
  const resp = await fetch(url, { headers: { 'Access-Token': TOKEN } });
  const data = await resp.json() as any;

  console.log(`code: ${data.code}, message: ${data.message}`);
  console.log(`レコード数: ${data.data?.list?.length || 0}`);

  if (data.data?.list) {
    for (const r of data.data.list) {
      const d = r.dimensions?.stat_time_day;
      const m = r.metrics;
      console.log(`  ${d} | spend=¥${m?.spend} | imp=${m?.impressions} | clicks=${m?.clicks}`);
    }
  }
}
main();
