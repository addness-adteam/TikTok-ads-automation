/**
 * 行動可能データ収集 v4
 * - アカウントレベルの日別メトリクス（動作確認済みのAPIパターン）
 * - Smart+広告一覧（名前・動画数・ステータス）
 * - 個別キャンペーンのレポート（filtering指定で取得を試みる）
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const API = 'https://business-api.tiktok.com/open_api';

async function fetchJson(url: string, token: string) {
  const resp = await fetch(url, { headers: { 'Access-Token': token } });
  return resp.json() as Promise<any>;
}

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
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const yesterday = new Date(jst.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const sevenDaysAgo = new Date(jst.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  console.log(`期間: ${sevenDaysAgo} 〜 ${yesterday}\n`);

  let grandTotal = { spend: 0, cv: 0 };

  for (const acct of ACCOUNTS) {
    const adv = await prisma.advertiser.findUnique({
      where: { tiktokAdvertiserId: acct.id },
      include: { oauthTokens: true },
    });
    if (!adv || !adv.oauthTokens[0]) continue;
    const token = adv.oauthTokens[0].accessToken;

    console.log(`${'='.repeat(70)}`);
    console.log(`[${acct.name}] (${acct.appeal}導線) 目標CPA: ¥${acct.targetCPA.toLocaleString()}`);
    console.log(`${'='.repeat(70)}`);

    // 1. アカウントレベル日別メトリクス（これは確実に動く）
    const dailyData = await fetchJson(
      `${API}/v1.3/report/integrated/get/?` + new URLSearchParams({
        advertiser_id: acct.id,
        report_type: 'BASIC',
        dimensions: JSON.stringify(["stat_time_day"]),
        data_level: 'AUCTION_CAMPAIGN',
        start_date: sevenDaysAgo, end_date: yesterday,
        metrics: JSON.stringify(["spend", "conversion", "cpa"]),
        page_size: '30',
      }), token);
    const dailyRows = dailyData.data?.list || [];
    let totalSpend = 0, totalCV = 0;
    const days: string[] = [];
    for (const r of dailyRows.sort((a: any, b: any) => a.dimensions.stat_time_day.localeCompare(b.dimensions.stat_time_day))) {
      const spend = parseFloat(r.metrics?.spend || '0');
      const cv = parseInt(r.metrics?.conversion || '0');
      totalSpend += spend;
      totalCV += cv;
      days.push(`${r.dimensions.stat_time_day.slice(5, 10)}:${cv}CV/¥${Math.round(spend / 1000)}k`);
    }
    const avgCPA = totalCV > 0 ? Math.round(totalSpend / totalCV) : 0;
    console.log(`  7日計: ¥${Math.round(totalSpend).toLocaleString()} / ${totalCV}CV / CPA ¥${avgCPA.toLocaleString()} | 日平均: ${(totalCV / 7).toFixed(1)}CV`);
    console.log(`  日別: ${days.join(' | ')}`);
    grandTotal.spend += totalSpend;
    grandTotal.cv += totalCV;

    // 2. Smart+広告一覧（名前・動画数）
    const spData = await fetchJson(
      `${API}/v1.3/smart_plus/ad/get/?` + new URLSearchParams({
        advertiser_id: acct.id, page_size: '100',
      }), token);
    const spAds = spData.data?.list || [];
    const spEnable = spAds.filter((a: any) => a.operation_status === 'ENABLE');

    if (spAds.length > 0) {
      console.log(`\n  Smart+広告: 全${spAds.length}本 / ENABLE: ${spEnable.length}本`);
      if (spEnable.length > 0) {
        console.log(`  ENABLEのSmart+:`);
        for (const ad of spEnable) {
          const videoCount = (ad.creative_list || []).length;
          console.log(`    「${ad.ad_name}」 動画${videoCount}本 | ad_id: ${ad.smart_plus_ad_id || ad.ad_id} | campaign: ${ad.campaign_id}`);
        }
      }
    }

    // 3. ENABLEキャンペーンごとにレポート取得（filtering指定）
    // まずENABLEキャンペーンを取得
    const campData = await fetchJson(
      `${API}/v1.3/campaign/get/?` + new URLSearchParams({
        advertiser_id: acct.id, page_size: '200',
        fields: JSON.stringify(["campaign_id","campaign_name","operation_status"]),
        filtering: JSON.stringify({ operation_status: "ENABLE" }),
      }), token);
    const enableCamps = campData.data?.list || [];

    if (enableCamps.length > 0) {
      // 個別キャンペーンIDでフィルタしてレポート
      const campIds = enableCamps.map((c: any) => c.campaign_id);
      const campNameMap = new Map<string, string>();
      for (const c of enableCamps) campNameMap.set(c.campaign_id, c.campaign_name);

      // バッチでレポート取得（campaign_idフィルタ + stat_time_day集計 → campaignごとに分解はできないが、
      // 個別1キャンペーンずつフィルタして取得する）
      console.log(`\n  ENABLEキャンペーン: ${enableCamps.length}本 — 個別メトリクス取得中...`);

      type CampResult = { id: string; name: string; spend: number; cv: number; cpa: number };
      const campResults: CampResult[] = [];

      // 最大20件のキャンペーンを個別取得（レート制限考慮）
      for (const camp of enableCamps.slice(0, 30)) {
        try {
          const campReport = await fetchJson(
            `${API}/v1.3/report/integrated/get/?` + new URLSearchParams({
              advertiser_id: acct.id,
              report_type: 'BASIC',
              dimensions: JSON.stringify(["stat_time_day"]),
              data_level: 'AUCTION_CAMPAIGN',
              start_date: sevenDaysAgo, end_date: yesterday,
              metrics: JSON.stringify(["spend", "conversion"]),
              filtering: JSON.stringify({ campaign_ids: [camp.campaign_id] }),
              page_size: '10',
            }), token);
          const rows = campReport.data?.list || [];
          let cSpend = 0, cCV = 0;
          for (const r of rows) {
            cSpend += parseFloat(r.metrics?.spend || '0');
            cCV += parseInt(r.metrics?.conversion || '0');
          }
          if (cSpend > 0 || cCV > 0) {
            campResults.push({
              id: camp.campaign_id,
              name: camp.campaign_name,
              spend: cSpend, cv: cCV,
              cpa: cCV > 0 ? Math.round(cSpend / cCV) : 0,
            });
          }
        } catch {}
        await new Promise(r => setTimeout(r, 50)); // rate limit
      }

      campResults.sort((a, b) => b.cv - a.cv);

      // 勝ちCR
      const winners = campResults.filter(c => c.cv >= 2 && c.cpa <= acct.targetCPA);
      if (winners.length > 0) {
        console.log(`\n  ★ 勝ちCR（CPA ≤ ¥${acct.targetCPA.toLocaleString()} & CV ≥ 2）:`);
        for (const c of winners) {
          console.log(`    「${c.name}」 campaign_id: ${c.id}`);
          console.log(`      ¥${Math.round(c.spend).toLocaleString()} / ${c.cv}CV / CPA ¥${c.cpa.toLocaleString()}`);
        }
      }

      // 負けCR
      const losers = campResults.filter(c => (c.cv > 0 && c.cpa > acct.targetCPA * 2) || (c.cv === 0 && c.spend >= 3000));
      if (losers.length > 0) {
        console.log(`\n  ✕ 負けCR（停止候補）:`);
        for (const c of losers.sort((a, b) => b.spend - a.spend).slice(0, 8)) {
          console.log(`    「${c.name}」 campaign_id: ${c.id}`);
          console.log(`      ¥${Math.round(c.spend).toLocaleString()} / ${c.cv}CV / CPA ¥${c.cv > 0 ? c.cpa.toLocaleString() : '∞'}`);
        }
      }
    }

    console.log('');
  }

  console.log(`\n${'#'.repeat(70)}`);
  console.log(`全体: ¥${Math.round(grandTotal.spend).toLocaleString()} / ${grandTotal.cv}CV / CPA ¥${grandTotal.cv > 0 ? Math.round(grandTotal.spend / grandTotal.cv).toLocaleString() : '-'}`);
  console.log(`日平均: ${(grandTotal.cv / 7).toFixed(1)}CV/日`);
  console.log(`目標: 100CV/日 → 差分: +${Math.max(0, 100 - Math.round(grandTotal.cv / 7))}CV/日`);
  console.log(`${'#'.repeat(70)}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
