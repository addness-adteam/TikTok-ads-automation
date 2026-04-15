import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(process.cwd(), process.cwd().endsWith('backend') ? '../../.env' : '.env') });
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

async function main() {
  const prisma = new PrismaClient();

  // Active token
  const token = await prisma.oAuthToken.findFirst({
    where: { advertiserId: '7543540647266074641', expiresAt: { gt: new Date() } },
    select: { advertiserId: true, accessToken: true },
  });
  if (!token) { console.log('No active token'); await prisma.$disconnect(); return; }

  // 昨日(UTC-1日)をJST基準で
  const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const end = new Date(jstNow); end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(jstNow); start.setUTCDate(start.getUTCDate() - 3);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  console.log(`period: ${startDate} ~ ${endDate}`);

  for (const dataLevel of ['AUCTION_AD', 'AUCTION_CAMPAIGN', 'AUCTION_ADGROUP']) {
    const dimKey = dataLevel === 'AUCTION_AD' ? 'ad_id' : dataLevel === 'AUCTION_ADGROUP' ? 'adgroup_id' : 'campaign_id';
    const dimensions = ['stat_time_day', dimKey];
    const metrics = ['impressions', 'clicks', 'spend', 'ctr', 'cpc', 'cpm'];

    try {
      const res = await axios.get('https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/', {
        headers: { 'Access-Token': token.accessToken },
        params: {
          advertiser_id: token.advertiserId,
          data_level: dataLevel,
          report_type: 'BASIC',
          dimensions: JSON.stringify(dimensions),
          metrics: JSON.stringify(metrics),
          start_date: startDate,
          end_date: endDate,
          page: 1,
          page_size: 3,
        },
      });
      const list = res.data?.data?.list ?? [];
      console.log(`\n=== ${dataLevel} ===`);
      console.log(`code=${res.data?.code} message=${res.data?.message} total=${res.data?.data?.page_info?.total_number}`);
      console.log(`records: ${list.length}`);
      if (list[0]) {
        console.log('top keys:', Object.keys(list[0]));
        console.log('dimensions keys:', Object.keys(list[0].dimensions ?? {}));
        console.log('stat_time_day value:', JSON.stringify(list[0].dimensions?.stat_time_day));
        console.log('full sample:', JSON.stringify(list[0], null, 2).slice(0, 600));
      }
    } catch (e: any) {
      console.log(`ERROR ${dataLevel}:`, e?.response?.data ?? e?.message);
    }
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
