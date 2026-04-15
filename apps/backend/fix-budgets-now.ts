/**
 * 通常adgroup APIで¥30,000以上になっている配信中Smart+広告グループを
 * Smart+ API側の予算に合わせて修正する（緊急修正）
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';

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

async function get(ep: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const r = await fetch(`${BASE}${ep}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return r.json();
}

async function post(ep: string, body: any): Promise<any> {
  const r = await fetch(`${BASE}${ep}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Access-Token': ACCESS_TOKEN },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function main() {
  console.log('=== Smart+ 予算乖離の緊急修正 ===\n');

  let fixed = 0, skipped = 0, errors = 0;

  for (const acc of ACCOUNTS) {
    // 配信中の広告グループを通常APIで取得
    let page = 1;
    while (true) {
      const resp = await get('/v1.3/adgroup/get/', {
        advertiser_id: acc.id,
        filtering: JSON.stringify({ status: 'ADGROUP_STATUS_DELIVERY_OK' }),
        fields: JSON.stringify(['adgroup_id', 'adgroup_name', 'budget']),
        page_size: '100', page: String(page),
      });
      if (resp.code !== 0) break;
      const list = resp.data?.list || [];

      for (const ag of list) {
        if (ag.budget < 30000) continue;

        // Smart+ APIで正しい予算を確認
        const spResp = await get('/v1.3/smart_plus/adgroup/get/', {
          advertiser_id: acc.id, adgroup_ids: JSON.stringify([ag.adgroup_id]),
        });
        const spBudget = spResp.data?.list?.[0]?.budget;
        if (!spBudget || spBudget >= 30000) {
          // Smart+側も高い or Smart+ではない → スキップ
          skipped++;
          continue;
        }

        // 乖離あり → 通常APIでSmart+側の予算に合わせる
        console.log(`${acc.name} | ag:${ag.adgroup_id} | 通常:¥${ag.budget.toLocaleString()} → ¥${spBudget.toLocaleString()} | ${ag.adgroup_name}`);

        const updateResp = await post('/v1.3/adgroup/update/', {
          advertiser_id: acc.id,
          adgroup_id: ag.adgroup_id,
          budget: spBudget,
        });

        if (updateResp.code === 0) {
          console.log(`  ✅ 修正完了`);
          fixed++;
        } else {
          console.log(`  ❌ ${updateResp.message}`);
          errors++;
        }
      }

      if (list.length < 100) break;
      page++;
    }
  }

  console.log(`\n完了: 修正${fixed}件, スキップ${skipped}件, エラー${errors}件`);
}

main().catch(console.error);
