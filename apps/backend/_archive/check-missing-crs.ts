/**
 * 個別予約があるが広告が見つからなかったCRを全アカウントから探す
 * npx tsx apps/backend/check-missing-crs.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

const MISSING_CRS = ['CR01144', 'CR00032', 'CR00192', 'CR01156', 'CR01159',
  'CR00577', 'CR00568', 'CR00563', 'CR00574', 'CR00468'];

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

async function tiktokGet(endpoint: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

async function main() {
  for (const account of ACCOUNTS) {
    let page = 1;
    const found: string[] = [];
    while (true) {
      const resp = await tiktokGet('/v1.3/ad/get/', {
        advertiser_id: account.id,
        fields: JSON.stringify(['ad_id', 'ad_name', 'operation_status']),
        page_size: '100',
        page: String(page),
      });
      if (resp.code !== 0) break;
      const list = resp.data?.list || [];
      for (const ad of list) {
        const name = (ad.ad_name || '').toUpperCase();
        for (const cr of MISSING_CRS) {
          if (name.includes(cr)) {
            found.push(`  ${cr} → ${ad.ad_name} [${ad.operation_status}] id=${ad.ad_id}`);
          }
        }
      }
      if (list.length < 100) break;
      page++;
    }
    if (found.length > 0) {
      console.log(`${account.name}:`);
      found.forEach(f => console.log(f));
    }
  }
  console.log('\n--- 完了 ---');
}
main().catch(console.error);
