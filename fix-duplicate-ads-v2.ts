import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== 重複広告レコードの整理 (v2) ===\n');

  // CR00675-CR00678の重複ペア
  const duplicatePairs = [
    {
      ad_id: '1850259613723809',
      smart_plus_ad_id: '1850253042082962',
      correctName: '251201/高橋海斗/配達員/冒頭4/LP1-CR00678',
      crNumber: 'CR00678'
    },
    {
      ad_id: '1850259613721729',
      smart_plus_ad_id: '1850263330732082',
      correctName: '251201/高橋海斗/配達員/冒頭3/LP1-CR00677',
      crNumber: 'CR00677'
    },
    {
      ad_id: '1850259613343777',
      smart_plus_ad_id: '1850263330733058',
      correctName: '251201/高橋海斗/配達員/冒頭1/LP1-CR00675',
      crNumber: 'CR00675'
    },
    {
      ad_id: '1850259613341697',
      smart_plus_ad_id: '1850263330733074',
      correctName: '251201/高橋海斗/配達員/冒頭2/LP1-CR00676',
      crNumber: 'CR00676'
    },
  ];

  for (const pair of duplicatePairs) {
    console.log(`\n--- ${pair.crNumber} の重複整理 ---`);

    // ad_id で保存されているレコード（古い形式、削除対象）
    const adByAdId = await prisma.ad.findUnique({
      where: { tiktokId: pair.ad_id },
      include: {
        _count: { select: { metrics: true } }
      }
    });

    // smart_plus_ad_id で保存されているレコード（正しい形式、保持）
    const adBySmartPlusId = await prisma.ad.findUnique({
      where: { tiktokId: pair.smart_plus_ad_id },
      include: {
        _count: { select: { metrics: true } }
      }
    });

    if (!adByAdId && !adBySmartPlusId) {
      console.log(`❌ 両方のレコードが見つかりません`);
      continue;
    }

    if (!adByAdId) {
      console.log(`✅ ad_id形式のレコードは存在しません（既に正しい状態）`);
      console.log(`  smart_plus_ad_id: ${pair.smart_plus_ad_id}`);
      console.log(`  name: ${adBySmartPlusId?.name}`);
      continue;
    }

    if (!adBySmartPlusId) {
      console.log(`⚠️ smart_plus_ad_id形式のレコードが存在しません`);
      console.log(`  ad_id形式のレコードを更新します`);

      await prisma.ad.update({
        where: { id: adByAdId.id },
        data: {
          tiktokId: pair.smart_plus_ad_id,
          name: pair.correctName
        }
      });
      console.log(`✅ 更新完了`);
      continue;
    }

    // 両方存在する場合 - 重複を解消
    console.log(`重複状態:`);
    console.log(`  ad_id形式: ${adByAdId.tiktokId} - "${adByAdId.name}" (メトリクス: ${adByAdId._count.metrics})`);
    console.log(`  smart_plus_ad_id形式: ${adBySmartPlusId.tiktokId} - "${adBySmartPlusId.name}" (メトリクス: ${adBySmartPlusId._count.metrics})`);

    // smart_plus_ad_id形式のレコードを保持するため、ad_id形式のレコードと関連データを削除
    // メトリクスはsmart_plus_ad_id形式の方に既にあるはずなので、ad_id形式の方は単純に削除

    // ad_id形式のレコードに紐付いているメトリクスを削除
    if (adByAdId._count.metrics > 0) {
      await prisma.metric.deleteMany({
        where: { adId: adByAdId.id }
      });
      console.log(`  ad_id形式のメトリクス ${adByAdId._count.metrics}件を削除`);
    }

    // AdPerformanceも削除（存在する場合）
    const adPerformance = await prisma.adPerformance.findUnique({
      where: { adId: adByAdId.id }
    });
    if (adPerformance) {
      await prisma.adPerformance.delete({
        where: { adId: adByAdId.id }
      });
      console.log(`  ad_id形式のAdPerformanceを削除`);
    }

    // AdBudgetCapも削除（存在する場合）
    const adBudgetCap = await prisma.adBudgetCap.findUnique({
      where: { adId: adByAdId.id }
    });
    if (adBudgetCap) {
      await prisma.adBudgetCap.delete({
        where: { adId: adByAdId.id }
      });
      console.log(`  ad_id形式のAdBudgetCapを削除`);
    }

    // ad_id形式のレコードを削除
    await prisma.ad.delete({
      where: { id: adByAdId.id }
    });
    console.log(`✅ ad_id形式のレコードを削除`);
  }

  // 最終確認
  console.log('\n\n=== 整理後の状態確認 ===\n');

  for (const pair of duplicatePairs) {
    const adByAdId = await prisma.ad.findUnique({
      where: { tiktokId: pair.ad_id }
    });
    const adBySmartPlusId = await prisma.ad.findUnique({
      where: { tiktokId: pair.smart_plus_ad_id },
      include: {
        _count: { select: { metrics: true } }
      }
    });

    console.log(`${pair.crNumber}:`);
    console.log(`  ad_id (${pair.ad_id}): ${adByAdId ? '❌ まだ存在' : '✅ 削除済み'}`);
    console.log(`  smart_plus_ad_id (${pair.smart_plus_ad_id}): ${adBySmartPlusId ? `✅ "${adBySmartPlusId.name}" (メトリクス: ${adBySmartPlusId._count.metrics})` : '❌ 存在しない'}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
