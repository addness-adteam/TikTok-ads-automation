import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.join(__dirname, '.env') });

const { google } = require('googleapis');

const prisma = new PrismaClient();
const SP_CV_SHEET_ID = '1kfsPgNDewEdkSotjoq4pHlqD_eGhzBeGPp7u2nEFJFk';
const SP_ACCOUNTS: Record<string, string> = {
  '7474920444831875080': 'SP1',
  '7592868952431362066': 'SP2',
  '7616545514662051858': 'SP3',
};

const START = '2026-03-05';
const END = '2026-03-13';

async function main() {
  // 1. DB: 3/5〜3/13の期間にENABLEだった可能性がある全広告を取得（statusに関係なく全件）
  const ads = await prisma.ad.findMany({
    where: {
      adGroup: { campaign: { advertiser: { tiktokAdvertiserId: { in: Object.keys(SP_ACCOUNTS) } } } },
    },
    select: {
      name: true,
      tiktokId: true,
      status: true,
      adGroup: { select: { campaign: { select: { advertiser: { select: { tiktokAdvertiserId: true } } } } } },
    },
  });

  // 広告名→アカウント＋LP-CR＋登録経路マッピング
  const adsByRegPath = new Map<string, { account: string; adName: string; lpCr: string; status: string }>();
  for (const ad of ads) {
    const advId = ad.adGroup?.campaign?.advertiser?.tiktokAdvertiserId || '';
    const acc = SP_ACCOUNTS[advId];
    if (!acc) continue;
    const adName = ad.name || '';
    const parts = adName.split('/');
    if (parts.length < 4) continue;
    const lastPart = parts[parts.length - 1];
    const match = lastPart.match(/(LP\d+-CR\d+)/i);
    if (!match) continue;
    const lpCr = match[1].toUpperCase();
    const regPath = `TikTok広告-スキルプラス-${lpCr}`;
    // 同じLP-CRで複数広告がある場合は最初のものを使う
    if (!adsByRegPath.has(regPath)) {
      adsByRegPath.set(regPath, { account: acc, adName, lpCr, status: ad.status || '' });
    }
  }

  // 2. 期間中にメトリクスがある広告を特定（＝配信されていた広告）
  const startDate = new Date(`${START}T00:00:00+09:00`);
  const endDate = new Date(`${END}T23:59:59+09:00`);

  const metrics = await prisma.metric.findMany({
    where: {
      entityType: 'AD',
      statDate: { gte: startDate, lte: endDate },
      ad: { adGroup: { campaign: { advertiser: { tiktokAdvertiserId: { in: Object.keys(SP_ACCOUNTS) } } } } },
      spend: { gt: 0 },
    },
    select: {
      ad: { select: { name: true, adGroup: { select: { campaign: { select: { advertiser: { select: { tiktokAdvertiserId: true } } } } } } } },
    },
    distinct: ['adId'],
  });

  // 配信されていた広告のLP-CRセット
  const activeRegPaths = new Set<string>();
  for (const m of metrics) {
    const advId = m.ad?.adGroup?.campaign?.advertiser?.tiktokAdvertiserId || '';
    const acc = SP_ACCOUNTS[advId];
    if (!acc) continue;
    const adName = m.ad?.name || '';
    const parts = adName.split('/');
    if (parts.length < 4) continue;
    const lastPart = parts[parts.length - 1];
    const match = lastPart.match(/(LP\d+-CR\d+)/i);
    if (!match) continue;
    const lpCr = match[1].toUpperCase();
    const regPath = `TikTok広告-スキルプラス-${lpCr}`;
    activeRegPaths.add(regPath);
    if (!adsByRegPath.has(regPath)) {
      adsByRegPath.set(regPath, { account: acc, adName, lpCr, status: '' });
    }
  }

  console.log(`期間中に配信されていた広告: ${activeRegPaths.size}本`);

  // 3. スプシ TT_オプト読み取り
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SP_CV_SHEET_ID,
    range: 'TT_オプト!A:Z',
  });
  const rows = res.data.values || [];

  const header = rows[0].map((h: string) => String(h || '').trim());
  let pathCol = header.findIndex((h: string) =>
    ['登録経路', '流入経路', 'registration_path', 'path', 'ファネル登録経路'].includes(h));
  let dateCol = header.findIndex((h: string) =>
    ['登録日時', '登録日', 'date', 'created_at', 'timestamp', 'アクション実行日時', '実行日時'].includes(h));
  if (pathCol < 0) pathCol = 4;
  if (dateCol < 0) dateCol = 5;

  // 日別×LP-CRでカウント
  const dailyCounts = new Map<string, Map<string, number>>();
  const dates: string[] = [];
  // 期間内の全日付を生成
  const d = new Date(startDate);
  while (d <= endDate) {
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    const key = `${jst.getUTCFullYear()}/${String(jst.getUTCMonth() + 1).padStart(2, '0')}/${String(jst.getUTCDate()).padStart(2, '0')}`;
    dates.push(key);
    dailyCounts.set(key, new Map());
    d.setTime(d.getTime() + 86400000);
  }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateStr = String(row[dateCol] || '').trim();
    const pathStr = String(row[pathCol] || '').trim();
    if (!dateStr || !pathStr) continue;
    if (!pathStr.startsWith('TikTok広告-スキルプラス-')) continue;

    const slashMatch = dateStr.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (!slashMatch) continue;
    const rowDate = new Date(Date.UTC(parseInt(slashMatch[1]), parseInt(slashMatch[2]) - 1, parseInt(slashMatch[3]), -9, 0, 0));
    if (rowDate < startDate || rowDate > endDate) continue;

    const dateKey = `${slashMatch[1]}/${String(parseInt(slashMatch[2])).padStart(2, '0')}/${String(parseInt(slashMatch[3])).padStart(2, '0')}`;
    const dayMap = dailyCounts.get(dateKey);
    if (dayMap) {
      dayMap.set(pathStr, (dayMap.get(pathStr) || 0) + 1);
    }
  }

  // 4. CSV出力: 配信されていた全CRを出力（オプト0含む）
  const csvRows: string[] = [];
  // ヘッダー
  csvRows.push(['アカウント', 'LP-CR', '広告名', ...dates.map(d => d.slice(5)), '合計'].join(','));

  // アカウント→LP-CR順にソート
  const sortedPaths = [...activeRegPaths].sort((a, b) => {
    const infoA = adsByRegPath.get(a);
    const infoB = adsByRegPath.get(b);
    if (!infoA || !infoB) return 0;
    if (infoA.account !== infoB.account) return infoA.account.localeCompare(infoB.account);
    return infoA.lpCr.localeCompare(infoB.lpCr);
  });

  for (const regPath of sortedPaths) {
    const info = adsByRegPath.get(regPath);
    if (!info) continue;

    const dailyValues: number[] = [];
    let total = 0;
    for (const date of dates) {
      const count = dailyCounts.get(date)?.get(regPath) || 0;
      dailyValues.push(count);
      total += count;
    }

    // 広告名のカンマをエスケープ
    const escapedName = `"${info.adName.replace(/"/g, '""')}"`;
    csvRows.push([info.account, info.lpCr, escapedName, ...dailyValues.map(String), String(total)].join(','));
  }

  // 日別合計行
  const dailyTotals = dates.map(date => {
    let total = 0;
    for (const regPath of activeRegPaths) {
      total += dailyCounts.get(date)?.get(regPath) || 0;
    }
    return total;
  });
  const grandTotal = dailyTotals.reduce((s, v) => s + v, 0);
  csvRows.push(['', '', '合計', ...dailyTotals.map(String), String(grandTotal)].join(','));

  // BOM付きUTF-8で保存
  const outputPath = path.join(__dirname, 'exports', 'sp-daily-opts-0305-0313.csv');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, '\uFEFF' + csvRows.join('\n'), 'utf-8');

  console.log(`\nCSV出力: ${outputPath}`);
  console.log(`行数: ${csvRows.length - 1}行（ヘッダー除く）`);
  console.log(`合計オプト: ${grandTotal}件`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
