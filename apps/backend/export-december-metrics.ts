import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function exportDecemberMetrics() {
  console.log('12月のメトリクスデータをエクスポート開始...\n');

  // 12月の日付範囲（2025年12月、UTC）
  const startDate = new Date('2025-12-01T00:00:00.000Z');
  const endDate = new Date('2025-12-31T23:59:59.999Z');

  // 出力ディレクトリ
  const outputDir = path.join(__dirname, 'exports');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // =============================================
  // 1. 広告別CTR推移
  // =============================================
  console.log('1. 広告別CTR推移を取得中...');

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
    orderBy: [
      { adId: 'asc' },
      { statDate: 'asc' },
    ],
  });

  console.log(`  -> ${adMetrics.length}件の広告メトリクスを取得`);

  // 広告別CTR推移CSV
  const ctrCsvRows: string[] = [];
  ctrCsvRows.push('日付,広告ID,広告名,広告セット名,キャンペーン名,インプレッション,クリック,CTR(%)');

  for (const m of adMetrics) {
    const dateStr = m.statDate.toISOString().split('T')[0];
    const adName = m.ad?.name || 'Unknown';
    const adgroupName = m.ad?.adGroup?.name || 'Unknown';
    const campaignName = m.ad?.adGroup?.campaign?.name || 'Unknown';
    const adTiktokId = m.ad?.tiktokId || m.adId || 'Unknown';

    // CTRを計算（impressionsが0の場合は0）
    const ctr = m.impressions > 0 ? ((m.clicks / m.impressions) * 100).toFixed(4) : '0';

    ctrCsvRows.push(
      `${dateStr},"${adTiktokId}","${adName.replace(/"/g, '""')}","${adgroupName.replace(/"/g, '""')}","${campaignName.replace(/"/g, '""')}",${m.impressions},${m.clicks},${ctr}`
    );
  }

  const ctrOutputPath = path.join(outputDir, '12月_広告別CTR推移.csv');
  fs.writeFileSync(ctrOutputPath, '\uFEFF' + ctrCsvRows.join('\n'), 'utf8');
  console.log(`  -> 保存完了: ${ctrOutputPath}`);

  // =============================================
  // 2. 広告別CVR推移
  // =============================================
  console.log('\n2. 広告別CVR推移を取得中...');

  const cvrCsvRows: string[] = [];
  cvrCsvRows.push('日付,広告ID,広告名,広告セット名,キャンペーン名,クリック,コンバージョン,CVR(%),消費額,CPA');

  for (const m of adMetrics) {
    const dateStr = m.statDate.toISOString().split('T')[0];
    const adName = m.ad?.name || 'Unknown';
    const adgroupName = m.ad?.adGroup?.name || 'Unknown';
    const campaignName = m.ad?.adGroup?.campaign?.name || 'Unknown';
    const adTiktokId = m.ad?.tiktokId || m.adId || 'Unknown';

    // CVRを計算（clicksが0の場合は0）
    const cvr = m.clicks > 0 ? ((m.conversions / m.clicks) * 100).toFixed(4) : '0';
    const cpa = m.conversions > 0 ? (m.spend / m.conversions).toFixed(2) : '0';

    cvrCsvRows.push(
      `${dateStr},"${adTiktokId}","${adName.replace(/"/g, '""')}","${adgroupName.replace(/"/g, '""')}","${campaignName.replace(/"/g, '""')}",${m.clicks},${m.conversions},${cvr},${m.spend.toFixed(2)},${cpa}`
    );
  }

  const cvrOutputPath = path.join(outputDir, '12月_広告別CVR推移.csv');
  fs.writeFileSync(cvrOutputPath, '\uFEFF' + cvrCsvRows.join('\n'), 'utf8');
  console.log(`  -> 保存完了: ${cvrOutputPath}`);

  // =============================================
  // 3. 広告セット別CVR
  // =============================================
  console.log('\n3. 広告セット別CVR推移を取得中...');

  const adgroupMetrics = await prisma.metric.findMany({
    where: {
      entityType: 'ADGROUP',
      statDate: {
        gte: startDate,
        lte: endDate,
      },
    },
    include: {
      adGroup: {
        include: {
          campaign: true,
        },
      },
    },
    orderBy: [
      { adgroupId: 'asc' },
      { statDate: 'asc' },
    ],
  });

  console.log(`  -> ${adgroupMetrics.length}件の広告セットメトリクスを取得`);

  const adgroupCvrCsvRows: string[] = [];
  adgroupCvrCsvRows.push('日付,広告セットID,広告セット名,キャンペーン名,インプレッション,クリック,コンバージョン,CTR(%),CVR(%),消費額,CPA');

  for (const m of adgroupMetrics) {
    const dateStr = m.statDate.toISOString().split('T')[0];
    const adgroupName = m.adGroup?.name || 'Unknown';
    const campaignName = m.adGroup?.campaign?.name || 'Unknown';
    const adgroupTiktokId = m.adGroup?.tiktokId || m.adgroupId || 'Unknown';

    const ctr = m.impressions > 0 ? ((m.clicks / m.impressions) * 100).toFixed(4) : '0';
    const cvr = m.clicks > 0 ? ((m.conversions / m.clicks) * 100).toFixed(4) : '0';
    const cpa = m.conversions > 0 ? (m.spend / m.conversions).toFixed(2) : '0';

    adgroupCvrCsvRows.push(
      `${dateStr},"${adgroupTiktokId}","${adgroupName.replace(/"/g, '""')}","${campaignName.replace(/"/g, '""')}",${m.impressions},${m.clicks},${m.conversions},${ctr},${cvr},${m.spend.toFixed(2)},${cpa}`
    );
  }

  const adgroupOutputPath = path.join(outputDir, '12月_広告セット別CVR推移.csv');
  fs.writeFileSync(adgroupOutputPath, '\uFEFF' + adgroupCvrCsvRows.join('\n'), 'utf8');
  console.log(`  -> 保存完了: ${adgroupOutputPath}`);

  // =============================================
  // サマリー
  // =============================================
  console.log('\n========================================');
  console.log('エクスポート完了！');
  console.log('========================================');
  console.log(`出力先: ${outputDir}`);
  console.log('\n生成されたファイル:');
  console.log('  1. 12月_広告別CTR推移.csv');
  console.log('  2. 12月_広告別CVR推移.csv');
  console.log('  3. 12月_広告セット別CVR推移.csv');

  await prisma.$disconnect();
}

exportDecemberMetrics().catch((e) => {
  console.error('エラーが発生しました:', e);
  prisma.$disconnect();
  process.exit(1);
});
