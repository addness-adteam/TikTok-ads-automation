import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkYesterdayCPA() {
  const adTiktokId = '1852043386634738';

  // 前日の日付計算
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstNow = new Date(now.getTime() + jstOffset);

  const yesterday = new Date(jstNow);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);

  const nextDay = new Date(yesterday);
  nextDay.setDate(nextDay.getDate() + 1);

  console.log(`\n=== 前日CPA算出の確認 ===`);
  console.log(`広告ID: ${adTiktokId}`);
  console.log(`前日: ${yesterday.toISOString().split('T')[0]}`);

  // 広告情報を取得
  const ad = await prisma.ad.findUnique({
    where: { tiktokId: adTiktokId },
    include: {
      adgroup: {
        include: {
          campaign: {
            include: {
              advertiser: {
                include: { appeal: true }
              }
            }
          }
        }
      }
    }
  });

  if (!ad) {
    console.log('広告がDBに見つかりません');
    return;
  }

  console.log(`\n広告名: ${ad.name}`);

  // 前日のメトリクスを取得
  const metrics = await prisma.metric.findMany({
    where: {
      adId: ad.id,
      statDate: {
        gte: yesterday,
        lt: nextDay,
      },
    },
  });

  console.log(`\n【前日のメトリクス（DBから取得）】`);
  console.log(`レコード数: ${metrics.length}`);

  let totalSpend = 0;
  for (const m of metrics) {
    console.log(`  - statDate: ${m.statDate.toISOString()}, spend: ¥${m.spend.toFixed(0)}`);
    totalSpend += m.spend;
  }
  console.log(`  合計消化額: ¥${totalSpend.toFixed(0)}`);

  // 前日CVの確認（これはGoogle Sheetsから取得されるので直接は見れない）
  console.log(`\n【前日CV】`);
  console.log(`  ※ Google Sheetsから取得（登録経路: TikTok広告-AI-LP1）`);

  // 記録されたCPAから逆算
  const recordedCPA = 38931;
  if (totalSpend > 0) {
    const estimatedCV = totalSpend / recordedCPA;
    console.log(`\n【逆算】`);
    console.log(`  記録された前日CPA: ¥${recordedCPA}`);
    console.log(`  前日消化額: ¥${totalSpend.toFixed(0)}`);
    console.log(`  推定CV数: ${estimatedCV.toFixed(2)}件`);
  }
}

checkYesterdayCPA()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
