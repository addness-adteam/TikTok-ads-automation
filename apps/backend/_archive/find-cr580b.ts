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
  // DB search
  const prisma = new PrismaClient();
  try {
    const ads = await prisma.ad.findMany({
      where: {
        OR: [
          { name: { contains: 'CR00580' } },
          { name: { contains: '1時間後悔' } },
        ],
      },
      select: { tiktokId: true, name: true, adGroup: { select: { campaign: { select: { advertiser: { select: { tiktokAdvertiserId: true } } } } } } },
    });
    console.log(`DB search: ${ads.length} results`);
    for (const ad of ads) {
      console.log(`  ${ad.name} -> tiktokId: ${ad.tiktokId}, account: ${ad.adgroup?.campaign?.advertiser?.tiktokAdvertiserId}`);
    }
  } finally {
    await prisma.$disconnect();
  }

  // Search all SP accounts for CR00580
  const accounts = [SP1, '7592868952431362066', '7616545514662051858'];
  for (const acc of accounts) {
    // Search across all pages
    for (let page = 1; page <= 5; page++) {
      const data = await tiktokGet('/v1.3/smart_plus/ad/get/', {
        advertiser_id: acc,
        page_size: '100',
        page: String(page),
      });
      const ads = data.data?.list || [];
      if (ads.length === 0) break;
      for (const ad of ads) {
        const name = ad.smart_plus_ad_name || ad.ad_name || '';
        if (name.includes('CR00580') || name.includes('1時間後悔')) {
          const creativeList = ad.creative_list || [];
          const videoIds: string[] = [];
          for (const c of creativeList) {
            const vid = c?.creative_info?.video_info?.video_id;
            if (vid && vid !== 'N/A') videoIds.push(vid);
          }
          console.log(`[FOUND in ${acc} p${page}] ${name} -> ad_id: ${ad.smart_plus_ad_id || ad.ad_id}, videos: ${JSON.stringify(videoIds)}`);
        }
      }
    }
  }
}

main().catch(console.error);
