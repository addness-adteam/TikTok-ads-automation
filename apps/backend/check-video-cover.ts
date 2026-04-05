import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
async function main() {
  const t = await prisma.oAuthToken.findUnique({ where: { advertiserId: '7580666710525493255' } });
  const resp = await fetch(
    `${TIKTOK_API_BASE}/v1.3/file/video/ad/info/?advertiser_id=7580666710525493255&video_ids=${encodeURIComponent(JSON.stringify(['v10033g50000d6spdmfog65hgcq326lg']))}`,
    { headers: { 'Access-Token': t!.accessToken } },
  );
  const r = await resp.json();
  const list = r.data?.list || (Array.isArray(r.data) ? r.data : []);
  const v = list[0];
  if (v) {
    console.log('video_id:', v.video_id);
    console.log('video_cover_url:', v.video_cover_url?.substring(0, 80));
    console.log('poster_url:', v.poster_url?.substring(0, 80));
    console.log('material_id:', v.material_id);
    console.log('All keys:', Object.keys(v).join(', '));
  } else {
    console.log('No video found');
    console.log('Response:', JSON.stringify(r, null, 2));
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
