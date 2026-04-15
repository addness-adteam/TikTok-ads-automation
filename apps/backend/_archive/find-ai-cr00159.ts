import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();
const prisma = new PrismaClient();
const T = 'https://business-api.tiktok.com/open_api';
const K = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const AI3_ID = '7543540647266074641';

async function main() {
  // DB検索
  const ads = await prisma.$queryRaw<any[]>`
    SELECT a.name as "adName", a."tiktokId", a.status,
           c.name as "cName", adv.name as "advName", adv."tiktokAdvertiserId" as "advId"
    FROM ads a
    JOIN adgroups ag ON a."adgroupId" = ag.id
    JOIN campaigns c ON ag."campaignId" = c.id
    JOIN advertisers adv ON c."advertiserId" = adv.id
    WHERE (a.name LIKE '%CR00159%' OR c.name LIKE '%CR00159%')
      AND adv."tiktokAdvertiserId" = ${AI3_ID}
  `;
  console.log('DB検索:');
  for (const a of ads) {
    console.log(`  ${a.advName} | ${a.cName?.substring(0, 50)} | ${a.adName?.substring(0, 50)} | tiktokId: ${a.tiktokId} | ${a.status}`);
  }

  // Smart+ API検索
  const r = await axios.get(`${T}/v1.3/smart_plus/ad/get/`, {
    headers: { 'Access-Token': K },
    params: { advertiser_id: AI3_ID, page_size: 100 },
  });
  const allAds = r.data?.data?.list || [];
  const match = allAds.find((a: any) => a.ad_name?.includes('CR00159'));
  if (match) {
    const vids = (match.creative_list || []).map((c: any) => c?.creative_info?.video_info?.video_id);
    console.log('\nSmart+ found:');
    console.log(`  ad_name: ${match.ad_name}`);
    console.log(`  smart_plus_ad_id: ${match.smart_plus_ad_id}`);
    console.log(`  動画数: ${vids.length}`);
    console.log(`  status: ${match.operation_status}`);
    console.log(`  cta_id: ${match.ad_configuration?.call_to_action_id}`);
  } else {
    console.log('\nSmart+ APIで見つからず');
  }

  await prisma.$disconnect();
}
main().catch(console.error);
