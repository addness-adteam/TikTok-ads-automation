/**
 * AI/セミナー導線の「集客を増やす」ためのデータ収集
 * - 勝ちCRの特定（予算引き上げ候補）
 * - 横展開候補の特定（どの広告→どのアカウント）
 * - 各アカウントの余力（出稿数、予算帯）
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const API = 'https://business-api.tiktok.com/open_api';

async function fetchJson(url: string, token: string) {
  const resp = await fetch(url, { headers: { 'Access-Token': token } });
  return resp.json() as Promise<any>;
}

const AI_ACCOUNTS = [
  { name: 'AI_1', id: '7468288053866561553' },
  { name: 'AI_2', id: '7523128243466551303' },
  { name: 'AI_3', id: '7543540647266074641' },
  { name: 'AI_4', id: '7580666710525493255' },
];
const SP_ACCOUNTS = [
  { name: 'SP1', id: '7474920444831875080' },
  { name: 'SP2', id: '7592868952431362066' },
];

async function getToken(advId: string) {
  const adv = await prisma.advertiser.findUnique({
    where: { tiktokAdvertiserId: advId },
    include: { oauthTokens: true },
  });
  return adv?.oauthTokens[0]?.accessToken || '';
}

async function getSmartPlusAds(advId: string, token: string) {
  const all: any[] = [];
  let page = 1;
  while (true) {
    const data = await fetchJson(
      `${API}/v1.3/smart_plus/ad/get/?` + new URLSearchParams({
        advertiser_id: advId, page_size: '100', page: String(page),
      }), token);
    all.push(...(data.data?.list || []));
    if ((data.data?.page_info?.page || 1) * 100 >= (data.data?.page_info?.total_number || 0)) break;
    page++;
  }
  return all;
}

async function getAdGroupBudgets(advId: string, token: string, adgroupIds: string[]) {
  if (adgroupIds.length === 0) return new Map<string, number>();
  const map = new Map<string, number>();
  for (let i = 0; i < adgroupIds.length; i += 100) {
    const batch = adgroupIds.slice(i, i + 100);
    const data = await fetchJson(
      `${API}/v1.3/adgroup/get/?` + new URLSearchParams({
        advertiser_id: advId, page_size: '100',
        filtering: JSON.stringify({ adgroup_ids: batch }),
        fields: JSON.stringify(["adgroup_id", "budget", "daily_budget", "operation_status"]),
      }), token);
    for (const ag of data.data?.list || []) {
      map.set(ag.adgroup_id, ag.budget || ag.daily_budget || 0);
    }
  }
  return map;
}

async function main() {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const yesterday = new Date(jst.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const sevenDaysAgo = new Date(jst.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // ========== AI導線 ==========
  console.log('########## AI導線 ##########\n');

  for (const acct of AI_ACCOUNTS) {
    const token = await getToken(acct.id);
    if (!token) continue;

    console.log(`\n--- [${acct.name}] ---`);

    // Smart+広告一覧
    const spAds = await getSmartPlusAds(acct.id, token);
    const enableSP = spAds.filter((a: any) => a.operation_status === 'ENABLE');
    const disabledSP = spAds.filter((a: any) => a.operation_status !== 'ENABLE');

    console.log(`  Smart+: 全${spAds.length}本 / ENABLE ${enableSP.length}本 / 停止中 ${disabledSP.length}本`);

    // ENABLEのSmart+詳細（予算・動画数）
    if (enableSP.length > 0) {
      // 広告グループの予算を取得
      const agIds = enableSP.map((a: any) => a.adgroup_id).filter(Boolean);
      const budgets = await getAdGroupBudgets(acct.id, token, agIds);

      console.log(`\n  ENABLE Smart+広告:`);
      for (const ad of enableSP) {
        const videoCount = (ad.creative_list || []).length;
        const budget = budgets.get(ad.adgroup_id) || 0;
        const videoIds = (ad.creative_list || []).map((c: any) => c?.creative_info?.video_info?.video_id).filter(Boolean);
        console.log(`    「${ad.ad_name}」`);
        console.log(`      ad_id: ${ad.smart_plus_ad_id || ad.ad_id} | 動画${videoCount}本 | 日予算: ¥${budget.toLocaleString()} | campaign: ${ad.campaign_id}`);
      }
    }

    // 停止中で成績良さそうなもの（動画数多い＝実績ありの可能性）
    const goodDisabled = disabledSP
      .filter((a: any) => (a.creative_list || []).length >= 3)
      .sort((a: any, b: any) => (b.creative_list || []).length - (a.creative_list || []).length);
    if (goodDisabled.length > 0) {
      console.log(`\n  停止中で動画3本以上（再ENABLE候補）: ${goodDisabled.length}本`);
      for (const ad of goodDisabled.slice(0, 5)) {
        const videoCount = (ad.creative_list || []).length;
        console.log(`    「${ad.ad_name}」 動画${videoCount}本 | ad_id: ${ad.smart_plus_ad_id || ad.ad_id}`);
      }
      if (goodDisabled.length > 5) console.log(`    ...他${goodDisabled.length - 5}本`);
    }

    // 通常配信の広告数
    try {
      const adData = await fetchJson(
        `${API}/v1.3/ad/get/?` + new URLSearchParams({
          advertiser_id: acct.id, page_size: '1',
          filtering: JSON.stringify({ primary_status: "STATUS_DELIVERY_OK" }),
          fields: JSON.stringify(["ad_id"]),
        }), token);
      const totalRegular = adData.data?.page_info?.total_number || 0;
      console.log(`\n  通常配信ENABLE: ${totalRegular}本`);
    } catch {}

    // アカウントレベルの日別CV（どの日にどれだけ取れてるか）
    try {
      const reportData = await fetchJson(
        `${API}/v1.3/report/integrated/get/?` + new URLSearchParams({
          advertiser_id: acct.id,
          report_type: 'BASIC',
          dimensions: JSON.stringify(["stat_time_day"]),
          data_level: 'AUCTION_CAMPAIGN',
          start_date: sevenDaysAgo, end_date: yesterday,
          metrics: JSON.stringify(["spend", "conversion"]),
          page_size: '10',
        }), token);
      const rows = (reportData.data?.list || []).sort((a: any, b: any) =>
        a.dimensions.stat_time_day.localeCompare(b.dimensions.stat_time_day));
      let total = { spend: 0, cv: 0 };
      for (const r of rows) {
        total.spend += parseFloat(r.metrics?.spend || '0');
        total.cv += parseInt(r.metrics?.conversion || '0');
      }
      console.log(`  7日間: ¥${Math.round(total.spend).toLocaleString()} / ${total.cv}CV | 日平均: ${(total.cv / 7).toFixed(1)}CV`);
    } catch {}
  }

  // ========== セミナー導線 ==========
  console.log('\n\n########## セミナー導線 ##########\n');

  for (const acct of SP_ACCOUNTS) {
    const token = await getToken(acct.id);
    if (!token) continue;

    console.log(`\n--- [${acct.name}] ---`);

    const spAds = await getSmartPlusAds(acct.id, token);
    const enableSP = spAds.filter((a: any) => a.operation_status === 'ENABLE');
    const disabledSP = spAds.filter((a: any) => a.operation_status !== 'ENABLE');

    console.log(`  Smart+: 全${spAds.length}本 / ENABLE ${enableSP.length}本 / 停止中 ${disabledSP.length}本`);

    if (enableSP.length > 0) {
      const agIds = enableSP.map((a: any) => a.adgroup_id).filter(Boolean);
      const budgets = await getAdGroupBudgets(acct.id, token, agIds);

      console.log(`\n  ENABLE Smart+広告:`);
      for (const ad of enableSP) {
        const videoCount = (ad.creative_list || []).length;
        const budget = budgets.get(ad.adgroup_id) || 0;
        console.log(`    「${ad.ad_name}」`);
        console.log(`      ad_id: ${ad.smart_plus_ad_id || ad.ad_id} | 動画${videoCount}本 | 日予算: ¥${budget.toLocaleString()} | campaign: ${ad.campaign_id}`);
      }
    }

    const goodDisabled = disabledSP
      .filter((a: any) => (a.creative_list || []).length >= 3)
      .sort((a: any, b: any) => (b.creative_list || []).length - (a.creative_list || []).length);
    if (goodDisabled.length > 0) {
      console.log(`\n  停止中で動画3本以上（再ENABLE候補）: ${goodDisabled.length}本`);
      for (const ad of goodDisabled.slice(0, 8)) {
        const videoCount = (ad.creative_list || []).length;
        console.log(`    「${ad.ad_name}」 動画${videoCount}本 | ad_id: ${ad.smart_plus_ad_id || ad.ad_id}`);
      }
      if (goodDisabled.length > 8) console.log(`    ...他${goodDisabled.length - 8}本`);
    }

    try {
      const reportData = await fetchJson(
        `${API}/v1.3/report/integrated/get/?` + new URLSearchParams({
          advertiser_id: acct.id,
          report_type: 'BASIC',
          dimensions: JSON.stringify(["stat_time_day"]),
          data_level: 'AUCTION_CAMPAIGN',
          start_date: sevenDaysAgo, end_date: yesterday,
          metrics: JSON.stringify(["spend", "conversion"]),
          page_size: '10',
        }), token);
      const rows = (reportData.data?.list || []);
      let total = { spend: 0, cv: 0 };
      for (const r of rows) {
        total.spend += parseFloat(r.metrics?.spend || '0');
        total.cv += parseInt(r.metrics?.conversion || '0');
      }
      console.log(`  7日間: ¥${Math.round(total.spend).toLocaleString()} / ${total.cv}CV | 日平均: ${(total.cv / 7).toFixed(1)}CV`);
    } catch {}
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
