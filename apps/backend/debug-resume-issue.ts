import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function getTodayJST(): Date {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstNow = new Date(now.getTime() + jstOffset);
  jstNow.setUTCHours(0, 0, 0, 0);
  return jstNow;
}

async function main() {
  // 対象広告の停止ログを確認
  const pauseLogs = await prisma.intradayPauseLog.findMany({
    where: {
      adId: {
        in: [
          '1852043655860306', // CR00724
          '1852044836697202', // CR00733
          '1852171711209473', // CR00734
        ]
      }
    },
    orderBy: { pauseTime: 'desc' },
  });

  console.log('=== 停止ログの詳細 ===');
  for (const log of pauseLogs) {
    console.log(`\nAd ID: ${log.adId}`);
    console.log(`  pauseDate (保存値): ${log.pauseDate.toISOString()}`);
    console.log(`  pauseTime: ${log.pauseTime.toISOString()}`);
    console.log(`  resumed: ${log.resumed}`);
    console.log(`  resumeTime: ${log.resumeTime?.toISOString() || 'null'}`);
  }

  // getTodayJST()の動作確認
  console.log('\n=== getTodayJST() の確認 ===');
  const today = getTodayJST();
  console.log(`現在時刻: ${new Date().toISOString()}`);
  console.log(`getTodayJST(): ${today.toISOString()}`);

  // 12/29 23:59に実行された場合のシミュレーション
  const dec29_2359 = new Date('2024-12-29T14:59:00.000Z'); // UTC 14:59 = JST 23:59
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstNow = new Date(dec29_2359.getTime() + jstOffset);
  jstNow.setUTCHours(0, 0, 0, 0);
  console.log(`\n12/29 23:59(JST)時点でのgetTodayJST(): ${jstNow.toISOString()}`);

  // 比較確認
  console.log('\n=== pauseDate と today の比較 ===');
  for (const log of pauseLogs) {
    console.log(`\nAd ${log.adId.slice(-6)}:`);
    console.log(`  pauseDate: ${log.pauseDate.toISOString()}`);
    console.log(`  シミュレーション上の today: ${jstNow.toISOString()}`);
    console.log(`  一致するか: ${log.pauseDate.getTime() === jstNow.getTime()}`);

    // pauseDateをJST表示
    const pauseDateJST = new Date(log.pauseDate.getTime());
    console.log(`  pauseDate (UTC時刻): ${pauseDateJST.toISOString()}`);
  }

  // 全ての未再開ログを確認
  console.log('\n=== 全ての未再開ログ ===');
  const unresumedLogs = await prisma.intradayPauseLog.findMany({
    where: { resumed: false },
    orderBy: { pauseTime: 'desc' },
    take: 20,
  });
  console.log(`未再開ログ数: ${unresumedLogs.length}`);
  for (const log of unresumedLogs) {
    console.log(`  ${log.adId} | pauseDate: ${log.pauseDate.toISOString()} | pauseTime: ${log.pauseTime.toISOString()}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
