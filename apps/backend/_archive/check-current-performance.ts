/**
 * 全アカウントの直近7日間パフォーマンス確認
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';

async function main() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = jst.toISOString().split('T')[0];
  const sevenDaysAgo = new Date(jst.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const yesterday = new Date(jst.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  console.log(`=== 全アカウント パフォーマンス (${sevenDaysAgo} 〜 ${yesterday}) ===\n`);

  const advertisers = await prisma.advertiser.findMany({
    include: { oauthTokens: true, appeal: true },
  });

  let totalSpend = 0;
  let totalConversions = 0;
  let totalDailyConversions = 0;

  for (const adv of advertisers) {
    const token = adv.oauthTokens[0];
    if (!token) continue;

    try {
      // 7日間の集計
      const resp = await fetch(
        `${TIKTOK_API_BASE}/v1.3/report/integrated/get/?advertiser_id=${adv.tiktokAdvertiserId}&report_type=BASIC&dimensions=${encodeURIComponent(JSON.stringify(["stat_time_day"]))}&data_level=AUCTION_ADVERTISER&start_date=${sevenDaysAgo}&end_date=${yesterday}&metrics=${encodeURIComponent(JSON.stringify(["spend","conversion","cpa","impressions","clicks","ctr","cpc"]))}`,
        { headers: { 'Access-Token': token.accessToken } },
      );
      const data = await resp.json() as any;
      const rows = data.data?.list || [];

      let weekSpend = 0;
      let weekConversions = 0;
      let yesterdayConversions = 0;
      let yesterdaySpend = 0;

      const dailyData: any[] = [];
      for (const row of rows) {
        const date = row.dimensions?.stat_time_day;
        const metrics = row.metrics || {};
        const spend = parseFloat(metrics.spend || '0');
        const conv = parseInt(metrics.conversion || '0');
        weekSpend += spend;
        weekConversions += conv;
        dailyData.push({ date, spend, conv });

        if (date === yesterday) {
          yesterdayConversions = conv;
          yesterdaySpend = spend;
        }
      }

      if (weekSpend > 0 || weekConversions > 0) {
        const cpa = weekConversions > 0 ? Math.round(weekSpend / weekConversions) : 0;
        const appealName = adv.appeal?.name || '不明';
        console.log(`[${adv.name}] (${appealName}導線)`);
        console.log(`  7日間: ¥${Math.round(weekSpend).toLocaleString()} / ${weekConversions}CV / CPA ¥${cpa.toLocaleString()}`);
        console.log(`  昨日(${yesterday}): ¥${Math.round(yesterdaySpend).toLocaleString()} / ${yesterdayConversions}CV`);
        console.log(`  日別: ${dailyData.map(d => `${d.date?.slice(5)}:${d.conv}CV`).join(' | ')}`);
        console.log('');

        totalSpend += weekSpend;
        totalConversions += weekConversions;
        totalDailyConversions += yesterdayConversions;
      }
    } catch (e: any) {
      console.log(`[${adv.name}] エラー: ${e.message}\n`);
    }
  }

  console.log('=== 全体サマリー ===');
  console.log(`7日間合計: ¥${Math.round(totalSpend).toLocaleString()} / ${totalConversions}CV`);
  console.log(`7日間の平均CPA: ¥${totalConversions > 0 ? Math.round(totalSpend / totalConversions).toLocaleString() : '-'}`);
  console.log(`7日間の日平均CV: ${(totalConversions / 7).toFixed(1)}人/日`);
  console.log(`昨日のCV合計: ${totalDailyConversions}人`);
  console.log(`目標までの差分: ${Math.max(0, 100 - Math.round(totalConversions / 7))}人/日`);

  // アクティブ広告数を確認
  console.log('\n=== アクティブ広告数 ===');
  for (const adv of advertisers) {
    const token = adv.oauthTokens[0];
    if (!token) continue;
    try {
      // Smart+
      const spResp = await fetch(
        `${TIKTOK_API_BASE}/v1.3/smart_plus/ad/get/?advertiser_id=${adv.tiktokAdvertiserId}&page_size=100&filtering=${encodeURIComponent(JSON.stringify({operation_status: "ENABLE"}))}`,
        { headers: { 'Access-Token': token.accessToken } },
      );
      const spData = await spResp.json() as any;
      const spCount = spData.data?.list?.length || 0;

      // 通常
      const adResp = await fetch(
        `${TIKTOK_API_BASE}/v1.3/ad/get/?advertiser_id=${adv.tiktokAdvertiserId}&page_size=1&filtering=${encodeURIComponent(JSON.stringify({primary_status: "STATUS_DELIVERY_OK"}))}`,
        { headers: { 'Access-Token': token.accessToken } },
      );
      const adData = await adResp.json() as any;
      const adCount = adData.data?.page_info?.total_number || 0;

      if (spCount > 0 || adCount > 0) {
        console.log(`  [${adv.name}] Smart+: ${spCount}本 / 通常: ${adCount}本`);
      }
    } catch {}
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
