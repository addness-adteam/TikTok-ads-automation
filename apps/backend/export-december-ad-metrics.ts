import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface AdSummary {
  adId: string;
  adTiktokId: string;
  adName: string;
  adgroupName: string;
  campaignName: string;
  totalImpressions: number;
  totalClicks: number;
  totalConversions: number;
  totalSpend: number;
}

async function exportDecemberAdMetrics() {
  console.log('12月の広告別メトリクスサマリーをエクスポート開始...\n');

  // 12月の日付範囲（2025年12月、UTC）
  const startDate = new Date('2025-12-01T00:00:00.000Z');
  const endDate = new Date('2025-12-31T23:59:59.999Z');

  // 出力ディレクトリ
  const outputDir = path.join(__dirname, 'exports');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('広告別メトリクスを取得中...');

  // 広告別のメトリクスを取得
  const adMetrics = await prisma.metric.findMany({
    where: {
      entityType: 'AD',
      statDate: {
        gte: startDate,
        lte: endDate,
      },
    },
    include: {
      ad: {
        include: {
          adGroup: {
            include: {
              campaign: true,
            },
          },
        },
      },
    },
  });

  console.log(`  -> ${adMetrics.length}件の日別メトリクスを取得`);

  // 広告ごとに集計
  const adSummaryMap = new Map<string, AdSummary>();

  for (const m of adMetrics) {
    const adId = m.adId || 'unknown';

    if (!adSummaryMap.has(adId)) {
      adSummaryMap.set(adId, {
        adId: adId,
        adTiktokId: m.ad?.tiktokId || adId,
        adName: m.ad?.name || 'Unknown',
        adgroupName: m.ad?.adGroup?.name || 'Unknown',
        campaignName: m.ad?.adGroup?.campaign?.name || 'Unknown',
        totalImpressions: 0,
        totalClicks: 0,
        totalConversions: 0,
        totalSpend: 0,
      });
    }

    const summary = adSummaryMap.get(adId)!;
    summary.totalImpressions += m.impressions;
    summary.totalClicks += m.clicks;
    summary.totalConversions += m.conversions;
    summary.totalSpend += m.spend;
  }

  console.log(`  -> ${adSummaryMap.size}件の広告に集計`);

  // CSV作成
  const csvRows: string[] = [];
  csvRows.push('広告ID,広告名,広告セット名,キャンペーン名,インプレッション,クリック,コンバージョン,消費額,CPM,CTR(%),CVR(%),CPA');

  // 消費額順でソート
  const sortedAds = Array.from(adSummaryMap.values()).sort((a, b) => b.totalSpend - a.totalSpend);

  for (const ad of sortedAds) {
    // メトリクス計算
    const cpm = ad.totalImpressions > 0
      ? ((ad.totalSpend / ad.totalImpressions) * 1000).toFixed(2)
      : '0';

    const ctr = ad.totalImpressions > 0
      ? ((ad.totalClicks / ad.totalImpressions) * 100).toFixed(4)
      : '0';

    const cvr = ad.totalClicks > 0
      ? ((ad.totalConversions / ad.totalClicks) * 100).toFixed(4)
      : '0';

    const cpa = ad.totalConversions > 0
      ? (ad.totalSpend / ad.totalConversions).toFixed(2)
      : '0';

    csvRows.push(
      `"${ad.adTiktokId}","${ad.adName.replace(/"/g, '""')}","${ad.adgroupName.replace(/"/g, '""')}","${ad.campaignName.replace(/"/g, '""')}",${ad.totalImpressions},${ad.totalClicks},${ad.totalConversions},${ad.totalSpend.toFixed(2)},${cpm},${ctr},${cvr},${cpa}`
    );
  }

  const outputPath = path.join(outputDir, '12月_広告別サマリー_CPM_CTR_CVR_CPA.csv');
  fs.writeFileSync(outputPath, '\uFEFF' + csvRows.join('\n'), 'utf8');
  console.log(`\n保存完了: ${outputPath}`);

  // 統計情報を表示
  const totalSpend = sortedAds.reduce((sum, ad) => sum + ad.totalSpend, 0);
  const totalConversions = sortedAds.reduce((sum, ad) => sum + ad.totalConversions, 0);
  const adsWithConversions = sortedAds.filter(ad => ad.totalConversions > 0).length;

  console.log('\n========================================');
  console.log('エクスポート完了！');
  console.log('========================================');
  console.log(`出力先: ${outputPath}`);
  console.log(`\n統計情報:`);
  console.log(`  広告数: ${sortedAds.length}件`);
  console.log(`  コンバージョンのある広告: ${adsWithConversions}件`);
  console.log(`  総消費額: ¥${totalSpend.toLocaleString()}`);
  console.log(`  総コンバージョン: ${totalConversions}件`);
  console.log(`  平均CPA: ¥${totalConversions > 0 ? (totalSpend / totalConversions).toFixed(2) : '0'}`);

  await prisma.$disconnect();
}

exportDecemberAdMetrics().catch((e) => {
  console.error('エラーが発生しました:', e);
  prisma.$disconnect();
  process.exit(1);
});
