import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
async function main() {
  const t = await prisma.oAuthToken.findUnique({ where: { advertiserId: '7580666710525493255' } });
  // Try getting CTA from existing ads
  const resp = await fetch(
    `${TIKTOK_API_BASE}/v1.3/ad/get/?advertiser_id=7580666710525493255&page_size=3&fields=${encodeURIComponent(JSON.stringify(['ad_id','ad_name','call_to_action_id','call_to_action']))}`,
    { headers: { 'Access-Token': t!.accessToken } },
  );
  const r = await resp.json();
  for (const ad of r.data?.list || []) {
    console.log(`${ad.ad_name?.substring(0,40)} | cta_id=${ad.call_to_action_id} | cta=${ad.call_to_action}`);
  }

  // Also check Smart+ ads
  const sp = await fetch(
    `${TIKTOK_API_BASE}/v1.3/smart_plus/ad/get/?advertiser_id=7580666710525493255&page_size=1`,
    { headers: { 'Access-Token': t!.accessToken } },
  );
  const sr = await sp.json();
  const ad = sr.data?.list?.[0];
  if (ad) {
    console.log(`\nSmart+ CTA: ${ad.ad_configuration?.call_to_action_id}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
