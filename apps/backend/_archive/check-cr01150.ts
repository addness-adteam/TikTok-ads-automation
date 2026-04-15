import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });
import { PrismaClient } from '@prisma/client';

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const AI2_ID = '7523128243466551303';

async function tiktokGet(endpoint: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

async function main() {
  const p = new PrismaClient();

  // DB上のLP1-CR01150
  const dbAds = await p.ad.findMany({
    where: { name: { contains: 'CR01150', mode: 'insensitive' } },
    select: { tiktokId: true, name: true, adGroup: { select: { campaign: { select: { advertiser: { select: { name: true, tiktokAdvertiserId: true } } } } } } },
  });
  console.log('=== DB上のCR01150 ===');
  for (const ad of dbAds) {
    console.log(`  ${ad.tiktokId} | ${ad.name} | ${ad.adGroup?.campaign?.advertiser?.name}`);
  }

  // TikTok APIでAI_2のCR01150
  console.log('\n=== TikTok API AI_2のCR01150 ===');
  let page = 1;
  while (true) {
    const resp = await tiktokGet('/v1.3/ad/get/', {
      advertiser_id: AI2_ID,
      fields: JSON.stringify(['ad_id', 'ad_name', 'operation_status']),
      page_size: '100',
      page: String(page),
    });
    if (resp.code !== 0) break;
    const list = resp.data?.list || [];
    for (const ad of list) {
      if ((ad.ad_name || '').toUpperCase().includes('CR01150')) {
        console.log(`  ${ad.ad_id} | ${ad.ad_name} | ${ad.operation_status}`);
      }
    }
    if (list.length < 100) break;
    page++;
  }

  await p.$disconnect();
}
main();
