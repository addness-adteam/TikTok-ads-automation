import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, 'apps/backend/.env') });

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

async function tiktokGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

const ACCOUNTS = {
  'SNS1': '7247073333517238273',
  'SNS2': '7543540100849156112',
  'SNS3': '7543540381615800337',
  'SP1': '7474920444831875080',
  'SP2': '7592868952431362066',
  'SP3': '7616545514662051858',
};

async function main() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const endDate = new Date(jst);
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - 6);

  const formatDate = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

  console.log(`期間: ${formatDate(startDate)} 〜 ${formatDate(endDate)}`);

  for (const [name, advId] of Object.entries(ACCOUNTS)) {
    console.log(`\n=== ${name} (${advId}) ===`);

    // アカウント全体のメトリクス
    try {
      const data = await tiktokGet('/v1.3/report/integrated/get/', {
        advertiser_id: advId,
        report_type: 'BASIC',
        data_level: 'AUCTION_ADVERTISER',
        dimensions: JSON.stringify(['advertiser_id']),
        metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversion', 'cpc', 'ctr', 'conversion_rate', 'cost_per_conversion']),
        start_date: formatDate(startDate),
        end_date: formatDate(endDate),
      });

      if (data.code === 0 && data.data?.list?.length) {
        const m = data.data.list[0].metrics;
        console.log(`  7日合計: spend=¥${parseFloat(m.spend).toFixed(0)}, imp=${m.impressions}, click=${m.clicks}, CV=${m.conversion}`);
        console.log(`  CPC=¥${parseFloat(m.cpc).toFixed(1)}, CTR=${(parseFloat(m.ctr)*100).toFixed(2)}%, CVR=${(parseFloat(m.conversion_rate)*100).toFixed(2)}%, CPA=¥${parseFloat(m.cost_per_conversion).toFixed(0)}`);
      } else {
        console.log(`  メトリクス取得失敗: ${data.message || JSON.stringify(data)}`);
      }
    } catch (e: any) {
      console.log(`  エラー: ${e.message}`);
    }

    // 広告単位のトップ5（spend降順）
    try {
      const adData = await tiktokGet('/v1.3/report/integrated/get/', {
        advertiser_id: advId,
        report_type: 'BASIC',
        data_level: 'AUCTION_AD',
        dimensions: JSON.stringify(['ad_id']),
        metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversion', 'cpc', 'ctr', 'conversion_rate']),
        start_date: formatDate(startDate),
        end_date: formatDate(endDate),
        order_field: 'spend',
        order_type: 'DESC',
        page_size: '5',
      });

      if (adData.code === 0 && adData.data?.list?.length) {
        console.log(`  TOP5広告（消化順）:`);
        for (const item of adData.data.list) {
          const m = item.metrics;
          console.log(`    ad_id=${item.dimensions.ad_id}: spend=¥${parseFloat(m.spend).toFixed(0)}, imp=${m.impressions}, click=${m.clicks}, CV=${m.conversion}, CPC=¥${parseFloat(m.cpc).toFixed(1)}, CVR=${(parseFloat(m.conversion_rate)*100).toFixed(2)}%`);
        }
      }
    } catch (e: any) {
      console.log(`  広告メトリクス取得エラー: ${e.message}`);
    }
  }
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
