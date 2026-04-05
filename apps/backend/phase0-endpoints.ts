import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const API = 'https://business-api.tiktok.com/open_api';

async function main() {
  const token = await prisma.oAuthToken.findUnique({ where: { advertiserId: '7523128243466551303' } });
  if (!token) return;
  const at = token.accessToken;
  const aid = '7523128243466551303';

  const test = async (path: string) => {
    const r = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Access-Token': at },
      body: JSON.stringify({ advertiser_id: aid }),
    });
    const text = await r.text();
    try { const j = JSON.parse(text); console.log(`${path}: code=${j.code}, msg=${j.message}`); }
    catch { console.log(`${path}: NOT FOUND (${r.status})`); }
  };

  console.log('=== エンドポイント確認 ===');
  await test('/v1.3/smart_plus/campaign/create/');
  await test('/v1.3/smart_plus/adgroup/create/');
  await test('/v1.3/smart_plus/ad/create/');
  await test('/v1.3/ad/smart_plus_create/');

  console.log('\n=== P0-6: pixel/identity per account ===');
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

  for (const acc of accounts) {
    const t = await prisma.oAuthToken.findUnique({ where: { advertiserId: acc.id } });
    if (!t) { console.log(`${acc.name}: no token`); continue; }
    const resp = await fetch(`${API}/v1.3/smart_plus/ad/get/?advertiser_id=${acc.id}&page_size=1`, {
      headers: { 'Access-Token': t.accessToken },
    });
    const r = await resp.json();
    const ad = r.data?.list?.[0];
    if (ad) {
      console.log(`${acc.name}: pixel=${ad.ad_configuration?.tracking_info?.tracking_pixel_id ?? 'N/A'} | identity=${ad.creative_list?.[0]?.creative_info?.identity_id ?? 'N/A'} | type=${ad.creative_list?.[0]?.creative_info?.identity_type ?? 'N/A'} | bc=${ad.creative_list?.[0]?.creative_info?.identity_authorized_bc_id ?? 'N/A'} | cta=${ad.ad_configuration?.call_to_action_id ?? 'N/A'}`);
    } else {
      console.log(`${acc.name}: no Smart+ ads`);
    }
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
