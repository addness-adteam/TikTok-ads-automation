/**
 * 運用OS用メトリクス取得スクリプト
 * - オプト数: スプレッドシート（TT_オプト）から登録経路別に取得
 * - 広告費: TikTok APIから直接取得（DBのメトリクスは累計値混在の可能性があるため）
 * - 広告名のlpName → 登録経路で紐付け → 広告単位・アカウント単位・導線単位のCPA
 */
import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheetsApi = google.sheets({ version: 'v4', auth });

const TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const API_BASE = 'https://business-api.tiktok.com/open_api';

const APPEALS = [
  {
    name: 'AI',
    cvSpreadsheetId: '1FlTEktuSWOZce8h92foKoh5p8wCFFgZVM9ePqIRnUKk',
    pathPrefix: 'TikTok広告-AI-',
    targetCPA: 3024,
    accounts: [
      { name: 'AI_1', id: '7468288053866561553' },
      { name: 'AI_2', id: '7523128243466551303' },
      { name: 'AI_3', id: '7543540647266074641' },
      { name: 'AI_4', id: '7580666710525493255' },
    ],
  },
  {
    name: 'SNS',
    cvSpreadsheetId: '1JlEC8rQAM3h2E7GuUplMPrLyVdA5Q3nZ0lGneC2nZvY',
    pathPrefix: 'TikTok広告-SNS-',
    targetCPA: 1875,
    accounts: [
      { name: 'SNS_1', id: '7247073333517238273' },
      { name: 'SNS_2', id: '7543540100849156112' },
      { name: 'SNS_3', id: '7543540381615800337' },
    ],
  },
  {
    name: 'スキルプラス',
    cvSpreadsheetId: '1kfsPgNDewEdkSotjoq4pHlqD_eGhzBeGPp7u2nEFJFk',
    pathPrefix: 'TikTok広告-スキルプラス-',
    targetCPA: 5000,
    accounts: [
      { name: 'SP1', id: '7474920444831875080' },
      { name: 'SP2', id: '7592868952431362066' },
    ],
  },
];

function extractLpName(adName: string): string | null {
  const parts = adName.split('/');
  if (parts.length < 4) return null;
  return parts[parts.length - 1];
}

// --- TikTok API: 通常広告の期間合計spendをad_id別に取得 ---
async function getAdSpendFromAPI(
  advertiserId: string,
  startDate: string,
  endDate: string,
): Promise<Map<string, { spend: number; imp: number; clicks: number }>> {
  const result = new Map<string, { spend: number; imp: number; clicks: number }>();
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams();
    params.set('advertiser_id', advertiserId);
    params.set('data_level', 'AUCTION_AD');
    params.set('report_type', 'BASIC');
    params.set('dimensions', JSON.stringify(['ad_id']));
    params.set('metrics', JSON.stringify(['spend', 'impressions', 'clicks']));
    params.set('start_date', startDate);
    params.set('end_date', endDate);
    params.set('page', String(page));
    params.set('page_size', '1000');

    const resp = await fetch(`${API_BASE}/v1.3/report/integrated/get/?${params.toString()}`, {
      headers: { 'Access-Token': TOKEN },
    });
    const data = await resp.json() as any;

    if (data.code !== 0) {
      console.error(`  API error (${advertiserId}): ${data.message}`);
      break;
    }

    const list = data.data?.list || [];
    for (const r of list) {
      const adId = String(r.dimensions?.ad_id);
      const m = r.metrics || {};
      result.set(adId, {
        spend: parseFloat(m.spend || '0'),
        imp: parseInt(m.impressions || '0', 10),
        clicks: parseInt(m.clicks || '0', 10),
      });
    }

    const totalPages = Math.ceil((data.data?.page_info?.total_number || 0) / 1000);
    if (page >= totalPages || list.length === 0) {
      hasMore = false;
    } else {
      page++;
    }
  }

  return result;
}

