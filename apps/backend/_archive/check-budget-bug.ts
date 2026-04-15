import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';

async function get(ep: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const r = await fetch(`${BASE}${ep}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return r.json();
}

const ACCOUNTS = [
  { id: '7468288053866561553', name: 'AI_1' },
  { id: '7523128243466551303', name: 'AI_2' },
  { id: '7543540647266074641', name: 'AI_3' },
  { id: '7580666710525493255', name: 'AI_4' },
  { id: '7247073333517238273', name: 'SNS1' },
  { id: '7543540100849156112', name: 'SNS2' },
  { id: '7543540381615800337', name: 'SNS3' },
  { id: '7474920444831875080', name: 'SP1' },
  { id: '7592868952431362066', name: 'SP2' },
  { id: '7616545514662051858', name: 'SP3' },
];

async function main() {
  const prisma = new PrismaClient();

  console.log('=== 全アカウント: 日予算¥30,000以上の配信中広告グループを検出 ===\n');

  let totalAbnormal = 0;

  for (const acc of ACCOUNTS) {
    // 通常adgroup APIで配信中の広告グループを取得
    let page = 1;
    const abnormals: any[] = [];
    while (true) {
      const resp = await get('/v1.3/adgroup/get/', {
        advertiser_id: acc.id,
        filtering: JSON.stringify({ status: 'ADGROUP_STATUS_DELIVERY_OK' }),
        fields: JSON.stringify(['adgroup_id', 'adgroup_name', 'budget', 'budget_mode', 'campaign_id']),
        page_size: '100',
        page: String(page),
      });
      if (resp.code !== 0) break;
      for (const ag of resp.data?.list || []) {
        if (ag.budget >= 30000) {
          abnormals.push(ag);
        }
      }
      if ((resp.data?.list || []).length < 100) break;
      page++;
    }

    if (abnormals.length > 0) {
      console.log(`【${acc.name}】${abnormals.length}件が¥30,000以上`);
      for (const ag of abnormals.sort((a: any, b: any) => b.budget - a.budget)) {
        // Smart+ APIでの予算も確認
        const spResp = await get('/v1.3/smart_plus/adgroup/get/', {
          advertiser_id: acc.id,
          adgroup_ids: JSON.stringify([ag.adgroup_id]),
        });
        const spBudget = spResp.data?.list?.[0]?.budget;

        // DBの予算
        const dbAg = await prisma.adGroup.findFirst({
          where: { tiktokId: ag.adgroup_id },
          select: { budget: true },
        });

        console.log(`  ag:${ag.adgroup_id} | 通常API:¥${ag.budget.toLocaleString()} | SP_API:¥${spBudget?.toLocaleString() || '?'} | DB:¥${dbAg?.budget?.toLocaleString() || '?'} | ${ag.adgroup_name}`);
      }
      totalAbnormal += abnormals.length;
      console.log('');
    }
  }

  console.log(`\n合計: ${totalAbnormal}件\n`);

  // CR01190の詳細
  console.log('=== CR01190 詳細 ===');
  const logs = await prisma.changeLog.findMany({
    where: { entityId: { in: await prisma.adGroup.findMany({ where: { ads: { some: { name: { contains: 'CR01190' } } } }, select: { tiktokId: true } }).then(r => r.map(a => a.tiktokId)) } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  for (const l of logs) {
    const jst = new Date(l.createdAt.getTime() + 9 * 3600000);
    const before = l.beforeData as any;
    const after = l.afterData as any;
    console.log(`${jst.toISOString().slice(0, 16)} | ${l.action} | ¥${before?.budget ?? '?'} → ¥${after?.budget ?? '?'} | ${l.reason || ''}`);
  }

  await prisma.$disconnect();
}
main().catch(console.error);
