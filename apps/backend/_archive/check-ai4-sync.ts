import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();
const p = new PrismaClient();

const ADV_ID = '7580666710525493255';
const TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const API = 'https://business-api.tiktok.com/open_api';

async function fetchJson(url: string) {
  const resp = await fetch(url, { headers: { 'Access-Token': TOKEN } });
  return resp.json() as Promise<any>;
}

async function main() {
  // 1. OAuthToken確認
  const tokens = await p.oAuthToken.findMany({
    where: { advertiser: { tiktokAdvertiserId: ADV_ID } },
  });
  console.log('=== OAuthTokens ===');
  for (const t of tokens) {
    console.log(`  expiresAt: ${t.expiresAt}, advertiserId: ${t.advertiserId}`);
    console.log(`  expired: ${t.expiresAt < new Date()}`);
  }

  // 2. TikTok APIからメトリクス取得テスト（昨日分）
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const yesterday = new Date(jst.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  console.log(`\n=== TikTok API Report (${yesterday}) ===`);

  // 通常広告レポート
  const reportUrl = `${API}/v1.3/report/integrated/get/?advertiser_id=${ADV_ID}&data_level=AUCTION_AD&start_date=${yesterday}&end_date=${yesterday}&page=1&page_size=100&metrics=["spend","conversion","impressions","clicks"]&dimensions=["ad_id","stat_time_day"]`;
  const report = await fetchJson(reportUrl);
  console.log('Regular report:', JSON.stringify(report).slice(0, 500));

  // Smart+レポート
  const spUrl = `${API}/v1.3/smart_plus/material_report/overview/?advertiser_id=${ADV_ID}&start_date=${yesterday}&end_date=${yesterday}&page=1&page_size=100&dimensions=["smart_plus_ad_id"]&metrics=["spend","onsite_form","impressions","clicks"]`;
  const spReport = await fetchJson(spUrl);
  console.log('\nSmart+ report:', JSON.stringify(spReport).slice(0, 500));

  // 3. DB上の広告のtiktokIdリスト
  const adv = await p.advertiser.findFirst({ where: { tiktokAdvertiserId: ADV_ID } });
  const ads = await p.$queryRaw<any[]>`
    SELECT a."tiktokId", a.name, a.status
    FROM ads a
    JOIN adgroups ag ON a."adgroupId" = ag.id
    JOIN campaigns c ON ag."campaignId" = c.id
    WHERE c."advertiserId" = ${adv!.id}
  `;
  console.log('\n=== DB Ads ===');
  for (const a of ads) {
    console.log(`  ${a.tiktokId} | ${a.status} | ${a.name}`);
  }

  await p.$disconnect();
}
main();
