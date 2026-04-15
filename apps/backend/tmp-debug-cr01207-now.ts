import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';

async function tiktokGet(ep: string, params: Record<string, any>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const r = await fetch(`${BASE}${ep}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return r.json();
}

async function main() {
  const advId = '7523128243466551303'; // AI_2
  const campId = '1862060201804930';

  console.log('=== CR01207 緊急調査 ===\n');

  // 1. キャンペーンの現在状態
  console.log('【キャンペーン状態】');
  const campResp = await tiktokGet('/v1.3/campaign/get/', {
    advertiser_id: advId,
    filtering: JSON.stringify({ campaign_ids: [campId] }),
    fields: JSON.stringify(['campaign_id', 'campaign_name', 'operation_status', 'secondary_status']),
  });
  for (const c of campResp.data?.list || []) {
    console.log(`  status: ${c.operation_status} / ${c.secondary_status}`);
    console.log(`  name: ${c.campaign_name}`);
  }

  // 2. 全広告グループの状態と予算
  console.log('\n【広告グループ（Smart+ API）】');
  const agResp = await tiktokGet('/v1.3/smart_plus/adgroup/get/', {
    advertiser_id: advId,
  });
  for (const ag of agResp.data?.list || []) {
    if (ag.campaign_id === campId) {
      console.log(`  agId: ${ag.adgroup_id} | budget: ¥${ag.budget} | status: ${ag.operation_status} | budget_mode: ${ag.budget_mode}`);
    }
  }

  // 3. 広告の状態
  console.log('\n【広告（Smart+ API）】');
  const adResp = await tiktokGet('/v1.3/smart_plus/ad/get/', {
    advertiser_id: advId,
    fields: JSON.stringify(['smart_plus_ad_id', 'ad_name', 'campaign_id', 'operation_status']),
  });
  for (const ad of adResp.data?.list || []) {
    if (ad.campaign_id === campId) {
      console.log(`  adId: ${ad.smart_plus_ad_id} | status: ${ad.operation_status} | name: ${ad.ad_name}`);
    }
  }

  // 4. 通常API側の広告状態
  console.log('\n【広告（通常API）】');
  const normalAdResp = await tiktokGet('/v1.3/ad/get/', {
    advertiser_id: advId,
    fields: JSON.stringify(['ad_id', 'ad_name', 'campaign_id', 'operation_status', 'secondary_status']),
    filtering: JSON.stringify({ campaign_ids: [campId] }),
    page_size: '100',
  });
  for (const ad of normalAdResp.data?.list || []) {
    console.log(`  adId: ${ad.ad_id} | status: ${ad.operation_status} / ${ad.secondary_status}`);
  }

  // 5. 通常API側の広告グループ予算
  console.log('\n【広告グループ（通常API）】');
  const normalAgResp = await tiktokGet('/v1.3/adgroup/get/', {
    advertiser_id: advId,
    fields: JSON.stringify(['adgroup_id', 'adgroup_name', 'campaign_id', 'budget', 'operation_status', 'secondary_status']),
    filtering: JSON.stringify({ campaign_ids: [campId] }),
    page_size: '100',
  });
  for (const ag of normalAgResp.data?.list || []) {
    console.log(`  agId: ${ag.adgroup_id} | budget: ¥${ag.budget} | status: ${ag.operation_status} / ${ag.secondary_status}`);
  }

  // 6. V2スナップショット（今日）
  console.log('\n【V2スナップショット（今日）】');
  const todayStart = new Date('2026-04-11T00:00:00+09:00');
  const snaps = await prisma.hourlyOptimizationSnapshot.findMany({
    where: {
      advertiserId: advId,
      executionTime: { gte: todayStart },
    },
    orderBy: { executionTime: 'desc' },
    take: 30,
  });
  console.log(`  件数: ${snaps.length}`);
  for (const s of snaps) {
    if (s.adName?.includes('CR01207') || s.adId === '1862060201804962') {
      console.log(`  ★ ${s.executionTime.toISOString()} | ${s.action} | CV:${s.todayCVCount} | budget:${s.dailyBudget} → ${s.newBudget} | ${s.reason}`);
    }
  }
  // CR01207以外のスナップショットもあるか
  const otherSnaps = snaps.filter(s => !s.adName?.includes('CR01207'));
  if (otherSnaps.length > 0) {
    console.log(`  他の広告のスナップショット: ${otherSnaps.length}件`);
    for (const s of otherSnaps.slice(0, 5)) {
      console.log(`  ${s.executionTime.toISOString()} | ${s.action} | ${s.adName}`);
    }
  }

  // 7. ChangeLog（CR01207関連）
  console.log('\n【ChangeLog（今日）】');
  const changeLogs = await prisma.changeLog.findMany({
    where: {
      createdAt: { gte: todayStart },
      OR: [
        { entityId: { in: ['1862060201804946', '1862060201804962', campId] } },
        { reason: { contains: 'CR01207' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  console.log(`  件数: ${changeLogs.length}`);
  for (const cl of changeLogs) {
    console.log(`  ${cl.createdAt.toISOString()} | ${cl.action} | ${cl.source} | ${cl.reason}`);
    console.log(`    before: ${JSON.stringify(cl.beforeData)} → after: ${JSON.stringify(cl.afterData)}`);
  }

  // 8. V2のStage2停止判定ログ
  console.log('\n【Stage2停止判定のスナップショット】');
  const pauseSnaps = snaps.filter(s => s.action === 'PAUSE');
  if (pauseSnaps.length > 0) {
    for (const s of pauseSnaps) {
      console.log(`  ${s.executionTime.toISOString()} | PAUSE | ${s.adName} | ${s.reason}`);
    }
  } else {
    console.log('  PAUSEアクションなし');
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); });
