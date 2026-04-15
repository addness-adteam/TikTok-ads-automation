/**
 * 1. CR454横展開の全キャンペーンの初期予算を確認
 * 2. V2が予算を上げない原因を特定
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';

const ACCOUNTS = [
  { id: '7468288053866561553', name: 'AI_1' },
  { id: '7523128243466551303', name: 'AI_2' },
  { id: '7543540647266074641', name: 'AI_3' },
  { id: '7580666710525493255', name: 'AI_4' },
];

async function tiktokGet(ep: string, params: Record<string, any>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const r = await fetch(`${BASE}${ep}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return r.json();
}

function jstDate(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3600000);
  return `${j.getUTCFullYear()}-${String(j.getUTCMonth() + 1).padStart(2, '0')}-${String(j.getUTCDate()).padStart(2, '0')}`;
}

async function main() {
  const now = new Date();
  const today = jstDate(now);
  const yesterday = jstDate(new Date(now.getTime() - 86400000));

  console.log('====================================================');
  console.log('1. CR454横展開の全キャンペーン 予算確認');
  console.log('====================================================\n');

  for (const acc of ACCOUNTS) {
    let page = 1;
    while (true) {
      const resp = await tiktokGet('/v1.3/campaign/get/', {
        advertiser_id: acc.id, page_size: '100', page: String(page),
        fields: JSON.stringify(['campaign_id', 'campaign_name', 'operation_status']),
      });
      if (resp.code !== 0) break;
      for (const c of resp.data?.list || []) {
        if (!c.campaign_name?.includes('CR454')) continue;

        // このキャンペーンの広告グループ予算を取得
        const agResp = await tiktokGet('/v1.3/smart_plus/adgroup/get/', {
          advertiser_id: acc.id,
        });
        for (const ag of agResp.data?.list || []) {
          if (ag.campaign_id !== c.campaign_id) continue;
          console.log(`${acc.name} | ¥${ag.budget} | ${c.operation_status} | ${c.campaign_name}`);
        }
      }
      if ((resp.data?.list || []).length < 100) break;
      page++;
    }
  }

  console.log('\n====================================================');
  console.log('2. V2が予算を上げない原因調査');
  console.log('====================================================\n');

  // CR01207の広告IDは 1862060201804962（Smart+）
  const targetAdId = '1862060201804962';
  const targetAdvId = '7523128243466551303'; // AI_2

  // 2a. V2のスナップショットがそもそもあるか（全adIdで検索）
  console.log('--- 2a. 今日のV2スナップショット（AI_2全体）---');
  const todayStart = new Date(today + 'T00:00:00+09:00');
  const allSnaps = await prisma.hourlyOptimizationSnapshot.findMany({
    where: {
      advertiserId: targetAdvId,
      executionTime: { gte: todayStart },
    },
    orderBy: { executionTime: 'desc' },
  });
  console.log(`AI_2の今日のスナップショット: ${allSnaps.length}件`);
  const uniqueAds = new Set(allSnaps.map(s => s.adId));
  console.log(`ユニーク広告ID: ${uniqueAds.size}件`);
  for (const adId of uniqueAds) {
    const snaps = allSnaps.filter(s => s.adId === adId);
    const last = snaps[0];
    console.log(`  ${adId} | ${snaps.length}回 | 最新: ${last.action} CV:${last.todayCVCount} budget:${last.dailyBudget} | ${last.adName}`);
  }

  // CR01207が含まれているか
  const cr01207Snaps = allSnaps.filter(s => s.adId === targetAdId || s.adName?.includes('CR01207'));
  console.log(`\nCR01207のスナップショット: ${cr01207Snaps.length}件`);

  // 2b. V2がどの広告をターゲットにしているか確認
  // V2はSmart+ APIで広告を取得するので、Smart+ ad/getで見えるか確認
  console.log('\n--- 2b. Smart+ API で CR01207 が見えるか ---');
  const spResp = await tiktokGet('/v1.3/smart_plus/ad/get/', {
    advertiser_id: targetAdvId,
    fields: JSON.stringify(['smart_plus_ad_id', 'ad_name', 'campaign_id', 'operation_status']),
    page_size: '100',
  });
  let found = false;
  for (const ad of spResp.data?.list || []) {
    if (ad.smart_plus_ad_id === targetAdId || ad.ad_name?.includes('CR01207')) {
      console.log(`  見つかった: ${ad.smart_plus_ad_id} | ${ad.operation_status} | ${ad.ad_name}`);
      found = true;
    }
  }
  if (!found) {
    console.log('  ⚠ CR01207がSmart+ ad/getで見つからない！');
    console.log('  → V2はこの広告を認識できていない可能性');

    // 通常のad/getでは見えるか
    console.log('\n--- 2c. 通常 ad/get で見えるか ---');
    const normalResp = await tiktokGet('/v1.3/ad/get/', {
      advertiser_id: targetAdvId,
      fields: JSON.stringify(['ad_id', 'ad_name', 'campaign_id', 'operation_status', 'secondary_status']),
      filtering: JSON.stringify({ campaign_ids: ['1862060201804930'] }),
      page_size: '100',
    });
    for (const ad of normalResp.data?.list || []) {
      console.log(`  通常API: ${ad.ad_id} | ${ad.operation_status} | ${ad.secondary_status} | ${ad.ad_name}`);
    }
  }

  // 2d. V2のサービスコードがどうやって広告を取得しているか
  // → Appeal設定の確認（CRの登録経路がV2に認識されているか）
  console.log('\n--- 2d. Appeal/Advertiser DB設定確認 ---');
  const advertiser = await prisma.advertiser.findUnique({
    where: { tiktokAdvertiserId: targetAdvId },
    include: { appeal: true },
  });
  console.log(`アカウント: ${advertiser?.name}`);
  console.log(`appeal: ${advertiser?.appeal?.name}`);
  console.log(`pixelId: ${advertiser?.pixelId}`);

  // 2e. V2の全アカウント処理対象を確認
  console.log('\n--- 2e. V2が処理する全アカウント（Appeal設定あり）---');
  const allAdvertisers = await prisma.advertiser.findMany({
    where: { appealId: { not: null } },
    include: { appeal: true },
  });
  for (const adv of allAdvertisers) {
    console.log(`  ${adv.name} (${adv.tiktokAdvertiserId}) | appeal: ${adv.appeal?.name} | pixel: ${adv.pixelId || 'なし'}`);
  }

  // 2f. V2が今日実行されたか（GitHub Actions or cron）
  console.log('\n--- 2f. 今日のV2実行ログ（全アカウント）---');
  const todayAllSnaps = await prisma.hourlyOptimizationSnapshot.findMany({
    where: { executionTime: { gte: todayStart } },
    orderBy: { executionTime: 'asc' },
  });
  const execTimes = [...new Set(todayAllSnaps.map(s => s.executionTime.toISOString().substring(0, 16)))];
  console.log(`今日のV2実行回数: ${execTimes.length}回`);
  for (const t of execTimes) {
    const count = todayAllSnaps.filter(s => s.executionTime.toISOString().substring(0, 16) === t).length;
    console.log(`  ${t} | ${count}件の広告を処理`);
  }

  // 2g. CR01207の広告が配信ステータスで、V2の対象条件を満たしているか
  console.log('\n--- 2g. CR01207 の配信ステータス詳細 ---');
  // V2はoperation_status=ENABLEの広告のみ対象
  const campResp = await tiktokGet('/v1.3/campaign/get/', {
    advertiser_id: targetAdvId,
    filtering: JSON.stringify({ campaign_ids: ['1862060201804930'] }),
    fields: JSON.stringify(['campaign_id', 'campaign_name', 'operation_status', 'secondary_status']),
    page_size: '10',
  });
  for (const c of campResp.data?.list || []) {
    console.log(`  キャンペーン: ${c.operation_status} / ${c.secondary_status}`);
  }

  const agResp2 = await tiktokGet('/v1.3/smart_plus/adgroup/get/', {
    advertiser_id: targetAdvId,
    adgroup_ids: JSON.stringify(['1862060201804946']),
  });
  for (const ag of agResp2.data?.list || []) {
    console.log(`  広告グループ: ${ag.operation_status} | budget_mode: ${ag.budget_mode} | budget: ${ag.budget}`);
    console.log(`  deep_funnel: ${ag.deep_funnel_toggle} | deep_action: ${ag.deep_external_action}`);
    console.log(`  optimization_event: ${ag.optimization_event}`);
    console.log(`  targeting: ${ag.targeting_optimization_mode}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); });
