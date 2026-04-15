import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
async function main() {
  const t = await prisma.oAuthToken.findUnique({ where: { advertiserId: '7580666710525493255' } });
  const resp = await fetch(
    `${TIKTOK_API_BASE}/v1.3/ad/get/?advertiser_id=7580666710525493255&page_size=1&fields=${encodeURIComponent(JSON.stringify(['ad_id','ad_name','identity_id','identity_type','identity_authorized_bc_id','call_to_action_id','call_to_action']))}`,
    { headers: { 'Access-Token': t!.accessToken } },
  );
  const r = await resp.json();
  console.log(JSON.stringify(r.data?.list?.[0], null, 2));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
