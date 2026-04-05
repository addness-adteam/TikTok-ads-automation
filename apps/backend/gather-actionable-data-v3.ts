/**
 * 全アカウントのキャンペーンレベル7日間メトリクス
 * キャンペーン名 ≒ 広告名なので、これで勝ちCR/負けCRを特定
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

  const allWinners: { acct: string; appeal: string; name: string; cv: number; cpa: number; campId: string }[] = [];
  const allLosers: { acct: string; appeal: string; name: string; spend: number; cv: number; cpa: number; campId: string }[] = [];

  for (const acct of ACCOUNTS) {
    const adv = await prisma.advertiser.findUnique({
      where: { tiktokAdvertiserId: acct.id },
      include: { oauthTokens: true },
    });
    if (!adv || !adv.oauthTokens[0]) { console.log(`[${acct.name}] トークンなし`); continue; }
    const token = adv.oauthTokens[0].accessToken;

    // キャンペーン名マップ
    const campNames = new Map<string, { name: string; status: string }>();
    let page = 1;
    while (true) {
      const campData = await fetchJson(
        `${API}/v1.3/campaign/get/?` + new URLSearchParams({
          advertiser_id: acct.id, page_size: '200', page: String(page),
          fields: JSON.stringify(["campaign_id","campaign_name","operation_status"]),
        }), token);
      for (const c of campData.data?.list || []) {
        campNames.set(c.campaign_id, { name: c.campaign_name, status: c.operation_status });
      }
      if ((campData.data?.page_info?.page || 1) * 200 >= (campData.data?.page_info?.total_number || 0)) break;
      page++;
    }

    // キャンペーンレベルレポート（7日間）
    const reportData = await fetchJson(
      `${API}/v1.3/report/integrated/get/?` + new URLSearchParams({
        advertiser_id: acct.id,
        report_type: 'BASIC',
        dimensions: JSON.stringify(["campaign_id"]),
        data_level: 'AUCTION_CAMPAIGN',
        start_date: sevenDaysAgo, end_date: yesterday,
        metrics: JSON.stringify(["spend", "conversion", "cpa", "impressions"]),
        page_size: '500',
      }), token);
    const rows = reportData.data?.list || [];

    const campaigns = rows.map((r: any) => {
      const campId = r.dimensions?.campaign_id;
      const info = campNames.get(campId);
      return {
        campId,
        name: info?.name || '不明',
        status: info?.status || '不明',
        spend: parseFloat(r.metrics?.spend || '0'),
        cv: parseInt(r.metrics?.conversion || '0'),
        cpa: parseFloat(r.metrics?.cpa || '0'),
        imp: parseInt(r.metrics?.impressions || '0'),
      };
    }).filter((c: any) => c.spend > 0).sort((a: any, b: any) => b.cv - a.cv);

    const totalSpend = campaigns.reduce((s: number, c: any) => s + c.spend, 0);
    const totalCV = campaigns.reduce((s: number, c: any) => s + c.cv, 0);
    const enableCount = [...campNames.values()].filter(c => c.status === 'ENABLE').length;

    console.log(`${'='.repeat(70)}`);
    console.log(`[${acct.name}] (${acct.appeal}導線) 目標CPA: ¥${acct.targetCPA.toLocaleString()}`);
    console.log(`ENABLE: ${enableCount}本 | 配信実績: ${campaigns.length}本`);
    console.log(`7日計: ¥${Math.round(totalSpend).toLocaleString()} / ${totalCV}CV / CPA ¥${totalCV > 0 ? Math.round(totalSpend / totalCV).toLocaleString() : '-'} | 日平均: ${(totalCV / 7).toFixed(1)}CV`);
    console.log(`${'='.repeat(70)}`);

    // 勝ちCR
    const winners = campaigns.filter((c: any) => c.cv >= 2 && c.cpa <= acct.targetCPA);
    if (winners.length > 0) {
      console.log(`\n  ★ 勝ちCR（CPA ≤ ¥${acct.targetCPA.toLocaleString()} & CV ≥ 2）: ${winners.length}本`);
      for (const c of winners) {
        console.log(`    「${c.name}」`);
        console.log(`      campaign_id: ${c.campId} | ¥${Math.round(c.spend).toLocaleString()} | ${c.cv}CV | CPA ¥${Math.round(c.cpa).toLocaleString()} | ${c.status}`);
        allWinners.push({ acct: acct.name, appeal: acct.appeal, name: c.name, cv: c.cv, cpa: Math.round(c.cpa), campId: c.campId });
      }
    } else {
      console.log(`\n  ★ 勝ちCR: なし`);
    }

    // 準勝ちCR（CPA目標〜1.5倍、CV2以上）
    const nearWinners = campaigns.filter((c: any) => c.cv >= 2 && c.cpa > acct.targetCPA && c.cpa <= acct.targetCPA * 1.5);
    if (nearWinners.length > 0) {
      console.log(`\n  △ 準勝ちCR（CPA ¥${acct.targetCPA.toLocaleString()}〜¥${(acct.targetCPA * 1.5).toLocaleString()}）: ${nearWinners.length}本`);
      for (const c of nearWinners.slice(0, 5)) {
        console.log(`    「${c.name}」`);
        console.log(`      campaign_id: ${c.campId} | ¥${Math.round(c.spend).toLocaleString()} | ${c.cv}CV | CPA ¥${Math.round(c.cpa).toLocaleString()}`);
      }
    }

    // 負けCR（CPA目標の2倍超 or CV0で¥5000以上消化）
    const losers = campaigns.filter((c: any) => (c.cv > 0 && c.cpa > acct.targetCPA * 2) || (c.cv === 0 && c.spend >= 5000));
    if (losers.length > 0) {
      console.log(`\n  ✕ 負けCR（停止候補）: ${losers.length}本 | 無駄消化: ¥${Math.round(losers.reduce((s: number, c: any) => s + c.spend, 0)).toLocaleString()}`);
      for (const c of losers.sort((a: any, b: any) => b.spend - a.spend).slice(0, 8)) {
        console.log(`    「${c.name}」`);
        console.log(`      campaign_id: ${c.campId} | ¥${Math.round(c.spend).toLocaleString()} | ${c.cv}CV | CPA ¥${c.cv > 0 ? Math.round(c.cpa).toLocaleString() : '∞'} | ${c.status}`);
        allLosers.push({ acct: acct.name, appeal: acct.appeal, name: c.name, spend: Math.round(c.spend), cv: c.cv, cpa: Math.round(c.cpa), campId: c.campId });
      }
      if (losers.length > 8) console.log(`    ...他${losers.length - 8}本`);
    }

    console.log('');
  }

  // 横展開候補サマリー
  console.log(`\n${'#'.repeat(70)}`);
  console.log(`### 横展開候補（勝ちCR）###`);
  console.log(`${'#'.repeat(70)}`);
  const byAppeal = new Map<string, typeof allWinners>();
  for (const w of allWinners) {
    const list = byAppeal.get(w.appeal) || [];
    list.push(w);
    byAppeal.set(w.appeal, list);
  }
  for (const [appeal, winners] of byAppeal) {
    console.log(`\n[${appeal}導線] 勝ちCR ${winners.length}本:`);
    const sorted = winners.sort((a, b) => b.cv - a.cv);
    for (const w of sorted.slice(0, 15)) {
      console.log(`  ${w.acct} | 「${w.name}」 | ${w.cv}CV | CPA ¥${w.cpa.toLocaleString()}`);
    }
  }

  console.log(`\n${'#'.repeat(70)}`);
  console.log(`### 即停止候補（上位の無駄消化）###`);
  console.log(`${'#'.repeat(70)}`);
  const topLosers = allLosers.sort((a, b) => b.spend - a.spend).slice(0, 15);
  for (const l of topLosers) {
    console.log(`  ${l.acct} | 「${l.name}」 | ¥${l.spend.toLocaleString()} | ${l.cv}CV | CPA ¥${l.cv > 0 ? l.cpa.toLocaleString() : '∞'} | campaign_id: ${l.campId}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
