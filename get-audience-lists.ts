import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, 'apps/backend/.env') });

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

async function tiktokGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

const ACCOUNTS: Record<string, string> = {
  'AI_1': '7468288053866561553',
  'AI_2': '7523128243466551303',
  'AI_3': '7543540647266074641',
  'AI_4': '7580666710525493255',
};

async function main() {
  for (const [name, advId] of Object.entries(ACCOUNTS)) {
    console.log(`\n=== ${name} (${advId}) ===`);

    // カスタムオーディエンス一覧
    const data = await tiktokGet('/v1.3/dmp/custom_audience/list/', {
      advertiser_id: advId,
      page_size: '100',
    });

    if (data.code === 0 && data.data?.list?.length) {
      console.log(`  オーディエンス数: ${data.data.list.length}`);
      for (const aud of data.data.list) {
        console.log(`  ID: ${aud.audience_id} | name: "${aud.name}" | type: ${aud.audience_type} | size: ${aud.audience_size || '?'} | status: ${aud.status}`);
      }
    } else {
      console.log(`  オーディエンス: ${data.message || 'なし'}`);
      console.log(`  レスポンス: ${JSON.stringify(data).substring(0, 300)}`);
    }
  }
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
