/**
 * P0-6: 全アカウントのpixel_id, identity_idを取得
 * Smart+広告 → ad_configurationから取得
 * 通常広告 → ad/get + adgroup/getから取得
 */
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

async function getFromSmartPlusAd(advertiserId: string, accessToken: string) {
  const resp = await fetch(
    `${TIKTOK_API_BASE}/v1.3/smart_plus/ad/get/?advertiser_id=${advertiserId}&page_size=1`,
    { headers: { 'Access-Token': accessToken } },
  );
  const r = await resp.json();
  const ad = r.data?.list?.[0];
  if (!ad) return null;

  return {
    pixelId: ad.ad_configuration?.tracking_info?.tracking_pixel_id ?? null,
    identityId: ad.creative_list?.[0]?.creative_info?.identity_id ?? null,
    identityType: ad.creative_list?.[0]?.creative_info?.identity_type ?? null,
    source: 'smart_plus/ad/get',
  };
}

async function getFromRegularAd(advertiserId: string, accessToken: string) {
  // 通常のad/getからidentity_idを取得
  const adResp = await fetch(
    `${TIKTOK_API_BASE}/v1.3/ad/get/?advertiser_id=${advertiserId}&page_size=5&fields=${encodeURIComponent(JSON.stringify(['ad_id', 'ad_name', 'identity_id', 'identity_type', 'adgroup_id']))}`,
    { headers: { 'Access-Token': accessToken } },
  );
  const adResult = await adResp.json();
  const ads = adResult.data?.list || [];

  let identityId: string | null = null;
  let identityType: string | null = null;
  let adgroupId: string | null = null;

  for (const ad of ads) {
    if (ad.identity_id) {
      identityId = ad.identity_id;
      identityType = ad.identity_type;
      adgroupId = ad.adgroup_id;
      break;
    }
  }

  // adgroup/getからpixel_idを取得
  let pixelId: string | null = null;
  if (adgroupId) {
    const agResp = await fetch(
      `${TIKTOK_API_BASE}/v1.3/adgroup/get/?advertiser_id=${advertiserId}&filtering=${encodeURIComponent(JSON.stringify({ adgroup_ids: [adgroupId] }))}&fields=${encodeURIComponent(JSON.stringify(['adgroup_id', 'pixel_id']))}`,
      { headers: { 'Access-Token': accessToken } },
    );
    const agResult = await agResp.json();
    pixelId = agResult.data?.list?.[0]?.pixel_id ?? null;
  }

  if (!pixelId) {
    // ピクセル一覧APIから取得
    const pixelResp = await fetch(
      `${TIKTOK_API_BASE}/v1.3/pixel/list/?advertiser_id=${advertiserId}&page_size=10`,
      { headers: { 'Access-Token': accessToken } },
    );
    const pixelResult = await pixelResp.json();
    const pixels = pixelResult.data?.pixels || [];
    if (pixels.length > 0) {
      pixelId = pixels[0].pixel_id;
    }
  }

  return {
    pixelId,
    identityId,
    identityType,
    source: 'ad/get + adgroup/get',
  };
}

async function main() {
  console.log('=== P0-6: 全アカウントのpixel_id/identity_id取得 ===\n');

  const results: any[] = [];

  for (const acc of accounts) {
    const token = await prisma.oAuthToken.findUnique({ where: { advertiserId: acc.id } });
    if (!token) {
      console.log(`❌ ${acc.name} (${acc.id}): トークンなし`);
      continue;
    }

    // まずSmart+広告から試行
    let result = await getFromSmartPlusAd(acc.id, token.accessToken);

    // Smart+からidentityが取れない場合、通常広告から取得
    if (!result || !result.identityId) {
      const regularResult = await getFromRegularAd(acc.id, token.accessToken);
      if (result && !result.identityId && regularResult.identityId) {
        result.identityId = regularResult.identityId;
        result.identityType = regularResult.identityType;
        result.source += ' + ad/get fallback';
      } else if (!result) {
        result = regularResult;
      }
    }

    // Smart+からpixelが取れない場合、通常広告から取得
    if (result && !result.pixelId) {
      const regularResult = await getFromRegularAd(acc.id, token.accessToken);
      if (regularResult.pixelId) {
        result.pixelId = regularResult.pixelId;
        result.source += ' + pixel fallback';
      }
    }

    if (result) {
      console.log(`✅ ${acc.name} (${acc.id}):`);
      console.log(`   pixel_id:    ${result.pixelId || 'N/A'}`);
      console.log(`   identity_id: ${result.identityId || 'N/A'}`);
      console.log(`   identity_type: ${result.identityType || 'N/A'}`);
      console.log(`   source: ${result.source}`);
      results.push({ ...acc, ...result });
    } else {
      console.log(`❌ ${acc.name} (${acc.id}): データ取得失敗`);
    }
    console.log('');

    // レート制限対策
    await new Promise(r => setTimeout(r, 200));
  }

  // サマリー出力（コピペ用）
  console.log('\n=== サマリー（DB保存用） ===');
  console.log('Account | pixel_id | identity_id');
  console.log('--------|----------|------------');
  for (const r of results) {
    console.log(`${r.name} | ${r.pixelId || 'N/A'} | ${r.identityId || 'N/A'}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
