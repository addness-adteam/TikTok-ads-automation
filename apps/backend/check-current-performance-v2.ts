/**
 * 全アカウントの直近パフォーマンス（DBメトリクス + API広告レベル）
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';

async function main() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yesterday = new Date(jst.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const sevenDaysAgo = new Date(jst.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const threeDaysAgo = new Date(jst.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  console.log(`=== 全アカウント パフォーマンス ===`);
  console.log(`期間: ${sevenDaysAgo} 〜 ${yesterday}\n`);

  const advertisers = await prisma.advertiser.findMany({
    include: { oauthTokens: true, appeal: true },
  });

  let grandTotalSpend7d = 0;
  let grandTotalCV7d = 0;
  let grandTotalSpendYesterday = 0;
  let grandTotalCVYesterday = 0;

  for (const adv of advertisers) {
    const token = adv.oauthTokens[0];
    if (!token) continue;

    try {
      // アカウントレベルレポート（BASIC, AUCTION_ADVERTISER → これが空ならAUCTION_AD）
      const resp = await fetch(
        `${TIKTOK_API_BASE}/v1.3/report/integrated/get/?` + new URLSearchParams({
          advertiser_id: adv.tiktokAdvertiserId,
          report_type: 'BASIC',
          dimensions: JSON.stringify(["stat_time_day"]),
          data_level: 'AUCTION_AD',
          start_date: sevenDaysAgo,
          end_date: yesterday,
          metrics: JSON.stringify(["spend", "conversion", "cpa", "impressions", "clicks"]),
          page_size: '30',
        }),
        { headers: { 'Access-Token': token.accessToken } },
      );
      const data = await resp.json() as any;
      const rows = data.data?.list || [];

      let weekSpend = 0;
      let weekCV = 0;
      let ydSpend = 0;
      let ydCV = 0;
      const dailyData: { date: string; spend: number; cv: number }[] = [];

      for (const row of rows) {
        const date = row.dimensions?.stat_time_day;
        const spend = parseFloat(row.metrics?.spend || '0');
        const cv = parseInt(row.metrics?.conversion || '0');
        weekSpend += spend;
        weekCV += cv;
        dailyData.push({ date, spend, cv });
        if (date === yesterday) { ydSpend = spend; ydCV = cv; }
      }

      // Smart+レポートも取得
      const spResp = await fetch(
        `${TIKTOK_API_BASE}/v1.3/report/integrated/get/?` + new URLSearchParams({
          advertiser_id: adv.tiktokAdvertiserId,
          report_type: 'BASIC',
          dimensions: JSON.stringify(["stat_time_day"]),
          data_level: 'AUCTION_CAMPAIGN',
          start_date: sevenDaysAgo,
          end_date: yesterday,
          metrics: JSON.stringify(["spend", "conversion"]),
          filtering: JSON.stringify({ campaign_type: ["SMART_PLUS"] }),
          page_size: '30',
        }),
        { headers: { 'Access-Token': token.accessToken } },
      );
      const spData = await spResp.json() as any;
      const spRows = spData.data?.list || [];

      let spWeekSpend = 0;
      let spWeekCV = 0;
      for (const row of spRows) {
        spWeekSpend += parseFloat(row.metrics?.spend || '0');
        spWeekCV += parseInt(row.metrics?.conversion || '0');
      }

      const combinedSpend = Math.max(weekSpend, spWeekSpend);
      const combinedCV = Math.max(weekCV, spWeekCV);

      if (combinedSpend > 0 || combinedCV > 0) {
        const cpa = combinedCV > 0 ? Math.round(combinedSpend / combinedCV) : 0;
        const appealName = adv.appeal?.name || '不明';
        console.log(`[${adv.name}] (${appealName}導線)`);
        console.log(`  7日間: ¥${Math.round(combinedSpend).toLocaleString()} / ${combinedCV}CV / CPA ¥${cpa.toLocaleString()}`);
        if (dailyData.length > 0) {
          console.log(`  日別CV: ${dailyData.sort((a, b) => a.date.localeCompare(b.date)).map(d => `${d.date?.slice(5)}:${d.cv}`).join(' | ')}`);
        }
        console.log('');

        grandTotalSpend7d += combinedSpend;
        grandTotalCV7d += combinedCV;
        grandTotalCVYesterday += ydCV;
        grandTotalSpendYesterday += ydSpend;
      }
    } catch (e: any) {
      console.log(`[${adv.name}] エラー: ${e.message}\n`);
    }
  }

  console.log('========================================');
  console.log('=== 全体サマリー ===');
  console.log(`7日間合計: ¥${Math.round(grandTotalSpend7d).toLocaleString()} / ${grandTotalCV7d}CV`);
  console.log(`7日間 平均CPA: ¥${grandTotalCV7d > 0 ? Math.round(grandTotalSpend7d / grandTotalCV7d).toLocaleString() : '-'}`);
  console.log(`7日間 日平均CV: ${(grandTotalCV7d / 7).toFixed(1)}人/日`);
  console.log(`昨日(${yesterday}): ¥${Math.round(grandTotalSpendYesterday).toLocaleString()} / ${grandTotalCVYesterday}CV`);
  console.log(`\n目標: 100人/日`);
  console.log(`現状からの差分: +${Math.max(0, 100 - Math.round(grandTotalCV7d / 7))}人/日 必要`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
