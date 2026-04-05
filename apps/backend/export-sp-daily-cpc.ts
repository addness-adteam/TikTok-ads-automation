import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.join(__dirname, '.env') });

const prisma = new PrismaClient();
const SP_ACCOUNTS: Record<string, string> = {
  '7474920444831875080': 'SP1',
  '7592868952431362066': 'SP2',
  '7616545514662051858': 'SP3',
};

const START = '2026-03-08';
const END = '2026-03-13';

async function main() {
  const startDate = new Date(`${START}T00:00:00+09:00`);
  const endDate = new Date(`${END}T23:59:59+09:00`);

  // 期間中にspend>0のメトリクスがある広告を全取得
  const metrics = await prisma.metric.findMany({
    where: {
      entityType: 'AD',
      statDate: { gte: startDate, lte: endDate },
      ad: { adGroup: { campaign: { advertiser: { tiktokAdvertiserId: { in: Object.keys(SP_ACCOUNTS) } } } } },
      spend: { gt: 0 },
    },
    select: {
      statDate: true,
      spend: true,
      clicks: true,
      impressions: true,
      conversions: true,
      ad: {
        select: {
          name: true,
          tiktokId: true,
          adGroup: { select: { campaign: { select: { advertiser: { select: { tiktokAdvertiserId: true } } } } } },
        },
      },
    },
    orderBy: { statDate: 'asc' },
  });

  console.log(`取得メトリクス: ${metrics.length}件`);

  // 日付リスト生成
  const dates: string[] = [];
  const d = new Date(startDate);
  while (d <= endDate) {
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    dates.push(`${jst.getUTCFullYear()}/${String(jst.getUTCMonth() + 1).padStart(2, '0')}/${String(jst.getUTCDate()).padStart(2, '0')}`);
    d.setTime(d.getTime() + 86400000);
  }

  // 広告ごと・日付ごとに集計
  interface DayData { spend: number; clicks: number; imp: number; cv: number }
  const adData = new Map<string, { account: string; adName: string; days: Map<string, DayData> }>();

  for (const m of metrics) {
    const advId = m.ad?.adGroup?.campaign?.advertiser?.tiktokAdvertiserId || '';
    const acc = SP_ACCOUNTS[advId];
    if (!acc) continue;
    const adName = m.ad?.name || '';
    const adId = m.ad?.tiktokId || '';
    const key = `${acc}:${adName}`;

    // 日付キー (JST)
    const jst = new Date(m.statDate.getTime() + 9 * 60 * 60 * 1000);
    const dateKey = `${jst.getUTCFullYear()}/${String(jst.getUTCMonth() + 1).padStart(2, '0')}/${String(jst.getUTCDate()).padStart(2, '0')}`;

    if (!adData.has(key)) adData.set(key, { account: acc, adName, days: new Map() });
    const entry = adData.get(key)!;
    const existing = entry.days.get(dateKey) || { spend: 0, clicks: 0, imp: 0, cv: 0 };
    existing.spend += m.spend;
    existing.clicks += m.clicks;
    existing.imp += m.impressions;
    existing.cv += m.conversions;
    entry.days.set(dateKey, existing);
  }

  console.log(`配信されていた広告: ${adData.size}本`);

  // CSV出力
  const csvRows: string[] = [];
  // ヘッダー: 各日付につきCPC列
  const headerCols = ['アカウント', 'LP-CR', '広告名'];
  for (const date of dates) {
    const short = date.slice(5);
    headerCols.push(`${short}_消化`, `${short}_clicks`, `${short}_CPC`);
  }
  headerCols.push('合計消化', '合計clicks', '合計CPC');
  csvRows.push(headerCols.join(','));

  // アカウント→広告名順にソート
  const sorted = [...adData.entries()].sort((a, b) => {
    if (a[1].account !== b[1].account) return a[1].account.localeCompare(b[1].account);
    return a[1].adName.localeCompare(b[1].adName);
  });

  for (const [_, info] of sorted) {
    const parts = info.adName.split('/');
    const lastPart = parts.length >= 4 ? parts[parts.length - 1] : '';
    const lpCrMatch = lastPart.match(/(LP\d+-CR\d+)/i);
    const lpCr = lpCrMatch ? lpCrMatch[1].toUpperCase() : lastPart;

    const cols: string[] = [info.account, lpCr, `"${info.adName.replace(/"/g, '""')}"`];
    let totalSpend = 0, totalClicks = 0;

    for (const date of dates) {
      const day = info.days.get(date);
      const spend = day?.spend || 0;
      const clicks = day?.clicks || 0;
      const cpc = clicks > 0 ? Math.round(spend / clicks) : 0;
      cols.push(String(Math.round(spend)), String(clicks), clicks > 0 ? String(cpc) : '-');
      totalSpend += spend;
      totalClicks += clicks;
    }

    const totalCPC = totalClicks > 0 ? Math.round(totalSpend / totalClicks) : 0;
    cols.push(String(Math.round(totalSpend)), String(totalClicks), totalClicks > 0 ? String(totalCPC) : '-');
    csvRows.push(cols.join(','));
  }

  const outputPath = path.join(__dirname, 'exports', 'sp-daily-cpc-0308-0313.csv');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, '\uFEFF' + csvRows.join('\n'), 'utf-8');

  console.log(`\nCSV出力: ${outputPath}`);
  console.log(`行数: ${csvRows.length - 1}行`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
