import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

const TIKTOK_API_BASE_URL = 'https://business-api.tiktok.com/open_api';
const ADVERTISER_ID = '7247073333517238273';

async function main() {
  console.log('='.repeat(80));
  console.log('修正後の同期処理テスト');
  console.log('='.repeat(80));

  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: ADVERTISER_ID }
  });

  if (!token) {
    console.log('Token not found');
    return;
  }

  const advertiser = await prisma.advertiser.findFirst({
    where: { tiktokAdvertiserId: ADVERTISER_ID }
  });

  if (!advertiser) {
    console.log('Advertiser not found');
    return;
  }

  // 1. 現在のDBの状態を確認（テスト前）
  console.log('\n[テスト前] DBの状態を確認...');
  const beforeAds = await prisma.ad.findMany({
    where: {
      adGroup: {
        campaign: {
          advertiserId: advertiser.id
        }
      }
    }
  });
  console.log(`DB内の広告数: ${beforeAds.length}`);

  // 問題のAdGroupの広告を確認
  const targetAdgroupId = '1849941161890833';
  const adgroupAds = await prisma.ad.findMany({
    where: {
      adGroup: { tiktokId: targetAdgroupId }
    }
  });
  console.log(`\n問題のAdGroup (${targetAdgroupId}) 内の広告:`);
  for (const ad of adgroupAds) {
    console.log(`  - ${ad.name} (tiktokId: ${ad.tiktokId})`);
  }

  // 2. 修正後の同期ロジックをシミュレート
  console.log('\n[シミュレーション] 修正後の同期ロジック...');

  // ad/get APIから広告を取得
  const adsResponse = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/ad/get/`, {
    headers: {
      'Access-Token': token.accessToken,
      'Content-Type': 'application/json',
    },
    params: {
      advertiser_id: ADVERTISER_ID,
      filtering: JSON.stringify({
        adgroup_ids: [targetAdgroupId],
      }),
      page_size: 100,
    },
  });

  const regularAds = adsResponse.data.data?.list || [];
  console.log(`\nad/get APIから取得した広告数: ${regularAds.length}`);

  // Smart+ 広告名マップを作成
  const smartPlusAdsResponse = await axios.get(`${TIKTOK_API_BASE_URL}/v1.3/smart_plus/ad/get/`, {
    headers: {
      'Access-Token': token.accessToken,
      'Content-Type': 'application/json',
    },
    params: {
      advertiser_id: ADVERTISER_ID,
      filtering: JSON.stringify({
        adgroup_ids: [targetAdgroupId],
      }),
      page_size: 100,
    },
  });

  const smartPlusAds = smartPlusAdsResponse.data.data?.list || [];
  console.log(`smart_plus/ad/get APIから取得した広告数: ${smartPlusAds.length}`);

  const smartPlusAdNameMap = new Map<string, string>();
  for (const spAd of smartPlusAds) {
    if (spAd.smart_plus_ad_id && spAd.ad_name) {
      smartPlusAdNameMap.set(String(spAd.smart_plus_ad_id), spAd.ad_name);
    }
  }
  console.log(`Smart+ 広告名マップのエントリ数: ${smartPlusAdNameMap.size}`);

  // 修正後のロジックで保存されるべき広告を確認
  console.log('\n[修正後のロジックで保存される広告]:');
  for (const ad of regularAds) {
    const isSmartPlusAd = !!ad.smart_plus_ad_id;
    const tiktokIdToUse = isSmartPlusAd ? String(ad.smart_plus_ad_id) : String(ad.ad_id);
    const adNameToUse = isSmartPlusAd
      ? (smartPlusAdNameMap.get(String(ad.smart_plus_ad_id)) || ad.ad_name)
      : ad.ad_name;

    console.log(`\n  ad_id: ${ad.ad_id}`);
    console.log(`  smart_plus_ad_id: ${ad.smart_plus_ad_id || 'N/A'}`);
    console.log(`  isSmartPlusAd: ${isSmartPlusAd}`);
    console.log(`  → tiktokId (DB): ${tiktokIdToUse}`);
    console.log(`  → name (DB): ${adNameToUse}`);

    // DBに同じtiktokIdで存在するか確認
    const existingAd = await prisma.ad.findUnique({
      where: { tiktokId: tiktokIdToUse }
    });
    console.log(`  → DB存在: ${existingAd ? `✓ (現在の名前: ${existingAd.name})` : '✗'}`);
  }

  // 3. 重複チェック
  console.log('\n[重複チェック]');
  const allTiktokIds = regularAds.map((ad: any) => {
    const isSmartPlusAd = !!ad.smart_plus_ad_id;
    return isSmartPlusAd ? String(ad.smart_plus_ad_id) : String(ad.ad_id);
  });
  const uniqueTiktokIds = [...new Set(allTiktokIds)];

  console.log(`生成されるtiktokId数: ${allTiktokIds.length}`);
  console.log(`ユニークなtiktokId数: ${uniqueTiktokIds.length}`);

  if (allTiktokIds.length !== uniqueTiktokIds.length) {
    console.log('⚠️ 重複するtiktokIdがあります！');
  } else {
    console.log('✓ 重複なし');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
