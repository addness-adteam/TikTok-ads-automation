import { PrismaClient } from '@prisma/client';

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

async function tiktokGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

async function main() {
  const prisma = new PrismaClient();
  try {
    // Get CR00580 ad with full relations
    const ad = await prisma.ad.findFirst({
      where: { AND: [{ name: { contains: '1時間後悔' } }, { name: { contains: 'LP2' } }] },
      include: {
        adGroup: { include: { campaign: { include: { advertiser: true } } } },
      },
    });
    if (ad) {
      const advId = ad.adGroup?.campaign?.advertiser?.tiktokAdvertiserId;
      console.log(`DB: ${ad.name} -> tiktokId: ${ad.tiktokId}, advertiser: ${advId}`);

      // Try all SP accounts
      const accounts = ['7474920444831875080', '7592868952431362066', '7616545514662051858'];
      for (const acc of accounts) {
        // Try ad/get
        const adData = await tiktokGet('/v1.3/ad/get/', {
          advertiser_id: acc,
          filtering: JSON.stringify({ ad_ids: [ad.tiktokId] }),
          fields: JSON.stringify(['ad_id', 'ad_name', 'video_id', 'status']),
        });
        if (adData.data?.list?.length > 0) {
          console.log(`Found in ${acc} (regular): ${JSON.stringify(adData.data.list[0])}`);
        }
        // Try smart_plus
        const spData = await tiktokGet('/v1.3/smart_plus/ad/get/', {
          advertiser_id: acc,
          filtering: JSON.stringify({ smart_plus_ad_ids: [ad.tiktokId] }),
        });
        if (spData.data?.list?.length > 0) {
          const spAd = spData.data.list[0];
          const creativeList = spAd.creative_list || [];
          const videoIds: string[] = [];
          for (const c of creativeList) {
            const vid = c?.creative_info?.video_info?.video_id;
            if (vid && vid !== 'N/A') videoIds.push(vid);
          }
          console.log(`Found in ${acc} (Smart+): ${spAd.smart_plus_ad_name}, videos: ${JSON.stringify(videoIds)}`);
        }
      }
    } else {
      console.log('Not found in DB');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
