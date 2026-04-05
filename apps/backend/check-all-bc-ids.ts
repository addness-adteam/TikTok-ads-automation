import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const accounts = [
  { name: 'AI_1', id: '7468288053866561553' },
  { name: 'AI_2', id: '7523128243466551303' },
  { name: 'AI_3', id: '7543540647266074641' },
  { name: 'AI_4', id: '7580666710525493255' },
  { name: 'SP1', id: '7474920444831875080' },
  { name: 'SP2', id: '7592868952431362066' },
  { name: 'SNS1', id: '7247073333517238273' },
  { name: 'SNS2', id: '7543540100849156112' },
  { name: 'SNS3', id: '7543540381615800337' },
];
async function main() {
  for (const acc of accounts) {
    const t = await prisma.oAuthToken.findUnique({ where: { advertiserId: acc.id } });
    if (!t) continue;
    const resp = await fetch(
      `${TIKTOK_API_BASE}/v1.3/ad/get/?advertiser_id=${acc.id}&page_size=1&fields=${encodeURIComponent(JSON.stringify(['ad_id','identity_type','identity_authorized_bc_id']))}`,
      { headers: { 'Access-Token': t.accessToken } },
    );
    const r = await resp.json();
    const ad = r.data?.list?.[0];
    console.log(`${acc.name}: bc_id=${ad?.identity_authorized_bc_id || 'N/A'} | type=${ad?.identity_type || 'N/A'}`);
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
