import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });
import { PrismaClient } from '@prisma/client';

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';
const prisma = new PrismaClient();

async function tiktokGet(ep: string, params: Record<string, any>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const r = await fetch(`${BASE}${ep}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return r.json();
}

async function main() {
  const accs = [
    { id: '7523128243466551303', name: 'AI_2' },
    { id: '7468288053866561553', name: 'AI_1' },
  ];

  // 1. キャンペーンを探す
  console.log('=== CR01207 停止原因調査 ===\n');

  for (const acc of accs) {
    let page = 1;
    while (true) {
      const resp = await tiktokGet('/v1.3/campaign/get/', {
        advertiser_id: acc.id, page_size: '100', page: String(page),
        fields: JSON.stringify(['campaign_id', 'campaign_name', 'operation_status', 'secondary_status']),
      });
      if (resp.code !== 0) break;
      for (const c of resp.data?.list || []) {
        if (c.campaign_name?.includes('01207')) {
          console.log(`キャンペーン発見: ${acc.name}`);
          console.log(`  ID: ${c.campaign_id}`);
          console.log(`  名前: ${c.campaign_name}`);
          console.log(`  status: ${c.operation_status}`);
          console.log(`  secondary: ${c.secondary_status}`);

          // Smart+広告グループの状態
          const agResp = await tiktokGet('/v1.3/smart_plus/adgroup/get/', {
            advertiser_id: acc.id,
          });
          for (const ag of agResp.data?.list || []) {
            if (ag.campaign_id === c.campaign_id) {
              console.log(`\n  広告グループ: ${ag.adgroup_id}`);
              console.log(`  budget: ¥${ag.budget}`);
              console.log(`  status: ${ag.operation_status}`);
              console.log(`  targeting: ${ag.targeting_optimization_mode}`);
              console.log(`  deep_funnel: ${ag.deep_funnel_toggle}`);
            }
          }

          // Smart+広告の状態
          const adResp = await tiktokGet('/v1.3/smart_plus/ad/get/', {
            advertiser_id: acc.id,
            fields: JSON.stringify(['smart_plus_ad_id', 'ad_name', 'campaign_id', 'operation_status', 'creative_list']),
          });
          for (const ad of adResp.data?.list || []) {
            if (ad.campaign_id === c.campaign_id) {
              console.log(`\n  広告: ${ad.smart_plus_ad_id}`);
              console.log(`  ad_name: ${ad.ad_name}`);
              console.log(`  status: ${ad.operation_status}`);
              console.log(`  CR数: ${ad.creative_list?.length || 0}本`);
            }
          }

          // V2のスナップショット
          const snapshots = await prisma.hourlyOptimizationSnapshot.findMany({
            where: {
              OR: [
                { adName: { contains: '01207' } },
                { adId: { in: (adResp.data?.list || []).filter((a: any) => a.campaign_id === c.campaign_id).map((a: any) => String(a.smart_plus_ad_id)) } },
              ],
            },
            orderBy: { executionTime: 'desc' },
            take: 20,
          });

          if (snapshots.length > 0) {
            console.log('\n  V2スナップショット:');
            for (const s of snapshots) {
              console.log(`  ${s.executionTime.toISOString()} | ${s.action} | CV:${s.todayCVCount} CPA:${s.todayCPA} budget:${s.dailyBudget} new:${s.newBudget} | ${s.reason}`);
            }
          } else {
            console.log('\n  V2スナップショット: なし');
          }

          // 通常広告APIでも確認（V2はこちらで停止する場合がある）
          const normalAdResp = await tiktokGet('/v1.3/ad/get/', {
            advertiser_id: acc.id,
            fields: JSON.stringify(['ad_id', 'ad_name', 'campaign_id', 'operation_status', 'secondary_status']),
            filtering: JSON.stringify({ campaign_ids: [c.campaign_id] }),
          });
          for (const ad of normalAdResp.data?.list || []) {
            console.log(`\n  通常API広告: ${ad.ad_id}`);
            console.log(`  status: ${ad.operation_status} / ${ad.secondary_status}`);
          }
        }
      }
      if ((resp.data?.list || []).length < 100) break;
      page++;
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); });
