/**
 * 通常配信の広告別7日間メトリクスを取得（filteringなしで全広告）
 * + Smart+が本当にimp=0なのか確認
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';

async function fetchJson(url: string, token: string) {
  const resp = await fetch(url, { headers: { 'Access-Token': token } });
  return resp.json() as Promise<any>;
}

// 対象アカウント
const ACCOUNTS = [
  { name: 'AI_1', id: '7468288053866561553', appeal: 'AI', targetCPA: 3024 },
  { name: 'AI_2', id: '7523128243466551303', appeal: 'AI', targetCPA: 3024 },
  { name: 'AI_3', id: '7543540647266074641', appeal: 'AI', targetCPA: 3024 },
  { name: 'AI_4', id: '7580666710525493255', appeal: 'AI', targetCPA: 3024 },
  { name: 'SP1', id: '7474920444831875080', appeal: 'セミナー', targetCPA: 5000 },
  { name: 'SP2', id: '7592868952431362066', appeal: 'セミナー', targetCPA: 5000 },
  { name: 'SNS_1', id: '7247073333517238273', appeal: 'SNS', targetCPA: 3000 },
  { name: 'SNS_2', id: '7543540100849156112', appeal: 'SNS', targetCPA: 3000 },
  { name: 'SNS_3', id: '7543540381615800337', appeal: 'SNS', targetCPA: 3000 },
];

async function main() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yesterday = new Date(jst.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const sevenDaysAgo = new Date(jst.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  console.log(`期間: ${sevenDaysAgo} 〜 ${yesterday}\n`);

  for (const acct of ACCOUNTS) {
    const tokenRow = await prisma.oAuthToken.findUnique({ where: { advertiserId: acct.id } });
    if (!tokenRow) { console.log(`[${acct.name}] トークンなし\n`); continue; }
    const token = tokenRow.accessToken;

    console.log(`\n${'='.repeat(70)}`);
    console.log(`[${acct.name}] (${acct.appeal}導線) 目標CPA: ¥${acct.targetCPA}`);
    console.log(`${'='.repeat(70)}`);

    // 1. 通常配信: 広告レベルレポート（filteringなし）
    try {
      const url = `${TIKTOK_API_BASE}/v1.3/report/integrated/get/?` + new URLSearchParams({
        advertiser_id: acct.id,
        report_type: 'BASIC',
        dimensions: JSON.stringify(["ad_id"]),
        data_level: 'AUCTION_AD',
        start_date: sevenDaysAgo,
        end_date: yesterday,
        metrics: JSON.stringify(["spend", "conversion", "cpa", "impressions", "clicks"]),
        page_size: '200',
      });
      const data = await fetchJson(url, token);
      const rows = data.data?.list || [];

      // 広告名を取得
      const adIds = rows.map((r: any) => r.dimensions?.ad_id).filter(Boolean);
      let adNameMap = new Map<string, { name: string; url: string }>();
      if (adIds.length > 0) {
        for (let i = 0; i < adIds.length; i += 100) {
          const batch = adIds.slice(i, i + 100);
          const adUrl = `${TIKTOK_API_BASE}/v1.3/ad/get/?` + new URLSearchParams({
            advertiser_id: acct.id,
            filtering: JSON.stringify({ ad_ids: batch }),
            fields: JSON.stringify(["ad_id", "ad_name", "landing_page_url"]),
            page_size: '100',
          });
          const adData = await fetchJson(adUrl, token);
          for (const ad of adData.data?.list || []) {
            adNameMap.set(ad.ad_id, { name: ad.ad_name, url: ad.landing_page_url || '' });
          }
        }
      }

      const ads = rows.map((r: any) => {
        const adId = r.dimensions?.ad_id;
        const detail = adNameMap.get(adId);
        return {
          adId,
          adName: detail?.name || '不明',
          lpUrl: detail?.url || '',
          spend: parseFloat(r.metrics?.spend || '0'),
          cv: parseInt(r.metrics?.conversion || '0'),
          cpa: parseFloat(r.metrics?.cpa || '0'),
          imp: parseInt(r.metrics?.impressions || '0'),
        };
      }).filter((a: any) => a.spend > 0).sort((a: any, b: any) => b.cv - a.cv);

      const totalSpend = ads.reduce((s: number, a: any) => s + a.spend, 0);
      const totalCV = ads.reduce((s: number, a: any) => s + a.cv, 0);
      const avgCPA = totalCV > 0 ? Math.round(totalSpend / totalCV) : 0;

      console.log(`\n[通常配信] ${ads.length}本配信中 | 7日計: ¥${Math.round(totalSpend).toLocaleString()} / ${totalCV}CV / CPA ¥${avgCPA.toLocaleString()}`);

      if (ads.length > 0) {
        // 勝ちCR（CPA目標以下 & CV2以上）
        const winners = ads.filter((a: any) => a.cv >= 2 && a.cpa <= acct.targetCPA);
        if (winners.length > 0) {
          console.log(`  ★勝ちCR (CPA≤¥${acct.targetCPA} & CV≥2):`);
          for (const ad of winners) {
            console.log(`    「${ad.adName}」 ad_id:${ad.adId}`);
            console.log(`      ¥${Math.round(ad.spend).toLocaleString()} / ${ad.cv}CV / CPA ¥${Math.round(ad.cpa).toLocaleString()}`);
          }
        }

        // 負けCR（CPA目標の2倍超 or CV0で¥3000以上消化）
        const losers = ads.filter((a: any) => (a.cv > 0 && a.cpa > acct.targetCPA * 2) || (a.cv === 0 && a.spend >= 3000));
        if (losers.length > 0) {
          console.log(`  ✕負けCR (停止候補):`);
          for (const ad of losers.slice(0, 8)) {
            console.log(`    「${ad.adName}」 ad_id:${ad.adId}`);
            console.log(`      ¥${Math.round(ad.spend).toLocaleString()} / ${ad.cv}CV / CPA ¥${ad.cv > 0 ? Math.round(ad.cpa).toLocaleString() : '∞'}`);
          }
          if (losers.length > 8) console.log(`    ...他${losers.length - 8}本`);
        }
      }
    } catch (e: any) {
      console.log(`  通常配信レポートエラー: ${e.message}`);
    }

    // 2. Smart+: smart_plus/report/get で取得（もしエンドポイントがあれば）
    //    なければキャンペーンレベルで
    try {
      // まずキャンペーン一覧
      const campUrl = `${TIKTOK_API_BASE}/v1.3/campaign/get/?` + new URLSearchParams({
        advertiser_id: acct.id,
        page_size: '200',
        fields: JSON.stringify(["campaign_id","campaign_name","campaign_type","operation_status"]),
      });
      const campData = await fetchJson(campUrl, token);
      const allCamps = campData.data?.list || [];
      const smartPlusCamps = allCamps.filter((c: any) => c.campaign_type === 'SMART_PLUS' && c.operation_status === 'ENABLE');
      const regularCamps = allCamps.filter((c: any) => c.campaign_type !== 'SMART_PLUS' && c.operation_status === 'ENABLE');

      // Smart+キャンペーンIDでレポート取得
      if (smartPlusCamps.length > 0) {
        const spIds = smartPlusCamps.map((c: any) => c.campaign_id);
        const reportUrl = `${TIKTOK_API_BASE}/v1.3/report/integrated/get/?` + new URLSearchParams({
          advertiser_id: acct.id,
          report_type: 'BASIC',
          dimensions: JSON.stringify(["campaign_id"]),
          data_level: 'AUCTION_CAMPAIGN',
          start_date: sevenDaysAgo,
          end_date: yesterday,
          metrics: JSON.stringify(["spend", "conversion", "cpa", "impressions"]),
          filtering: JSON.stringify({ campaign_ids: spIds }),
          page_size: '200',
        });
        const reportData = await fetchJson(reportUrl, token);
        const rows = reportData.data?.list || [];

        const campNameMap = new Map<string, string>();
        for (const c of smartPlusCamps) campNameMap.set(c.campaign_id, c.campaign_name);

        let spTotalSpend = 0, spTotalCV = 0;
        const spResults = rows.map((r: any) => {
          const spend = parseFloat(r.metrics?.spend || '0');
          const cv = parseInt(r.metrics?.conversion || '0');
          spTotalSpend += spend;
          spTotalCV += cv;
          return {
            campaignId: r.dimensions?.campaign_id,
            name: campNameMap.get(r.dimensions?.campaign_id) || '不明',
            spend, cv,
            cpa: parseFloat(r.metrics?.cpa || '0'),
            imp: parseInt(r.metrics?.impressions || '0'),
          };
        }).filter((r: any) => r.spend > 0).sort((a: any, b: any) => b.cv - a.cv);

        const spAvgCPA = spTotalCV > 0 ? Math.round(spTotalSpend / spTotalCV) : 0;
        console.log(`\n[Smart+] ENABLEキャンペーン${smartPlusCamps.length}本 | 7日計: ¥${Math.round(spTotalSpend).toLocaleString()} / ${spTotalCV}CV / CPA ¥${spAvgCPA.toLocaleString()}`);

        if (spResults.length > 0) {
          console.log(`  配信実績あり: ${spResults.length}本`);
          for (const r of spResults.slice(0, 8)) {
            const marker = r.cv > 0 && r.cpa <= acct.targetCPA ? '★' : (r.cv === 0 || r.cpa > acct.targetCPA * 2 ? '✕' : '△');
            console.log(`    ${marker}「${r.name}」 ¥${Math.round(r.spend).toLocaleString()} / ${r.cv}CV / CPA ¥${r.cv > 0 ? Math.round(r.cpa).toLocaleString() : '∞'}`);
          }
          if (spResults.length > 8) console.log(`    ...他${spResults.length - 8}本`);
        }

        const noSpendCount = smartPlusCamps.length - spResults.length;
        if (noSpendCount > 0) {
          console.log(`  配信0（imp/spend=0）: ${noSpendCount}本 ← 問題`);
        }
      } else {
        console.log(`\n[Smart+] ENABLEキャンペーンなし`);
      }
    } catch (e: any) {
      console.log(`  Smart+レポートエラー: ${e.message}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
