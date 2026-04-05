/**
 * APIレポートのデバッグ - なぜ0が返るのか
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const API = 'https://business-api.tiktok.com/open_api';

async function main() {
  const AI_1 = '7468288053866561553';

  // トークンをDB経由で取得
  const adv = await prisma.advertiser.findUnique({
    where: { tiktokAdvertiserId: AI_1 },
    include: { oauthTokens: true },
  });
  if (!adv || !adv.oauthTokens[0]) { console.log('トークンなし'); return; }
  const token = adv.oauthTokens[0].accessToken;
  console.log(`Token (先頭20文字): ${token.substring(0, 20)}...`);

  // OAuthTokenテーブルのadvertiserIdフィールド確認
  const directToken = await prisma.oAuthToken.findUnique({ where: { advertiserId: AI_1 } });
  console.log(`Direct lookup: ${directToken ? 'found' : 'NOT FOUND'}`);

  const allTokens = await prisma.oAuthToken.findMany({ take: 3 });
  console.log(`全トークン (最初3件):`, allTokens.map(t => ({ advertiserId: t.advertiserId, tokenPrefix: t.accessToken.substring(0, 15) })));

  // テスト1: AUCTION_CAMPAIGN + stat_time_day（前回成功したパターン）
  const url1 = `${API}/v1.3/report/integrated/get/?` + new URLSearchParams({
    advertiser_id: AI_1,
    report_type: 'BASIC',
    dimensions: JSON.stringify(["stat_time_day"]),
    data_level: 'AUCTION_CAMPAIGN',
    start_date: '2026-03-12',
    end_date: '2026-03-18',
    metrics: JSON.stringify(["spend", "conversion"]),
    page_size: '30',
  });
  const resp1 = await fetch(url1, { headers: { 'Access-Token': token } });
  const data1 = await resp1.json() as any;
  console.log(`\nテスト1 (AUCTION_CAMPAIGN + stat_time_day): code=${data1.code}, rows=${data1.data?.list?.length || 0}`);
  if (data1.data?.list?.length > 0) {
    console.log('  Sample:', JSON.stringify(data1.data.list[0]));
  }

  // テスト2: AUCTION_AD + ad_id
  const url2 = `${API}/v1.3/report/integrated/get/?` + new URLSearchParams({
    advertiser_id: AI_1,
    report_type: 'BASIC',
    dimensions: JSON.stringify(["ad_id"]),
    data_level: 'AUCTION_AD',
    start_date: '2026-03-12',
    end_date: '2026-03-18',
    metrics: JSON.stringify(["spend", "conversion"]),
    page_size: '30',
  });
  const resp2 = await fetch(url2, { headers: { 'Access-Token': token } });
  const data2 = await resp2.json() as any;
  console.log(`\nテスト2 (AUCTION_AD + ad_id): code=${data2.code}, rows=${data2.data?.list?.length || 0}, msg=${data2.message}`);
  if (data2.data?.list?.length > 0) {
    console.log('  Sample:', JSON.stringify(data2.data.list[0]));
  }

  // テスト3: campaign/get
  const url3 = `${API}/v1.3/campaign/get/?` + new URLSearchParams({
    advertiser_id: AI_1,
    page_size: '10',
    fields: JSON.stringify(["campaign_id","campaign_name","campaign_type","operation_status"]),
  });
  const resp3 = await fetch(url3, { headers: { 'Access-Token': token } });
  const data3 = await resp3.json() as any;
  console.log(`\nテスト3 (campaign/get): code=${data3.code}, total=${data3.data?.page_info?.total_number || 0}`);
  if (data3.data?.list?.length > 0) {
    for (const c of data3.data.list.slice(0, 5)) {
      console.log(`  ${c.campaign_id} | ${c.campaign_name} | type=${c.campaign_type} | ${c.operation_status}`);
    }
  }

  // テスト4: ad/get
  const url4 = `${API}/v1.3/ad/get/?` + new URLSearchParams({
    advertiser_id: AI_1,
    page_size: '5',
    fields: JSON.stringify(["ad_id","ad_name","primary_status"]),
  });
  const resp4 = await fetch(url4, { headers: { 'Access-Token': token } });
  const data4 = await resp4.json() as any;
  console.log(`\nテスト4 (ad/get): code=${data4.code}, total=${data4.data?.page_info?.total_number || 0}`);
  if (data4.data?.list?.length > 0) {
    for (const a of data4.data.list.slice(0, 5)) {
      console.log(`  ${a.ad_id} | ${a.ad_name} | ${a.primary_status}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
