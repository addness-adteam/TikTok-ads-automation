/**
 * 重複メトリクスのクリーンアップスクリプト
 *
 * 問題: タイムゾーン処理の不整合により、同じ日付のメトリクスが
 * 異なるstatDate（例: 2025-12-01T00:00:00Z と 2025-11-30T15:00:00Z）で保存されている
 *
 * 対策:
 * 1. 同じad/adgroup/campaignで同じ「日付」のメトリクスを検出
 * 2. 最新のcreatedAtのレコードを残し、古い重複を削除
 * 3. 残ったレコードのstatDateをUTC 00:00:00形式に正規化
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 日付をUTC 00:00:00形式の文字列に正規化
function normalizeToDateString(date: Date): string {
  // JST 00:00 = UTC 15:00 の場合も考慮して、日本時間ベースで日付を取得
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstDate = new Date(date.getTime() + jstOffset);
  return jstDate.toISOString().split('T')[0];
}

// 正規化されたstatDateを生成
function createNormalizedStatDate(dateString: string): Date {
  return new Date(dateString + 'T00:00:00.000Z');
}

async function cleanupDuplicateMetrics() {
  console.log('='.repeat(80));
  console.log('重複メトリクスのクリーンアップ');
  console.log('='.repeat(80));

  // AD単位で処理
  console.log('\n[Step 1] ADレベルのメトリクスを処理中...');

  const adMetrics = await prisma.metric.findMany({
    where: {
      entityType: 'AD',
      adId: { not: null }
    },
    orderBy: [
      { adId: 'asc' },
      { statDate: 'asc' },
      { createdAt: 'desc' }
    ]
  });

  console.log(`  取得したADメトリクス数: ${adMetrics.length}`);

  // adId + 日付でグループ化
  const adGroups = new Map<string, typeof adMetrics>();

  for (const metric of adMetrics) {
    const dateStr = normalizeToDateString(metric.statDate);
    const key = `${metric.adId}_${dateStr}`;

    if (!adGroups.has(key)) {
      adGroups.set(key, []);
    }
    adGroups.get(key)!.push(metric);
  }

  let duplicateAdCount = 0;
  let deletedAdCount = 0;
  let normalizedAdCount = 0;

  for (const [key, metrics] of adGroups.entries()) {
    if (metrics.length > 1) {
      duplicateAdCount++;
      console.log(`\n  重複検出: ${key}`);

      // createdAtが最新のものを残す
      metrics.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const keep = metrics[0];
      const toDelete = metrics.slice(1);

      console.log(`    保持: id=${keep.id}, statDate=${keep.statDate.toISOString()}, createdAt=${keep.createdAt.toISOString()}, spend=${keep.spend}`);

      for (const m of toDelete) {
        console.log(`    削除: id=${m.id}, statDate=${m.statDate.toISOString()}, createdAt=${m.createdAt.toISOString()}, spend=${m.spend}`);
        await prisma.metric.delete({ where: { id: m.id } });
        deletedAdCount++;
      }

      // 保持したレコードのstatDateを正規化
      const normalizedDate = createNormalizedStatDate(normalizeToDateString(keep.statDate));
      if (keep.statDate.getTime() !== normalizedDate.getTime()) {
        await prisma.metric.update({
          where: { id: keep.id },
          data: { statDate: normalizedDate }
        });
        console.log(`    正規化: ${keep.statDate.toISOString()} → ${normalizedDate.toISOString()}`);
        normalizedAdCount++;
      }
    }
  }

  console.log(`\n  ADメトリクス: 重複グループ=${duplicateAdCount}, 削除=${deletedAdCount}, 正規化=${normalizedAdCount}`);

  // ADGROUP単位で処理
  console.log('\n[Step 2] ADGROUPレベルのメトリクスを処理中...');

  const adgroupMetrics = await prisma.metric.findMany({
    where: {
      entityType: 'ADGROUP',
      adgroupId: { not: null }
    },
    orderBy: [
      { adgroupId: 'asc' },
      { statDate: 'asc' },
      { createdAt: 'desc' }
    ]
  });

  console.log(`  取得したADGROUPメトリクス数: ${adgroupMetrics.length}`);

  const adgroupGroups = new Map<string, typeof adgroupMetrics>();

  for (const metric of adgroupMetrics) {
    const dateStr = normalizeToDateString(metric.statDate);
    const key = `${metric.adgroupId}_${dateStr}`;

    if (!adgroupGroups.has(key)) {
      adgroupGroups.set(key, []);
    }
    adgroupGroups.get(key)!.push(metric);
  }

  let duplicateAdgroupCount = 0;
  let deletedAdgroupCount = 0;
  let normalizedAdgroupCount = 0;

  for (const [key, metrics] of adgroupGroups.entries()) {
    if (metrics.length > 1) {
      duplicateAdgroupCount++;

      metrics.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const keep = metrics[0];
      const toDelete = metrics.slice(1);

      for (const m of toDelete) {
        await prisma.metric.delete({ where: { id: m.id } });
        deletedAdgroupCount++;
      }

      const normalizedDate = createNormalizedStatDate(normalizeToDateString(keep.statDate));
      if (keep.statDate.getTime() !== normalizedDate.getTime()) {
        await prisma.metric.update({
          where: { id: keep.id },
          data: { statDate: normalizedDate }
        });
        normalizedAdgroupCount++;
      }
    }
  }

  console.log(`  ADGROUPメトリクス: 重複グループ=${duplicateAdgroupCount}, 削除=${deletedAdgroupCount}, 正規化=${normalizedAdgroupCount}`);

  // CAMPAIGN単位で処理
  console.log('\n[Step 3] CAMPAIGNレベルのメトリクスを処理中...');

  const campaignMetrics = await prisma.metric.findMany({
    where: {
      entityType: 'CAMPAIGN',
      campaignId: { not: null }
    },
    orderBy: [
      { campaignId: 'asc' },
      { statDate: 'asc' },
      { createdAt: 'desc' }
    ]
  });

  console.log(`  取得したCAMPAIGNメトリクス数: ${campaignMetrics.length}`);

  const campaignGroups = new Map<string, typeof campaignMetrics>();

  for (const metric of campaignMetrics) {
    const dateStr = normalizeToDateString(metric.statDate);
    const key = `${metric.campaignId}_${dateStr}`;

    if (!campaignGroups.has(key)) {
      campaignGroups.set(key, []);
    }
    campaignGroups.get(key)!.push(metric);
  }

  let duplicateCampaignCount = 0;
  let deletedCampaignCount = 0;
  let normalizedCampaignCount = 0;

  for (const [key, metrics] of campaignGroups.entries()) {
    if (metrics.length > 1) {
      duplicateCampaignCount++;

      metrics.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const keep = metrics[0];
      const toDelete = metrics.slice(1);

      for (const m of toDelete) {
        await prisma.metric.delete({ where: { id: m.id } });
        deletedCampaignCount++;
      }

      const normalizedDate = createNormalizedStatDate(normalizeToDateString(keep.statDate));
      if (keep.statDate.getTime() !== normalizedDate.getTime()) {
        await prisma.metric.update({
          where: { id: keep.id },
          data: { statDate: normalizedDate }
        });
        normalizedCampaignCount++;
      }
    }
  }

  console.log(`  CAMPAIGNメトリクス: 重複グループ=${duplicateCampaignCount}, 削除=${deletedCampaignCount}, 正規化=${normalizedCampaignCount}`);

  // サマリー
  console.log('\n' + '='.repeat(80));
  console.log('クリーンアップ完了サマリー');
  console.log('='.repeat(80));
  console.log(`  AD:       重複グループ=${duplicateAdCount}, 削除=${deletedAdCount}, 正規化=${normalizedAdCount}`);
  console.log(`  ADGROUP:  重複グループ=${duplicateAdgroupCount}, 削除=${deletedAdgroupCount}, 正規化=${normalizedAdgroupCount}`);
  console.log(`  CAMPAIGN: 重複グループ=${duplicateCampaignCount}, 削除=${deletedCampaignCount}, 正規化=${normalizedCampaignCount}`);
  console.log(`  合計削除: ${deletedAdCount + deletedAdgroupCount + deletedCampaignCount}`);

  await prisma.$disconnect();
}

cleanupDuplicateMetrics().catch(console.error);
