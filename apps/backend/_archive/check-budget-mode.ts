import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';

async function get(ep: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (await fetch(BASE + ep + '?' + qs, { headers: { 'Access-Token': ACCESS_TOKEN } })).json();
}

// 指摘されたキャンペーン
const TARGETS = [
  // CR00631 (SNS2)
  { advId: '7543540100849156112', agId: '1861071087963282', name: 'CR00631 (SNS2)' },
  // CR01190 (AI_1)  - 広告名から探す必要あり
  { advId: '7468288053866561553', agId: '', name: 'CR01190 (AI_1)', searchName: 'CR01190' },
  // ¥300,000のやつ
  { advId: '7468288053866561553', agId: '1861321121627378', name: '260402 (AI_1)' },
  { advId: '7523128243466551303', agId: '1861474109205618', name: '260404 (AI_2)' },
];

async function main() {
  console.log('=== 指摘キャンペーンのbudget_mode確認 ===\n');

  for (const t of TARGETS) {
    let agId = t.agId;

    // agIdが空の場合は広告名から検索
    if (!agId && t.searchName) {
      let page = 1;
      while (!agId) {
        const resp = await get('/v1.3/ad/get/', {
          advertiser_id: t.advId, page_size: '100', page: String(page),
          fields: JSON.stringify(['ad_id', 'ad_name', 'adgroup_id']),
        });
        if (resp.code !== 0) break;
        for (const ad of resp.data?.list || []) {
          if (ad.ad_name?.includes(t.searchName)) { agId = ad.adgroup_id; break; }
        }
        if ((resp.data?.list || []).length < 100) break;
        page++;
      }
    }

    if (!agId) { console.log(`${t.name}: adgroup見つからず\n`); continue; }

    // 通常API
    const normalResp = await get('/v1.3/adgroup/get/', {
      advertiser_id: t.advId,
      filtering: JSON.stringify({ adgroup_ids: [agId] }),
      fields: JSON.stringify(['adgroup_id', 'adgroup_name', 'budget', 'budget_mode']),
    });
    const normal = normalResp.data?.list?.[0];

    // Smart+ API
    const spResp = await get('/v1.3/smart_plus/adgroup/get/', {
      advertiser_id: t.advId, adgroup_ids: JSON.stringify([agId]),
    });
    const sp = spResp.data?.list?.[0];

    console.log(`--- ${t.name} (ag:${agId}) ---`);
    console.log(`  通常API: budget=¥${normal?.budget?.toLocaleString() || '?'} budget_mode=${normal?.budget_mode || '?'}`);
    console.log(`  SP API:  budget=¥${sp?.budget?.toLocaleString() || '?'} budget_mode=${sp?.budget_mode || '?'}`);
    console.log('');
  }
}
main();
