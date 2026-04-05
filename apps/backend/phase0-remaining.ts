import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';

async function main() {
  const advertiserId = '7523128243466551303'; // AI_2
  const token = await prisma.oAuthToken.findUnique({ where: { advertiserId } });
  if (!token) return;
  const accessToken = token.accessToken;

  // P0-2: file/video/ad/info（AI_2のvideo_idで再テスト）
  console.log('=== P0-2: file/video/ad/info（正しいadvertiser_id）===');
  const videoId = 'v10033g50000d6gtmm7og65lj23rgjf0'; // P0-1で取得したAI_2のvideo
  const videoResp = await fetch(
    `${TIKTOK_API_BASE}/v1.3/file/video/ad/info/?advertiser_id=${advertiserId}&video_ids=${encodeURIComponent(JSON.stringify([videoId]))}`,
    { headers: { 'Access-Token': accessToken } },
  );
  const videoResult = await videoResp.json();
  console.log(JSON.stringify(videoResult, null, 2));

  // P0-4: smart_plus/adgroup/create
  console.log('\n=== P0-4: smart_plus/adgroup/create ===');
  for (const path of ['/v1.3/smart_plus/adgroup/create/', '/v1.3/adgroup/smart_plus_create/']) {
    const resp = await fetch(`${TIKTOK_API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Access-Token': accessToken },
      body: JSON.stringify({ advertiser_id: advertiserId }),
    });
    console.log(`${path}: code=${(await resp.json()).code}, msg=${(await resp.clone().json().catch(() => ({}))).message ?? ''}`);
  }
  // re-do properly
  for (const path of ['/v1.3/smart_plus/adgroup/create/', '/v1.3/adgroup/smart_plus_create/']) {
    const resp = await fetch(`${TIKTOK_API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Access-Token': accessToken },
      body: JSON.stringify({ advertiser_id: advertiserId }),
    });
    const r = await resp.json();
    console.log(`${path}: code=${r.code}, message=${r.message}`);
  }

  // P0-5: smart_plus/ad/create
  console.log('\n=== P0-5: smart_plus/ad/create ===');
  for (const path of ['/v1.3/smart_plus/ad/create/', '/v1.3/ad/smart_plus_create/']) {
    const resp = await fetch(`${TIKTOK_API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Access-Token': accessToken },
      body: JSON.stringify({ advertiser_id: advertiserId }),
    });
    const r = await resp.json();
    console.log(`${path}: code=${r.code}, message=${r.message}`);
  }

  // P0-6: pixel_id/identity_id（ad_configurationから取得済みだが全アカウント分）
  console.log('\n=== P0-6: 各アカウントのpixel_id/identity_id ===');
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
    if (!t) { console.log(`${acc.name}: トークンなし`); continue; }

    // smart_plus/ad/getから1つ取得してad_configurationのpixel_id/identity_idを確認
    const resp = await fetch(
      `${TIKTOK_API_BASE}/v1.3/smart_plus/ad/get/?advertiser_id=${acc.id}&page_size=1`,
      { headers: { 'Access-Token': t.accessToken } },
    );
    const r = await resp.json();
    const ad = r.data?.list?.[0];
    if (ad) {
      const pixelId = ad.ad_configuration?.tracking_info?.tracking_pixel_id ?? 'N/A';
      const identityId = ad.creative_list?.[0]?.creative_info?.identity_id ?? 'N/A';
      const identityType = ad.creative_list?.[0]?.creative_info?.identity_type ?? 'N/A';
      const bcId = ad.creative_list?.[0]?.creative_info?.identity_authorized_bc_id ?? 'N/A';
      const ctaId = ad.ad_configuration?.call_to_action_id ?? 'N/A';
      console.log(`${acc.name}: pixel=${pixelId} | identity=${identityId} | type=${identityType} | bc=${bcId} | cta=${ctaId}`);
    } else {
      // Smart+広告がない場合、通常のad/getで取得
      const adResp = await fetch(
        `${TIKTOK_API_BASE}/v1.3/ad/get/?advertiser_id=${acc.id}&page_size=1`,
        { headers: { 'Access-Token': t.accessToken } },
      );
      const ar = await adResp.json();
      const regularAd = ar.data?.list?.[0];
      console.log(`${acc.name}: Smart+なし | identity_id=${regularAd?.identity_id ?? 'N/A'} | pixel=adgroupから取得必要`);
    }
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
