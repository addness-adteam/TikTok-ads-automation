/**
 * Smart+広告からCR番号を検索（ad/getで見つからないCR用）
 * npx tsx apps/backend/check-smartplus-ads.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

// 見つからなかったCR
const MISSING = ['LP1-CR01144', 'LP1-CR00192', 'LP1-CR01156', 'LP1-CR01159',
  'LP2-CR00577', 'LP2-CR00568', 'LP2-CR00563', 'LP2-CR00574', 'LP2-CR00468', 'LP2-CR00008'];

const ACCOUNTS = [
  { id: '7468288053866561553', name: 'AI_1' },
  { id: '7523128243466551303', name: 'AI_2' },
  { id: '7543540647266074641', name: 'AI_3' },
  { id: '7580666710525493255', name: 'AI_4' },
  { id: '7474920444831875080', name: 'SP1' },
  { id: '7592868952431362066', name: 'SP2' },
  { id: '7616545514662051858', name: 'SP3' },
];

async function tiktokGet(endpoint: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

function jstDateStr(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')}`;
}

async function main() {
  const now = new Date();
  const endDate = jstDateStr(now);
  const startDate = jstDateStr(new Date(now.getTime() - 7 * 86400000));

  for (const account of ACCOUNTS) {
    // Smart+キャンペーンを取得
    let page = 1;
    const smartPlusAdIds: string[] = [];
    while (true) {
      const resp = await tiktokGet('/v1.3/smart_plus/campaign/get/', {
        advertiser_id: account.id,
        page_size: '100',
        page: String(page),
      });
      if (resp.code !== 0) break;
      const list = resp.data?.list || [];
      for (const c of list) {
        if (c.smart_plus_ad_id) smartPlusAdIds.push(c.smart_plus_ad_id);
      }
      if (list.length < 100) break;
      page++;
    }
    if (smartPlusAdIds.length === 0) continue;

    // Smart+素材レポートで素材名を取得
    for (const spAdId of smartPlusAdIds) {
      const resp = await tiktokGet('/v1.3/smart_plus/material_report/overview/', {
        advertiser_id: account.id,
        smart_plus_ad_id: spAdId,
        dimensions: JSON.stringify(['smart_plus_ad_id', 'main_material_id']),
        metrics: JSON.stringify(['spend', 'material_name']),
        start_date: startDate,
        end_date: endDate,
        page_size: '100',
      });
      if (resp.code !== 0) continue;
      const list = resp.data?.list || [];
      for (const row of list) {
        const materialName = row.metrics?.material_name || row.dimensions?.material_name || '';
        const spend = parseFloat(row.metrics?.spend || '0');
        const materialId = row.dimensions?.main_material_id || '';
        // CRが含まれるか確認
        const nameUpper = materialName.toUpperCase();
        for (const cr of MISSING) {
          if (nameUpper.includes(cr.split('-')[1])) { // CR番号部分でマッチ
            console.log(`${account.name} SP広告${spAdId}:`);
            console.log(`  ${cr} → material: ${materialName} [id=${materialId}] spend=¥${Math.round(spend)}`);
          }
        }
      }
    }
  }

  // DBからも探す（Smart+広告はad_nameにCR番号が入ってないケースがある）
  console.log('\n--- DB検索 ---');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  for (const cr of MISSING) {
    const crNum = cr.split('-')[1]; // CR01144
    const ads = await prisma.ad.findMany({
      where: { name: { contains: crNum } },
      select: { tiktokId: true, name: true, adGroup: { select: { campaign: { select: { advertiser: { select: { name: true } } } } } } },
    });
    if (ads.length > 0) {
      for (const ad of ads) {
        console.log(`  ${cr} → DB: ${ad.name} [tiktokId=${ad.tiktokId}] acct=${ad.adGroup?.campaign?.advertiser?.name}`);
      }
    }
  }

  await prisma.$disconnect();
  console.log('\n--- 完了 ---');
}
main().catch(console.error);
