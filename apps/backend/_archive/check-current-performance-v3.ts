/**
 * 全アカウントの直近パフォーマンス - advertiser/info と campaign レベルで取得
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';

async function fetchJson(url: string, token: string) {
  const resp = await fetch(url, { headers: { 'Access-Token': token } });
  return resp.json() as Promise<any>;
}

async function main() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yesterday = new Date(jst.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const sevenDaysAgo = new Date(jst.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  console.log(`=== 全アカウント パフォーマンス ===`);
  console.log(`期間: ${sevenDaysAgo} 〜 ${yesterday}\n`);

  const advertisers = await prisma.advertiser.findMany({
    include: { oauthTokens: true, appeal: true },
  });

  let grandTotal7d = { spend: 0, cv: 0 };
  let grandTotalYd = { spend: 0, cv: 0 };

  for (const adv of advertisers) {
    const token = adv.oauthTokens[0];
    if (!token) continue;
    const advId = adv.tiktokAdvertiserId;

    try {
      // キャンペーン一覧を取得
      const campResp = await fetchJson(
        `${TIKTOK_API_BASE}/v1.3/campaign/get/?advertiser_id=${advId}&page_size=100&fields=${encodeURIComponent(JSON.stringify(["campaign_id","campaign_name","campaign_type","operation_status"]))}`,
        token.accessToken,
      );
      const campaigns = campResp.data?.list || [];
      const activeCampaigns = campaigns.filter((c: any) => c.operation_status === 'ENABLE');

      if (activeCampaigns.length === 0) continue;

      // キャンペーンIDリストでレポート取得
      const campaignIds = activeCampaigns.map((c: any) => c.campaign_id);

      // 7日間レポート（キャンペーンレベル、日別）
      const reportUrl = `${TIKTOK_API_BASE}/v1.3/report/integrated/get/?` + new URLSearchParams({
        advertiser_id: advId,
        report_type: 'BASIC',
        dimensions: JSON.stringify(["campaign_id", "stat_time_day"]),
        data_level: 'AUCTION_CAMPAIGN',
        start_date: sevenDaysAgo,
        end_date: yesterday,
        metrics: JSON.stringify(["spend", "conversion", "impressions"]),
        page_size: '200',
      });
      const reportData = await fetchJson(reportUrl, token.accessToken);
      const rows = reportData.data?.list || [];

      let weekSpend = 0, weekCV = 0, ydSpend = 0, ydCV = 0;
      const dailyMap = new Map<string, { spend: number; cv: number }>();

      for (const row of rows) {
        const date = row.dimensions?.stat_time_day;
        const spend = parseFloat(row.metrics?.spend || '0');
        const cv = parseInt(row.metrics?.conversion || '0');
        weekSpend += spend;
        weekCV += cv;
        if (date === yesterday) { ydSpend += spend; ydCV += cv; }

        const existing = dailyMap.get(date) || { spend: 0, cv: 0 };
        dailyMap.set(date, { spend: existing.spend + spend, cv: existing.cv + cv });
      }

      if (weekSpend > 0 || weekCV > 0) {
        const cpa = weekCV > 0 ? Math.round(weekSpend / weekCV) : 0;
        const appealName = adv.appeal?.name || '不明';
        const smartPlusCount = activeCampaigns.filter((c: any) => c.campaign_type === 'SMART_PLUS').length;
        const regularCount = activeCampaigns.length - smartPlusCount;

        console.log(`[${adv.name}] (${appealName}導線) キャンペーン: SP${smartPlusCount}/通常${regularCount}`);
        console.log(`  7日間: ¥${Math.round(weekSpend).toLocaleString()} / ${weekCV}CV / CPA ¥${cpa.toLocaleString()}`);
        console.log(`  昨日: ¥${Math.round(ydSpend).toLocaleString()} / ${ydCV}CV`);

        const sorted = [...dailyMap.entries()].sort(([a], [b]) => a.localeCompare(b));
        console.log(`  日別CV: ${sorted.map(([d, v]) => `${d.slice(5)}:${v.cv}`).join(' | ')}`);
        console.log('');

        grandTotal7d.spend += weekSpend;
        grandTotal7d.cv += weekCV;
        grandTotalYd.spend += ydSpend;
        grandTotalYd.cv += ydCV;
      }
    } catch (e: any) {
      console.log(`[${adv.name}] エラー: ${e.message}\n`);
    }
  }

  console.log('========================================');
  console.log('=== 全体サマリー ===');
  console.log(`7日間合計: ¥${Math.round(grandTotal7d.spend).toLocaleString()} / ${grandTotal7d.cv}CV`);
  console.log(`7日間 平均CPA: ¥${grandTotal7d.cv > 0 ? Math.round(grandTotal7d.spend / grandTotal7d.cv).toLocaleString() : '-'}`);
  console.log(`7日間 日平均CV: ${(grandTotal7d.cv / 7).toFixed(1)}人/日`);
  console.log(`昨日(${yesterday}): ¥${Math.round(grandTotalYd.spend).toLocaleString()} / ${grandTotalYd.cv}CV`);
  console.log(`\n目標: 100人/日`);
  console.log(`現状からの差分: +${Math.max(0, 100 - Math.round(grandTotal7d.cv / 7))}人/日 必要`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