// --- TikTok API: Smart+広告のspendをsmart_plus_ad_id別に取得 ---
async function getSmartPlusSpendFromAPI(
  advertiserId: string,
  startDate: string,
  endDate: string,
): Promise<Map<string, { spend: number; imp: number; clicks: number }>> {
  const result = new Map<string, { spend: number; imp: number; clicks: number }>();
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams();
    params.set('advertiser_id', advertiserId);
    params.set('start_date', startDate);
    params.set('end_date', endDate);
    params.set('page', String(page));
    params.set('page_size', '100');
    params.set('dimensions', JSON.stringify(['smart_plus_ad_id', 'main_material_id']));
    params.set('metrics', JSON.stringify(['spend', 'impressions', 'clicks']));

    const resp = await fetch(`${API_BASE}/v1.3/smart_plus/material_report/overview/?${params.toString()}`, {
      headers: { 'Access-Token': TOKEN },
    });
    const data = await resp.json() as any;

    if (data.code !== 0) {
      // Smart+広告がないアカウントではエラーになることがある
      break;
    }

    const list = data.data?.list || [];
    // smart_plus_ad_id別に集約（main_material_idで分かれるので合算）
    for (const r of list) {
      const adId = String(r.dimensions?.smart_plus_ad_id);
      const m = r.metrics || {};
      const existing = result.get(adId) || { spend: 0, imp: 0, clicks: 0 };
      existing.spend += parseFloat(m.spend || '0');
      existing.imp += parseInt(m.impressions || '0', 10);
      existing.clicks += parseInt(m.clicks || '0', 10);
      result.set(adId, existing);
    }

    const totalPages = Math.ceil((data.data?.page_info?.total_number || 0) / 100);
    if (page >= totalPages || list.length === 0) {
      hasMore = false;
    } else {
      page++;
    }
  }

  return result;
}

// --- スプレッドシートからオプト数を登録経路別に取得 ---
async function getOptByPath(
  spreadsheetId: string,
  startDate: string,
  endDate: string,
): Promise<Map<string, { total: number; daily: Map<string, number> }>> {
  const result = new Map<string, { total: number; daily: Map<string, number> }>();
  const response = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: 'TT_オプト!A:Z',
  });
  const rows = response.data.values;
  if (!rows || rows.length === 0) return result;

  const header = rows[0];
  let pathCol = -1, dateCol = -1;
  for (let i = 0; i < header.length; i++) {
    const h = String(header[i]).trim();
    if (['登録経路', '流入経路', 'ファネル登録経路'].includes(h)) pathCol = i;
    if (['登録日時', '登録日', 'アクション実行日時', '実行日時'].includes(h)) dateCol = i;
  }
  if (pathCol === -1 || dateCol === -1) {
    console.error(`列が見つからない: pathCol=${pathCol}, dateCol=${dateCol}`);
    return result;
  }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const path = String(row[pathCol] || '').trim();
    const dateStr = String(row[dateCol] || '').trim();
    if (!path || !dateStr) continue;
    const dateMatch = dateStr.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (!dateMatch) continue;
    const d = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;
    if (d < startDate || d > endDate) continue;

    if (!result.has(path)) result.set(path, { total: 0, daily: new Map() });
    const entry = result.get(path)!;
    entry.total++;
    entry.daily.set(d, (entry.daily.get(d) || 0) + 1);
  }
  return result;
}

// --- DBからアカウント内のENABLE広告のadName + tiktokIdを取得 ---
async function getAccountAds(accountId: string): Promise<Array<{ tiktokId: string; adName: string; lpName: string | null }>> {
  const rows = await prisma.$queryRaw<any[]>`
    SELECT a.name as ad_name, a."tiktokId" as tiktok_ad_id
    FROM ads a
    JOIN adgroups ag ON a."adgroupId" = ag.id
    JOIN campaigns c ON ag."campaignId" = c.id
    JOIN advertisers adv ON c."advertiserId" = adv.id
    WHERE adv."tiktokAdvertiserId" = ${accountId}
      AND a.status = 'ENABLE'
  `;
  return rows.map(r => ({
    tiktokId: r.tiktok_ad_id,
    adName: r.ad_name,
    lpName: extractLpName(r.ad_name),
  }));
}

