import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== CR00679/CR00680 のDBレコード修正 ===\n');

  // 修正対象のマッピング
  const fixTargets = [
    {
      oldTiktokId: '1850472050889730',  // 現在のad_id
      newTiktokId: '1850472306618481',  // 正しいsmart_plus_ad_id
      newName: '251204/高橋海斗/インタビュー（全員）/LP1-CR00679',
      crNumber: 'CR00679'
    },
    {
      oldTiktokId: '1850472050886754',  // 現在のad_id
      newTiktokId: '1850472803071026',  // 正しいsmart_plus_ad_id
      newName: '251204/高橋海斗/インタビュー（一人）/LP1-CR00680',
      crNumber: 'CR00680'
    }
  ];

  for (const target of fixTargets) {
    console.log(`\n--- ${target.crNumber} の修正 ---`);

    // 現在のレコードを確認
    const existingAd = await prisma.ad.findUnique({
      where: { tiktokId: target.oldTiktokId }
    });

    if (!existingAd) {
      console.log(`❌ ${target.crNumber}: 既存レコードが見つかりません (tiktokId: ${target.oldTiktokId})`);
      continue;
    }

    console.log(`現在の状態:`);
    console.log(`  id: ${existingAd.id}`);
    console.log(`  tiktokId: ${existingAd.tiktokId}`);
    console.log(`  name: ${existingAd.name}`);

    // 新しいtiktokIdで既にレコードが存在しないか確認
    const duplicateAd = await prisma.ad.findUnique({
      where: { tiktokId: target.newTiktokId }
    });

    if (duplicateAd) {
      console.log(`⚠️ 新しいtiktokId (${target.newTiktokId}) で既にレコードが存在します`);
      console.log(`  既存レコードを削除して、現在のレコードを更新します`);

      // 重複レコードに紐付いているメトリクスを移行
      const duplicateMetrics = await prisma.metric.findMany({
        where: { adId: duplicateAd.id }
      });

      if (duplicateMetrics.length > 0) {
        console.log(`  重複レコードに紐付いているメトリクス: ${duplicateMetrics.length}件`);
        // メトリクスを現在のレコードに移行
        await prisma.metric.updateMany({
          where: { adId: duplicateAd.id },
          data: { adId: existingAd.id }
        });
        console.log(`  メトリクスを移行しました`);
      }

      // 重複レコードを削除
      await prisma.ad.delete({
        where: { id: duplicateAd.id }
      });
      console.log(`  重複レコードを削除しました`);
    }

    // レコードを更新
    const updatedAd = await prisma.ad.update({
      where: { id: existingAd.id },
      data: {
        tiktokId: target.newTiktokId,
        name: target.newName,
      }
    });

    console.log(`✅ 更新完了:`);
    console.log(`  tiktokId: ${target.oldTiktokId} → ${updatedAd.tiktokId}`);
    console.log(`  name: ${existingAd.name} → ${updatedAd.name}`);
  }

  // 修正後の確認
  console.log('\n\n=== 修正後の確認 ===\n');

  for (const target of fixTargets) {
    const ad = await prisma.ad.findUnique({
      where: { tiktokId: target.newTiktokId },
      include: {
        _count: {
          select: { metrics: true }
        }
      }
    });

    if (ad) {
      console.log(`${target.crNumber}:`);
      console.log(`  tiktokId: ${ad.tiktokId}`);
      console.log(`  name: ${ad.name}`);
      console.log(`  メトリクス数: ${ad._count.metrics}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
