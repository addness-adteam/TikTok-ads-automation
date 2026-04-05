import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 該当広告のDBレコードを確認
  console.log('=== DB状態の確認 ===\n');

  // ad_id で保存されているレコード
  const adById = await prisma.ad.findMany({
    where: {
      tiktokId: {
        in: ['1850472050889730', '1850472050886754']  // ad_id
      }
    },
    include: {
      adGroup: true
    }
  });

  console.log('Records with ad_id as tiktokId:');
  adById.forEach(ad => {
    console.log(`  tiktokId: ${ad.tiktokId}`);
    console.log(`  name: ${ad.name}`);
    console.log(`  adGroupId: ${ad.adgroupId}`);
    console.log('');
  });

  // smart_plus_ad_id で保存されているレコード
  const adBySmartPlusId = await prisma.ad.findMany({
    where: {
      tiktokId: {
        in: ['1850472306618481', '1850472803071026']  // smart_plus_ad_id
      }
    }
  });

  console.log('Records with smart_plus_ad_id as tiktokId:');
  if (adBySmartPlusId.length > 0) {
    adBySmartPlusId.forEach(ad => {
      console.log(`  tiktokId: ${ad.tiktokId}`);
      console.log(`  name: ${ad.name}`);
      console.log('');
    });
  } else {
    console.log('  ❌ None found');
  }

  // AdGroupを確認
  console.log('\n=== AdGroup確認 ===\n');
  const adGroup = await prisma.adGroup.findUnique({
    where: { tiktokId: '1850472306610337' },  // campaign API から取得したadgroup_id
    include: {
      campaign: true
    }
  });

  if (adGroup) {
    console.log('AdGroup found:');
    console.log(`  id: ${adGroup.id}`);
    console.log(`  tiktokId: ${adGroup.tiktokId}`);
    console.log(`  name: ${adGroup.name}`);
    console.log(`  campaignId: ${adGroup.campaignId}`);
    console.log(`  campaign name: ${adGroup.campaign.name}`);
  } else {
    console.log('❌ AdGroup not found');
  }

  // メトリクスを確認
  console.log('\n=== Metrics確認 ===\n');

  // ad_idで紐付いているメトリクス
  if (adById.length > 0) {
    const metricsById = await prisma.metric.findMany({
      where: {
        adId: { in: adById.map(a => a.id) }
      },
      orderBy: { statDate: 'desc' },
      take: 10
    });

    console.log(`Metrics for ad_id based records (${metricsById.length} found):`);
    metricsById.forEach(m => {
      console.log(`  date: ${m.statDate.toISOString().split('T')[0]}, spend: ${m.spend}, impressions: ${m.impressions}`);
    });
  }

  // smart_plus_ad_idで紐付いているメトリクス
  if (adBySmartPlusId.length > 0) {
    const metricsBySmartPlusId = await prisma.metric.findMany({
      where: {
        adId: { in: adBySmartPlusId.map(a => a.id) }
      },
      orderBy: { statDate: 'desc' },
      take: 10
    });

    console.log(`Metrics for smart_plus_ad_id based records (${metricsBySmartPlusId.length} found):`);
    metricsBySmartPlusId.forEach(m => {
      console.log(`  date: ${m.statDate.toISOString().split('T')[0]}, spend: ${m.spend}, impressions: ${m.impressions}`);
    });
  }

  // 直近の同期ログを確認
  console.log('\n=== 最近のAPIログ確認 ===\n');
  const recentLogs = await prisma.aPILog.findMany({
    where: {
      endpoint: { contains: 'smart' },
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }  // 過去24時間
    },
    orderBy: { createdAt: 'desc' },
    take: 5
  });

  if (recentLogs.length > 0) {
    console.log('Recent Smart+ related API logs:');
    recentLogs.forEach(log => {
      console.log(`  ${log.createdAt.toISOString()} - ${log.endpoint} - Status: ${log.responseStatus}`);
    });
  } else {
    console.log('No recent Smart+ API logs found');
  }

  // 同期されるべき新しい広告の確認
  console.log('\n=== 同期問題の診断 ===\n');
  console.log('Expected behavior after fix:');
  console.log('  1. ad/get returns ad_id=1850472050889730, smart_plus_ad_id=1850472306618481');
  console.log('  2. Since smart_plus_ad_id exists, tiktokId should be 1850472306618481');
  console.log('  3. smart_plus/ad/get returns ad_name="251204/高橋海斗/インタビュー（全員）/LP1-CR00679"');
  console.log('  4. DB record should have tiktokId=1850472306618481, name="251204/高橋海斗/..."');
  console.log('');
  console.log('Actual state:');
  console.log('  - DB has tiktokId=1850472050889730 (ad_id instead of smart_plus_ad_id)');
  console.log('  - DB has name="TTインタビュー1年後悔[全員冒頭あり].mp4" (creative name instead of manual name)');
  console.log('');
  console.log('Diagnosis: This ad was synced BEFORE the fix on 2025-12-02.');
  console.log('The fix only affects NEW syncs, not existing records.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