async function main() {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = jst.toISOString().split('T')[0];

  // 7日前〜昨日（TikTok APIは当日分がまだ確定しないので昨日まで）
  const yesterdayStr = new Date(jst.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const startDateStr = new Date(jst.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // オプトは今日も含める
  const dates: string[] = [];
  for (let i = 7; i >= 1; i--) {
    dates.push(new Date(jst.getTime() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  }
  dates.push(todayStr);

  console.log(`広告費期間: ${startDateStr} 〜 ${yesterdayStr}（TikTok API）`);
  console.log(`オプト期間: ${startDateStr} 〜 ${todayStr}（スプレッドシート）`);
  console.log();

  let grandTotalOpt = 0;
  let grandTotalSpend = 0;

  for (const appeal of APPEALS) {
    console.log(`📊 ${appeal.name}導線のスプレッドシート読み込み中...`);
    const optByFullPath = await getOptByPath(appeal.cvSpreadsheetId, startDateStr, todayStr);

    // 登録経路 → lpName変換
    const optByLpName = new Map<string, { total: number; daily: Map<string, number> }>();
    for (const [path, entry] of optByFullPath) {
      if (!path.startsWith(appeal.pathPrefix)) continue;
      const lpName = path.slice(appeal.pathPrefix.length);
      if (!optByLpName.has(lpName)) optByLpName.set(lpName, { total: 0, daily: new Map() });
      const existing = optByLpName.get(lpName)!;
      existing.total += entry.total;
      for (const [d, c] of entry.daily) {
        existing.daily.set(d, (existing.daily.get(d) || 0) + c);
      }
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${appeal.name}導線] 目標CPA: ¥${appeal.targetCPA.toLocaleString()}`);
    console.log(`${'='.repeat(80)}`);

    let appealTotalOpt = 0;
    let appealTotalSpend = 0;
    const appealDailyOpt = new Map<string, number>();

    for (const acc of appeal.accounts) {
      console.log(`\n  ${'─'.repeat(60)}`);
      console.log(`  [${acc.name}]`);

      // TikTok APIから広告費取得
      console.log(`    TikTok API取得中...`);
      const [regularSpend, smartPlusSpend] = await Promise.all([
        getAdSpendFromAPI(acc.id, startDateStr, yesterdayStr),
        getSmartPlusSpendFromAPI(acc.id, startDateStr, yesterdayStr),
      ]);

      // 統合（Smart+のIDが通常レポートにもある場合はSmart+を優先）
      const allSpend = new Map<string, { spend: number; imp: number; clicks: number }>();
      for (const [id, v] of regularSpend) allSpend.set(id, v);
      for (const [id, v] of smartPlusSpend) allSpend.set(id, v); // Smart+で上書き

      // DB上のENABLE広告リスト取得（広告名→lpName対応のため）
      const ads = await getAccountAds(acc.id);

      // tiktokId → lpName マッピング
      const idToLpName = new Map<string, string>();
      for (const ad of ads) {
        if (ad.lpName) idToLpName.set(ad.tiktokId, ad.lpName);
      }

      // lpName別にspend集約
      const spendByLpName = new Map<string, number>();
      let accTotalSpend = 0;

      for (const [adId, metrics] of allSpend) {
        const lpName = idToLpName.get(adId);
        if (!lpName) continue; // DB上にない or lpNameパース不可
        spendByLpName.set(lpName, (spendByLpName.get(lpName) || 0) + metrics.spend);
        accTotalSpend += metrics.spend;
      }

      // また、allSpendにあるがidToLpNameにないもの（DISABLE広告等でもspendがある）
      for (const [adId, metrics] of allSpend) {
        if (!idToLpName.has(adId) && metrics.spend > 0) {
          // DB上のENABLE以外の広告もチェック
          const dbAd = await prisma.ad.findUnique({ where: { tiktokId: adId } });
          if (dbAd) {
            const lpName = extractLpName(dbAd.name);
            if (lpName) {
              spendByLpName.set(lpName, (spendByLpName.get(lpName) || 0) + metrics.spend);
              accTotalSpend += metrics.spend;
              idToLpName.set(adId, lpName);
            }
          }
        }
      }

      // オプト集計
      let accTotalOpt = 0;
      const accDailyOpt = new Map<string, number>();
      const adResults: Array<{ lpName: string; spend: number; opt: number; cpa: string }> = [];

      // spendがあるlpName + optがあるlpName の和集合
      const allLpNames = new Set<string>();
      for (const lp of spendByLpName.keys()) allLpNames.add(lp);
      for (const ad of ads) {
        if (ad.lpName && optByLpName.has(ad.lpName)) allLpNames.add(ad.lpName);
      }

      for (const lpName of allLpNames) {
        const spend = spendByLpName.get(lpName) || 0;
        const optEntry = optByLpName.get(lpName);
        const opt = optEntry?.total || 0;
        accTotalOpt += opt;

        if (optEntry) {
          for (const [d, c] of optEntry.daily) {
            accDailyOpt.set(d, (accDailyOpt.get(d) || 0) + c);
          }
        }

        if (spend > 0 || opt > 0) {
          const cpa = opt > 0 ? `¥${Math.round(spend / opt).toLocaleString()}` : (spend > 0 ? '∞' : '-');
          adResults.push({ lpName, spend, opt, cpa });
        }
      }

      appealTotalSpend += accTotalSpend;
      appealTotalOpt += accTotalOpt;
      for (const [d, c] of accDailyOpt) {
        appealDailyOpt.set(d, (appealDailyOpt.get(d) || 0) + c);
      }

      const accCPA = accTotalOpt > 0 ? `¥${Math.round(accTotalSpend / accTotalOpt).toLocaleString()}` : '∞';
      const accDailyStr = dates.map(d => {
        const opt = accDailyOpt.get(d) || 0;
        const label = d === todayStr ? `${d.slice(5)}(今)` : d.slice(5);
        return `${label}:${opt}opt`;
      }).join(' | ');

      console.log(`    広告費(API): ¥${Math.round(accTotalSpend).toLocaleString()} / ${accTotalOpt}opt / CPA ${accCPA}`);
      console.log(`    日別opt: ${accDailyStr}`);

      // 広告(lpName)別 上位表示
      const sorted = adResults
        .filter(a => a.spend > 1000 || a.opt > 0)
        .sort((a, b) => b.spend - a.spend);

      if (sorted.length > 0) {
        console.log(`    ── 広告(LP-CR)別 ──`);
        for (const a of sorted.slice(0, 15)) {
          const judge = a.opt > 0 && a.spend / a.opt <= appeal.targetCPA ? '✅' :
                        a.opt === 0 && a.spend > appeal.targetCPA * 3 ? '🔴' :
                        a.opt === 0 && a.spend > 0 ? '⚠️' :
                        a.spend / a.opt > appeal.targetCPA * 2 ? '🔴' : '⚠️';
          console.log(`      ${judge} ${a.lpName}: ¥${Math.round(a.spend).toLocaleString()} / ${a.opt}opt / CPA ${a.cpa}`);
        }
        if (sorted.length > 15) {
          console.log(`      ... 他${sorted.length - 15}件`);
        }
      }
    }

    // 導線全体
    const appealCPA = appealTotalOpt > 0 ? `¥${Math.round(appealTotalSpend / appealTotalOpt).toLocaleString()}` : '∞';
    const appealDailyStr = dates.map(d => {
      const opt = appealDailyOpt.get(d) || 0;
      const label = d === todayStr ? `${d.slice(5)}(今)` : d.slice(5);
      return `${label}:${opt}`;
    }).join(' | ');

    console.log(`\n  📊 ${appeal.name}導線全体: ¥${Math.round(appealTotalSpend).toLocaleString()} / ${appealTotalOpt}opt / CPA ${appealCPA}`);
    console.log(`     日別オプト: ${appealDailyStr}`);

    grandTotalOpt += appealTotalOpt;
    grandTotalSpend += appealTotalSpend;
  }

  const grandCPA = grandTotalOpt > 0 ? `¥${Math.round(grandTotalSpend / grandTotalOpt).toLocaleString()}` : '∞';
  console.log(`\n${'#'.repeat(80)}`);
  console.log(`全体: ¥${Math.round(grandTotalSpend).toLocaleString()} / ${grandTotalOpt}opt / CPA ${grandCPA}`);
  console.log(`日平均: ${(grandTotalOpt / dates.length).toFixed(1)}opt/日`);
  console.log(`${'#'.repeat(80)}`);

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
