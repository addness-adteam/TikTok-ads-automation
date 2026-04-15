import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const ADV = '7468288053866561553';
const AG_ID = '1861971960337537';

async function main() {
  // さっき作ったやつをもう一度通常APIで確認（fields無指定で全フィールド）
  const resp = await fetch(`https://business-api.tiktok.com/open_api/v1.3/adgroup/get/?advertiser_id=${ADV}&filtering={"adgroup_ids":["${AG_ID}"]}`, {
    headers: { 'Access-Token': ACCESS_TOKEN },
  });
  const data = await resp.json();
  const ag = data.data?.list?.[0];
  if (ag) {
    console.log('budget:', ag.budget);
    console.log('budget_mode:', ag.budget_mode);
    console.log('daily_budget:', ag.daily_budget);
    // 全フィールドからbudget関連を抽出
    for (const [k, v] of Object.entries(ag)) {
      if (k.includes('budget') || k.includes('Budget')) {
        console.log(`  ${k}: ${v}`);
      }
    }
  } else {
    console.log('通常API: 見つからない');
    console.log('code:', data.code, 'msg:', data.message);
  }

  // ¥300,000のやつと比較
  const resp2 = await fetch(`https://business-api.tiktok.com/open_api/v1.3/adgroup/get/?advertiser_id=${ADV}&filtering={"adgroup_ids":["1861321121627378"]}`, {
    headers: { 'Access-Token': ACCESS_TOKEN },
  });
  const data2 = await resp2.json();
  const ag2 = data2.data?.list?.[0];
  if (ag2) {
    console.log('\n¥300,000のやつ:');
    console.log('budget:', ag2.budget);
    console.log('budget_mode:', ag2.budget_mode);
  }
}
main();
