import { PrismaClient } from '@prisma/client';

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SP1 = '7474920444831875080';

async function tiktokGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

async function main() {
  const prisma = new PrismaClient();
  try {
    // Find all ads with these CRs and their creative/video info
    const targetNames = ['CR00580', 'CR00577', 'CR00574', 'CR00588', 'CR00591', 'CR00585'];
    for (const crName of targetNames) {
      const ads = await prisma.ad.findMany({
        where: { AND: [{ name: { contains: crName } }, { name: { contains: 'LP2' } }] },
        include: {
          creative: true,
          adGroup: { include: { campaign: { include: { advertiser: { select: { tiktokAdvertiserId: true, name: true } } } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 2,
      });
      for (const ad of ads) {
        const advId = ad.adGroup?.campaign?.advertiser?.tiktokAdvertiserId;
        const advName = ad.adGroup?.campaign?.advertiser?.name;
        console.log(`${ad.name} | tiktokId: ${ad.tiktokId} | account: ${advId} (${advName}) | videoId: ${ad.creative?.tiktokVideoId || 'N/A'}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  // Check disabled Smart+ ads for CR00580
  console.log('\n=== Disabled Smart+ ads search ===');
  const spDisable = await tiktokGet('/v1.3/smart_plus/ad/get/', {
    advertiser_id: SP1,
    filtering: JSON.stringify({ operation_status: 'DISABLE' }),
    page_size: '100',
  });
  const disabledAds = spDisable.data?.list || [];
  console.log(`Total disabled: ${disabledAds.length}`);
  for (const ad of disabledAds) {
    const name = ad.smart_plus_ad_name || ad.ad_name || '';
    if (name.includes('1時間後悔') || name.includes('CR00580')) {
      const creativeList = ad.creative_list || [];
      const videoIds: string[] = [];
      for (const c of creativeList) {
        const vid = c?.creative_info?.video_info?.video_id;
        if (vid && vid !== 'N/A') videoIds.push(vid);
      }
      console.log(`  [DISABLED] ${name} -> ${ad.smart_plus_ad_id}, videos: ${JSON.stringify(videoIds)}`);
    }
  }

  // Also try "DELETE" status
  console.log('\n=== Deleted Smart+ ads ===');
  const spDelete = await tiktokGet('/v1.3/smart_plus/ad/get/', {
    advertiser_id: SP1,
    filtering: JSON.stringify({ operation_status: 'DELETE' }),
    page_size: '100',
  });
  const deletedAds = spDelete.data?.list || [];
  console.log(`Total deleted: ${deletedAds.length}`);
  for (const ad of deletedAds) {
    const name = ad.smart_plus_ad_name || ad.ad_name || '';
    if (name.includes('1時間後悔') || name.includes('CR00580')) {
      console.log(`  [DELETED] ${name} -> ${ad.smart_plus_ad_id}`);
    }
  }

  // Also look for the video by checking the creative entry for CR00580 in the DB
  // Check if the video_id exists on the account regardless
  console.log('\n=== Check video in DB ===');
  const prisma2 = new (await import('@prisma/client')).PrismaClient();
  const creative = await prisma2.creative.findFirst({
    where: { name: { contains: '1時間後悔' } },
  });
  if (creative) {
    console.log(`Creative: ${creative.name}, videoId: ${creative.tiktokVideoId}`);
    if (creative.tiktokVideoId) {
      const videoInfo = await tiktokGet('/v1.3/file/video/ad/info/', {
        advertiser_id: SP1,
        video_ids: JSON.stringify([creative.tiktokVideoId]),
      });
      console.log(`Video info: ${JSON.stringify(videoInfo.data?.list?.[0]?.video_id || 'not found')}`);
    }
  } else {
    console.log('Creative not found in DB');
  }
  await prisma2.$disconnect();
}

main().catch(console.error);
