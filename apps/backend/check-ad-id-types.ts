// Smart+広告と通常配信広告でad_id / smart_plus_ad_idがどう返るか確認
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';

async function main() {
  const token = await prisma.oAuthToken.findUnique({ where: { advertiserId: '7523128243466551303' } }); // AI_2
  if (!token) return;

  // 1. /v1.3/ad/get/ で全広告を取得 → smart_plus_ad_idの有無を確認
  console.log('=== /v1.3/ad/get/ のレスポンス構造 ===');
  const adResp = await fetch(`${TIKTOK_API_BASE}/v1.3/ad/get/?advertiser_id=7523128243466551303&page_size=5`, {
    headers: { 'Access-Token': token.accessToken },
  });
  const adResult = await adResp.json();
  const ads = adResult.data?.list || [];

  for (const ad of ads.slice(0, 3)) {
    console.log(`\n  ad_name: ${ad.ad_name}`);
    console.log(`  ad_id: ${ad.ad_id}`);
    console.log(`  smart_plus_ad_id: ${ad.smart_plus_ad_id ?? 'undefined/null'}`);
    console.log(`  has smart_plus_ad_id field: ${'smart_plus_ad_id' in ad}`);
  }

  // 2. /v1.3/smart_plus/ad/get/ で全Smart+広告を取得
  console.log('\n\n=== /v1.3/smart_plus/ad/get/ のレスポンス構造 ===');
  const spResp = await fetch(`${TIKTOK_API_BASE}/v1.3/smart_plus/ad/get/?advertiser_id=7523128243466551303&page_size=5`, {
    headers: { 'Access-Token': token.accessToken },
  });
  const spResult = await spResp.json();
  const spAds = spResult.data?.list || [];

  for (const ad of spAds.slice(0, 3)) {
    console.log(`\n  ad_name: ${ad.ad_name}`);
    console.log(`  smart_plus_ad_id: ${ad.smart_plus_ad_id ?? 'undefined/null'}`);
    console.log(`  ad_id: ${ad.ad_id ?? 'undefined/null'}`);
    console.log(`  has ad_id field: ${'ad_id' in ad}`);
    console.log(`  keys: ${Object.keys(ad).filter(k => k.includes('id')).join(', ')}`);
  }

  // 3. AI_1で通常配信っぽい広告（ClaudeCode解説）も確認
  const token1 = await prisma.oAuthToken.findUnique({ where: { advertiserId: '7468288053866561553' } });
  if (!token1) return;

  // まずad/getで取得
  console.log('\n\n=== AI_1: ad/get でClaudeCode解説を取得 ===');
  const claudeAd = await prisma.ad.findFirst({
    where: { name: { contains: 'ClaudeCode解説' }, status: 'ENABLE' },
  });
  if (claudeAd) {
    const resp = await fetch(`${TIKTOK_API_BASE}/v1.3/ad/get/?advertiser_id=7468288053866561553&filtering=${encodeURIComponent(JSON.stringify({ ad_ids: [claudeAd.tiktokId] }))}`, {
      headers: { 'Access-Token': token1.accessToken },
    });
    const result = await resp.json();
    const ad = result.data?.list?.[0];
    if (ad) {
      console.log(`  ad_name: ${ad.ad_name}`);
      console.log(`  ad_id: ${ad.ad_id}`);
      console.log(`  smart_plus_ad_id: ${ad.smart_plus_ad_id ?? 'undefined/null'}`);
      console.log(`  video_id: ${ad.video_id ?? 'N/A'}`);
      console.log(`  ID関連keys: ${Object.keys(ad).filter(k => k.includes('id')).join(', ')}`);
    }
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
