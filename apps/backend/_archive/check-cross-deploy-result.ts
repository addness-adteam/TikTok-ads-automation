/**
 * 横展開テスト結果の確認
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';

async function main() {
  // 1. CrossDeployLogの全ログを確認
  const logs = await prisma.crossDeployLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  console.log(`=== CrossDeployLog 全件: ${logs.length}件 ===\n`);

  for (const log of logs) {
    console.log(`--- Log ID: ${log.id} ---`);
    console.log(`  日時: ${log.createdAt.toISOString()}`);
    console.log(`  mode: ${log.mode} | status: ${log.status}`);
    console.log(`  元: ${log.sourceAdvertiserId} (ad: ${log.sourceAdId})`);
    console.log(`  先: ${log.targetAdvertiserId}`);
    console.log(`  adId: ${log.adId} | adName: ${log.adName}`);
    console.log(`  videoMapping: ${JSON.stringify(log.videoMapping)}`);
    console.log(`  error: ${log.errorMessage || 'なし'}`);
    console.log('');
  }

  // 2. 横展開で作成された可能性のある広告をAPIから確認
  // AI_4のSmart+広告を確認
  const AI_4 = '7580666710525493255';
  const token = await prisma.oAuthToken.findUnique({ where: { advertiserId: AI_4 } });

  if (token) {
    console.log(`\n=== AI_4のSmart+広告一覧 ===`);
    const resp = await fetch(
      `${TIKTOK_API_BASE}/v1.3/smart_plus/ad/get/?advertiser_id=${AI_4}&page_size=10`,
      { headers: { 'Access-Token': token.accessToken } },
    );
    const data = await resp.json() as any;
    const list = data.data?.list || [];
    console.log(`  件数: ${list.length}`);

    for (const ad of list) {
      const creativeList = ad.creative_list || [];
      const videoIds = creativeList.map((c: any) => c?.creative_info?.video_info?.video_id).filter(Boolean);
      console.log(`\n  広告名: ${ad.ad_name}`);
      console.log(`  ad_id: ${ad.smart_plus_ad_id || ad.ad_id}`);
      console.log(`  creative_list: ${creativeList.length}本, video_ids: ${JSON.stringify(videoIds)}`);
      console.log(`  ad_text_list: ${(ad.ad_text_list || []).length}件`);
      console.log(`  status: ${ad.operation_status}`);
    }
  }

  // 3. 全アカウントのSmart+広告でcreative_listが複数あるものを探す
  console.log(`\n\n=== 全アカウントのSmart+広告(creative_list複数) ===`);
  const advertisers = await prisma.advertiser.findMany({
    include: { oauthTokens: true },
  });

  for (const adv of advertisers) {
    const t = adv.oauthTokens[0];
    if (!t) continue;

    try {
      const resp = await fetch(
        `${TIKTOK_API_BASE}/v1.3/smart_plus/ad/get/?advertiser_id=${adv.tiktokAdvertiserId}&page_size=50`,
        { headers: { 'Access-Token': t.accessToken } },
      );
      const data = await resp.json() as any;
      const list = data.data?.list || [];

      for (const ad of list) {
        const creativeList = ad.creative_list || [];
        if (creativeList.length >= 2) {
          const videoIds = creativeList.map((c: any) => c?.creative_info?.video_info?.video_id).filter(Boolean);
          console.log(`\n  [${adv.name}] ${ad.ad_name}`);
          console.log(`    creative_list: ${creativeList.length}本, video_ids: [${videoIds.join(', ')}]`);
        }
      }
    } catch (e) {
      // skip
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
