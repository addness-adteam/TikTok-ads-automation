// AIまとめ・SNSまとめの広告構造を確認（スマプラかどうか、動画数など）
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';

async function main() {
  // 1. AI_2の「AIまとめ」を確認
  console.log('=== AI_2「AIまとめ」の広告構造 ===');
  const ai2Adv = await prisma.advertiser.findUnique({ where: { tiktokAdvertiserId: '7523128243466551303' } });
  if (!ai2Adv) return;

  const token = await prisma.oAuthToken.findUnique({ where: { advertiserId: '7523128243466551303' } });
  if (!token) { console.log('No token'); return; }

  // Find AIまとめ ads
  const ai2Campaigns = await prisma.campaign.findMany({ where: { advertiserId: ai2Adv.id }, select: { id: true } });
  const ai2AdGroups = await prisma.adGroup.findMany({ where: { campaignId: { in: ai2Campaigns.map(c => c.id) } }, select: { id: true } });
  const matomeAds = await prisma.ad.findMany({
    where: {
      adgroupId: { in: ai2AdGroups.map(ag => ag.id) },
      name: { contains: 'AIまとめ' },
      status: 'ENABLE',
    },
    take: 5,
  });

  console.log(`AIまとめ広告数: ${matomeAds.length}`);
  for (const ad of matomeAds) {
    console.log(`\n  ${ad.name} | tiktokId: ${ad.tiktokId}`);

    // Check if it's a Smart+ ad by querying TikTok API
    // First try smart_plus/ad/get
    try {
      const spResponse = await fetch(`${TIKTOK_API_BASE}/v1.3/smart_plus/ad/get/?advertiser_id=7523128243466551303&filtering=${encodeURIComponent(JSON.stringify({ smart_plus_ad_ids: [ad.tiktokId] }))}`, {
        headers: { 'Access-Token': token.accessToken },
      });
      const spResult = await spResponse.json();
      if (spResult.data?.list?.length > 0) {
        const spAd = spResult.data.list[0];
        console.log(`  → Smart+ AD confirmed`);
        console.log(`  → ad_name: ${spAd.ad_name}`);
        console.log(`  → creative_list count: ${spAd.creative_list?.length ?? 'N/A'}`);
        if (spAd.creative_list) {
          for (const cr of spAd.creative_list) {
            console.log(`    video_id: ${cr.video_info?.video_id ?? cr.video_id ?? 'N/A'} | image: ${cr.image_info ? 'yes' : 'no'}`);
          }
        }
        // Show full structure keys
        console.log(`  → Top-level keys: ${Object.keys(spAd).join(', ')}`);
        if (spAd.landing_page_url_list) {
          console.log(`  → landing_page_urls: ${JSON.stringify(spAd.landing_page_url_list)}`);
        }
        if (spAd.ad_text_list) {
          console.log(`  → ad_texts: ${JSON.stringify(spAd.ad_text_list?.map((t: any) => t.ad_text?.substring(0, 50)))}`);
        }
      } else {
        console.log(`  → Not found in smart_plus/ad/get`);
      }
    } catch (e: any) {
      console.log(`  → Error: ${e.message}`);
    }
  }

  // 2. SNS3の「SNSまとめ」を確認
  console.log('\n\n=== SNS3「SNSまとめ」の広告構造 ===');
  const sns3Token = await prisma.oAuthToken.findUnique({ where: { advertiserId: '7543540381615800337' } });
  const sns3Adv = await prisma.advertiser.findUnique({ where: { tiktokAdvertiserId: '7543540381615800337' } });
  if (!sns3Adv || !sns3Token) return;

  const sns3Campaigns = await prisma.campaign.findMany({ where: { advertiserId: sns3Adv.id }, select: { id: true } });
  const sns3AdGroups = await prisma.adGroup.findMany({ where: { campaignId: { in: sns3Campaigns.map(c => c.id) } }, select: { id: true } });
  const snsMatomeAds = await prisma.ad.findMany({
    where: {
      adgroupId: { in: sns3AdGroups.map(ag => ag.id) },
      name: { contains: 'SNSまとめ' },
      status: 'ENABLE',
    },
    take: 5,
  });

  console.log(`SNSまとめ広告数: ${snsMatomeAds.length}`);
  for (const ad of snsMatomeAds) {
    console.log(`\n  ${ad.name} | tiktokId: ${ad.tiktokId}`);
    try {
      const spResponse = await fetch(`${TIKTOK_API_BASE}/v1.3/smart_plus/ad/get/?advertiser_id=7543540381615800337&filtering=${encodeURIComponent(JSON.stringify({ smart_plus_ad_ids: [ad.tiktokId] }))}`, {
        headers: { 'Access-Token': sns3Token.accessToken },
      });
      const spResult = await spResponse.json();
      if (spResult.data?.list?.length > 0) {
        const spAd = spResult.data.list[0];
        console.log(`  → Smart+ AD confirmed`);
        console.log(`  → creative_list count: ${spAd.creative_list?.length ?? 'N/A'}`);
        if (spAd.creative_list) {
          for (const cr of spAd.creative_list) {
            console.log(`    video_id: ${cr.video_info?.video_id ?? cr.video_id ?? 'N/A'}`);
          }
        }
        console.log(`  → Top-level keys: ${Object.keys(spAd).join(', ')}`);
        if (spAd.landing_page_url_list) {
          console.log(`  → landing_page_urls: ${JSON.stringify(spAd.landing_page_url_list)}`);
        }
      } else {
        console.log(`  → Not found in smart_plus/ad/get`);
      }
    } catch (e: any) {
      console.log(`  → Error: ${e.message}`);
    }
  }

  // 3. AI_1の勝ちCR「ClaudeCode解説」も確認（通常配信のはず）
  console.log('\n\n=== AI_1「ClaudeCode解説」（通常配信の確認用）===');
  const ai1Token = await prisma.oAuthToken.findUnique({ where: { advertiserId: '7468288053866561553' } });
  const ai1Adv = await prisma.advertiser.findUnique({ where: { tiktokAdvertiserId: '7468288053866561553' } });
  if (!ai1Adv || !ai1Token) return;

  const ai1Campaigns = await prisma.campaign.findMany({ where: { advertiserId: ai1Adv.id }, select: { id: true } });
  const ai1AdGroups = await prisma.adGroup.findMany({ where: { campaignId: { in: ai1Campaigns.map(c => c.id) } }, select: { id: true } });
  const claudeAds = await prisma.ad.findMany({
    where: {
      adgroupId: { in: ai1AdGroups.map(ag => ag.id) },
      name: { contains: 'ClaudeCode解説' },
      status: 'ENABLE',
    },
    take: 2,
  });

  for (const ad of claudeAds) {
    console.log(`\n  ${ad.name} | tiktokId: ${ad.tiktokId}`);
    // Try regular ad/get
    try {
      const regResponse = await fetch(`${TIKTOK_API_BASE}/v1.3/ad/get/?advertiser_id=7468288053866561553&filtering=${encodeURIComponent(JSON.stringify({ ad_ids: [ad.tiktokId] }))}`, {
        headers: { 'Access-Token': ai1Token.accessToken },
      });
      const regResult = await regResponse.json();
      if (regResult.data?.list?.length > 0) {
        const regAd = regResult.data.list[0];
        console.log(`  → Regular AD`);
        console.log(`  → video_id: ${regAd.video_id ?? 'N/A'}`);
        console.log(`  → smart_plus_ad_id: ${regAd.smart_plus_ad_id ?? 'N/A'}`);
        console.log(`  → landing_page_url: ${regAd.landing_page_url ?? 'N/A'}`);
      }
    } catch (e: any) {
      console.log(`  → Error: ${e.message}`);
    }

    // Also try smart_plus/ad/get
    try {
      const spResponse = await fetch(`${TIKTOK_API_BASE}/v1.3/smart_plus/ad/get/?advertiser_id=7468288053866561553&filtering=${encodeURIComponent(JSON.stringify({ smart_plus_ad_ids: [ad.tiktokId] }))}`, {
        headers: { 'Access-Token': ai1Token.accessToken },
      });
      const spResult = await spResponse.json();
      if (spResult.data?.list?.length > 0) {
        console.log(`  → Also found in Smart+ API!`);
      } else {
        console.log(`  → NOT in Smart+ API (= pure regular ad)`);
      }
    } catch (e: any) {
      console.log(`  → SP check error: ${e.message}`);
    }
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
