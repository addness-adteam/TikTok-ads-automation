import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();
const prisma = new PrismaClient();

const TIKTOK_API = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SP1_ID = '7474920444831875080';

async function main() {
  // DB検索
  const ads = await prisma.$queryRaw<any[]>`
    SELECT a.name as "adName", a."tiktokId", a.status,
           c.name as "cName", adv.name as "advName"
    FROM ads a
    JOIN adgroups ag ON a."adgroupId" = ag.id
    JOIN campaigns c ON ag."campaignId" = c.id
    JOIN advertisers adv ON c."advertiserId" = adv.id
    WHERE (a.name LIKE '%CR00468%' OR c.name LIKE '%CR00468%')
      AND adv."tiktokAdvertiserId" = ${SP1_ID}
  `;
  console.log('DB検索結果:');
  for (const a of ads) {
    console.log(`  ${a.advName} | ${a.cName?.substring(0, 50)} | ${a.adName?.substring(0, 50)} | tiktokId: ${a.tiktokId} | ${a.status}`);
  }

  // Metric registrationPathでも検索
  const metrics = await prisma.metric.findMany({
    where: { registrationPath: { contains: 'CR00468' } },
    select: { registrationPath: true, campaignId: true },
    take: 5,
  });
  console.log('\nMetric registrationPath:');
  for (const m of metrics) {
    console.log(`  ${m.registrationPath} | campaignId: ${m.campaignId}`);
    if (m.campaignId) {
      const c = await prisma.campaign.findUnique({ where: { id: m.campaignId } });
      console.log(`    campaign: ${c?.name?.substring(0, 60)}`);
    }
  }

  // Smart+ APIで直接検索（SP1のSmart+広告一覧から探す）
  console.log('\nSmart+ API検索...');
  const resp = await axios.get(`${TIKTOK_API}/v1.3/smart_plus/ad/get/`, {
    headers: { 'Access-Token': ACCESS_TOKEN },
    params: {
      advertiser_id: SP1_ID,
      filtering: JSON.stringify({ ad_name: 'CR00468' }),
      page_size: 10,
    },
  });
  const smartAds = resp.data?.data?.list || [];
  console.log(`Smart+ ads with CR00468: ${smartAds.length}件`);
  for (const ad of smartAds) {
    const videoCount = (ad.creative_list || []).length;
    console.log(`  ad_id: ${ad.ad_id} | name: ${ad.ad_name?.substring(0, 60)} | videos: ${videoCount} | status: ${ad.operation_status}`);
  }

  // SP2の情報も確認
  const sp2 = await prisma.advertiser.findUnique({ where: { tiktokAdvertiserId: '7592868952431362066' } });
  console.log('\nSP2:', JSON.stringify({ pixelId: sp2?.pixelId, identityId: sp2?.identityId, bcId: sp2?.identityAuthorizedBcId }, null, 2));

  await prisma.$disconnect();
}
main().catch(console.error);
