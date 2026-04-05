/**
 * 行動可能なTodo用データ収集
 * - 各アカウントの勝ちCR/負けCR（広告名・CPA・CV付き）
 * - ピクセル/イベント設定
 * - 横展開候補の特定
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';

async function fetchJson(url: string, token: string) {
  const resp = await fetch(url, { headers: { 'Access-Token': token } });
  return resp.json() as Promise<any>;
}

async function getAdLevelReport(advId: string, token: string, startDate: string, endDate: string) {
  const url = `${TIKTOK_API_BASE}/v1.3/report/integrated/get/?` + new URLSearchParams({
    advertiser_id: advId,
    report_type: 'BASIC',
    dimensions: JSON.stringify(["ad_id"]),
    data_level: 'AUCTION_AD',
    start_date: startDate,
    end_date: endDate,
    metrics: JSON.stringify(["spend", "conversion", "cpa", "impressions", "clicks", "ctr"]),
    page_size: '200',
    filtering: JSON.stringify({ primary_status: "STATUS_DELIVERY_OK" }),
  });
  const data = await fetchJson(url, token);
  return data.data?.list || [];
}

async function getAdDetails(advId: string, token: string, adIds: string[]) {
  if (adIds.length === 0) return [];
  const batchSize = 100;
  const results: any[] = [];
  for (let i = 0; i < adIds.length; i += batchSize) {
    const batch = adIds.slice(i, i + batchSize);
    const url = `${TIKTOK_API_BASE}/v1.3/ad/get/?` + new URLSearchParams({
      advertiser_id: advId,
      filtering: JSON.stringify({ ad_ids: batch }),
      fields: JSON.stringify(["ad_id", "ad_name", "video_id", "landing_page_url", "operation_status", "primary_status"]),
      page_size: '100',
    });
    const data = await fetchJson(url, token);
    results.push(...(data.data?.list || []));
  }
  return results;
}

async function getSmartPlusAdsWithMetrics(advId: string, token: string, startDate: string, endDate: string) {
  // Smart+広告一覧
  const listUrl = `${TIKTOK_API_BASE}/v1.3/smart_plus/ad/get/?` + new URLSearchParams({
    advertiser_id: advId,
    page_size: '100',
  });
  const listData = await fetchJson(listUrl, token);
  const ads = listData.data?.list || [];

  // Smart+キャンペーンレポート
  const reportUrl = `${TIKTOK_API_BASE}/v1.3/report/integrated/get/?` + new URLSearchParams({
    advertiser_id: advId,
    report_type: 'BASIC',
    dimensions: JSON.stringify(["campaign_id"]),
    data_level: 'AUCTION_CAMPAIGN',
    start_date: startDate,
    end_date: endDate,
    metrics: JSON.stringify(["spend", "conversion", "cpa", "impressions"]),
    page_size: '200',
  });
  const reportData = await fetchJson(reportUrl, token);
  const reports = reportData.data?.list || [];
  const reportMap = new Map<string, any>();
  for (const r of reports) {
    reportMap.set(r.dimensions?.campaign_id, r.metrics);
  }

  return ads.map((ad: any) => {
    const campId = ad.campaign_id;
    const metrics = reportMap.get(campId) || {};
    return {
      adName: ad.ad_name,
      adId: ad.smart_plus_ad_id || ad.ad_id,
      campaignId: campId,
      status: ad.operation_status,
      videoCount: (ad.creative_list || []).length,
      spend: parseFloat(metrics.spend || '0'),
      conversion: parseInt(metrics.conversion || '0'),
      cpa: parseFloat(metrics.cpa || '0'),
      impressions: parseInt(metrics.impressions || '0'),
    };
  });
}

async function getPixelInfo(advId: string, token: string) {
  try {
    const url = `${TIKTOK_API_BASE}/v1.3/pixel/list/?advertiser_id=${advId}&page_size=10`;
    const data = await fetchJson(url, token);
    return data.data?.pixels || [];
  } catch { return []; }
}

async function main() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yesterday = new Date(jst.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const sevenDaysAgo = new Date(jst.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const advertisers = await prisma.advertiser.findMany({
    include: { oauthTokens: true, appeal: true },
    orderBy: { name: 'asc' },
  });

  for (const adv of advertisers) {
    const token = adv.oauthTokens[0];
    if (!token) continue;
    const advId = adv.tiktokAdvertiserId;
    const appealName = adv.appeal?.name || '不明';

    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${adv.name}] (${appealName}導線) advId: ${advId}`);
    console.log(`pixelId: ${adv.pixelId || 'なし'} | identityId: ${adv.identityId || 'なし'}`);
    console.log(`${'='.repeat(80)}`);

    // ピクセル情報
    const pixels = await getPixelInfo(advId, token.accessToken);
    if (pixels.length > 0) {
      console.log(`\nピクセル:`);
      for (const p of pixels) {
        console.log(`  ${p.pixel_id} (${p.pixel_name}) status: ${p.status}`);
      }
    }

    // 通常配信の広告レポート
    const adReports = await getAdLevelReport(advId, token.accessToken, sevenDaysAgo, yesterday);
    const adIds = adReports.map((r: any) => r.dimensions?.ad_id).filter(Boolean);
    const adDetails = await getAdDetails(advId, token.accessToken, adIds);
    const adDetailMap = new Map<string, any>();
    for (const ad of adDetails) adDetailMap.set(ad.ad_id, ad);

    // 通常広告の成績
    const regularAds = adReports.map((r: any) => {
      const detail = adDetailMap.get(r.dimensions?.ad_id);
      return {
        adId: r.dimensions?.ad_id,
        adName: detail?.ad_name || '不明',
        spend: parseFloat(r.metrics?.spend || '0'),
        conversion: parseInt(r.metrics?.conversion || '0'),
        cpa: parseFloat(r.metrics?.cpa || '0'),
        impressions: parseInt(r.metrics?.impressions || '0'),
        landingPageUrl: detail?.landing_page_url || '',
        status: detail?.primary_status || '',
      };
    }).filter((a: any) => a.spend > 0).sort((a: any, b: any) => b.conversion - a.conversion);

    if (regularAds.length > 0) {
      console.log(`\n--- 通常配信 (${regularAds.length}本, 7日間) ---`);
      console.log(`  [勝ちCR] CPA良好 & CV1以上:`);
      const winners = regularAds.filter((a: any) => a.conversion >= 1 && a.cpa <= 5000);
      if (winners.length === 0) console.log(`    なし`);
      for (const ad of winners.slice(0, 10)) {
        console.log(`    ${ad.adName}`);
        console.log(`      ad_id: ${ad.adId} | ¥${Math.round(ad.spend).toLocaleString()} | ${ad.conversion}CV | CPA ¥${Math.round(ad.cpa).toLocaleString()}`);
      }

      console.log(`  [負けCR] CPA ¥5,000超 or CV0で¥5,000以上消化:`);
      const losers = regularAds.filter((a: any) => (a.cpa > 5000 && a.conversion > 0) || (a.conversion === 0 && a.spend >= 5000));
      if (losers.length === 0) console.log(`    なし`);
      for (const ad of losers.slice(0, 10)) {
        console.log(`    ${ad.adName}`);
        console.log(`      ad_id: ${ad.adId} | ¥${Math.round(ad.spend).toLocaleString()} | ${ad.conversion}CV | CPA ¥${ad.conversion > 0 ? Math.round(ad.cpa).toLocaleString() : '∞'}`);
      }
    }

    // Smart+広告の成績
    const smartPlusAds = await getSmartPlusAdsWithMetrics(advId, token.accessToken, sevenDaysAgo, yesterday);
    const activeSmartPlus = smartPlusAds.filter((a: any) => a.status === 'ENABLE');
    const spWithSpend = smartPlusAds.filter((a: any) => a.spend > 0).sort((a: any, b: any) => b.conversion - a.conversion);

    if (smartPlusAds.length > 0) {
      console.log(`\n--- Smart+ (全${smartPlusAds.length}本, ENABLE: ${activeSmartPlus.length}本) ---`);
      console.log(`  [勝ちCR] CPA良好 & CV1以上:`);
      const spWinners = spWithSpend.filter((a: any) => a.conversion >= 1 && a.cpa <= 5000);
      if (spWinners.length === 0) console.log(`    なし`);
      for (const ad of spWinners.slice(0, 10)) {
        console.log(`    ${ad.adName}`);
        console.log(`      ad_id: ${ad.adId} | ¥${Math.round(ad.spend).toLocaleString()} | ${ad.conversion}CV | CPA ¥${Math.round(ad.cpa).toLocaleString()} | 動画${ad.videoCount}本`);
      }

      console.log(`  [負けCR] CPA ¥5,000超 or CV0で¥5,000以上消化:`);
      const spLosers = spWithSpend.filter((a: any) => (a.cpa > 5000 && a.conversion > 0) || (a.conversion === 0 && a.spend >= 5000));
      if (spLosers.length === 0) console.log(`    なし`);
      for (const ad of spLosers.slice(0, 10)) {
        console.log(`    ${ad.adName}`);
        console.log(`      ad_id: ${ad.adId} | ¥${Math.round(ad.spend).toLocaleString()} | ${ad.conversion}CV | CPA ¥${ad.conversion > 0 ? Math.round(ad.cpa).toLocaleString() : '∞'} | 動画${ad.videoCount}本`);
      }

      // imp=0のENABLE広告
      const zeroImp = activeSmartPlus.filter((a: any) => a.impressions === 0 && a.spend === 0);
      if (zeroImp.length > 0) {
        console.log(`  [imp=0] ENABLEなのにインプレッション0: ${zeroImp.length}本`);
        for (const ad of zeroImp.slice(0, 5)) {
          console.log(`    ${ad.adName} (ad_id: ${ad.adId})`);
        }
        if (zeroImp.length > 5) console.log(`    ...他${zeroImp.length - 5}本`);
      }
    }
  }

  // 横展開候補サマリー
  console.log(`\n${'='.repeat(80)}`);
  console.log(`=== 横展開候補サマリー ===`);
  console.log(`${'='.repeat(80)}`);

  // AI導線の勝ちCR
  for (const adv of advertisers) {
    const token = adv.oauthTokens[0];
    if (!token) continue;
    const appealName = adv.appeal?.name || '不明';
    if (!['AI', 'SNS', 'スキルプラス'].includes(appealName)) continue;

    const advId = adv.tiktokAdvertiserId;
    const smartPlusAds = await getSmartPlusAdsWithMetrics(advId, token.accessToken, sevenDaysAgo, yesterday);
    const adReports = await getAdLevelReport(advId, token.accessToken, sevenDaysAgo, yesterday);
    const adIds = adReports.map((r: any) => r.dimensions?.ad_id).filter(Boolean);
    const adDetails = await getAdDetails(advId, token.accessToken, adIds);
    const adDetailMap = new Map<string, any>();
    for (const ad of adDetails) adDetailMap.set(ad.ad_id, ad);

    const allAds = [
      ...smartPlusAds.filter((a: any) => a.conversion >= 2 && a.cpa <= 4000).map((a: any) => ({
        ...a, type: 'Smart+',
      })),
      ...adReports.filter((r: any) => {
        const cv = parseInt(r.metrics?.conversion || '0');
        const cpa = parseFloat(r.metrics?.cpa || '0');
        return cv >= 2 && cpa <= 4000;
      }).map((r: any) => {
        const detail = adDetailMap.get(r.dimensions?.ad_id);
        return {
          adId: r.dimensions?.ad_id,
          adName: detail?.ad_name || '不明',
          spend: parseFloat(r.metrics?.spend || '0'),
          conversion: parseInt(r.metrics?.conversion || '0'),
          cpa: parseFloat(r.metrics?.cpa || '0'),
          type: '通常',
        };
      }),
    ].sort((a, b) => b.conversion - a.conversion);

    if (allAds.length > 0) {
      console.log(`\n[${adv.name}] ${appealName}導線 — 横展開候補（CV2以上 & CPA ¥4,000以下）:`);
      for (const ad of allAds.slice(0, 5)) {
        console.log(`  ${ad.adName}`);
        console.log(`    ad_id: ${ad.adId} | ${ad.type} | ${ad.conversion}CV | CPA ¥${Math.round(ad.cpa).toLocaleString()}`);
      }
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
