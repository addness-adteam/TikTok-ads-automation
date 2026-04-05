import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
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
  // 1. DB: SP1/SP2/SP3の全広告を取得
  const ads = await prisma.ad.findMany({
    where: {
      adGroup: { campaign: { advertiser: { tiktokAdvertiserId: { in: Object.keys(SP_ACCOUNTS) } } } },
    },
    select: {
      name: true,
      tiktokId: true,
      adGroup: { select: { campaign: { select: { advertiser: { select: { tiktokAdvertiserId: true } } } } } },
    },
  });

  // 広告名 → LP-CR抽出 → 登録経路生成
  const adMap = new Map<string, { account: string; adName: string; regPath: string }>();
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
    adMap.set(regPath, { account: acc, adName, regPath });
  }

  console.log(`対象広告: ${adMap.size}種類のLP-CR\n`);

  // 2. スプシ TT_オプト読み取り
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SP_CV_SHEET_ID,
    range: 'TT_オプト!A:Z',
  });
  const rows = res.data.values || [];
  if (rows.length < 2) { console.log('データなし'); return; }

  // ヘッダー検出
  const header = rows[0].map((h: string) => String(h || '').trim());
  let pathCol = header.findIndex((h: string) =>
    ['登録経路', '流入経路', 'registration_path', 'path', 'ファネル登録経路'].includes(h));
  let dateCol = header.findIndex((h: string) =>
    ['登録日時', '登録日', 'date', 'created_at', 'timestamp', 'アクション実行日時', '実行日時'].includes(h));
  if (pathCol < 0) pathCol = 4;
  if (dateCol < 0) dateCol = 5;
  console.log(`ヘッダー: pathCol=${pathCol}(${header[pathCol]}), dateCol=${dateCol}(${header[dateCol]})\n`);

  const startDate = new Date(`${START}T00:00:00+09:00`);
  const endDate = new Date(`${END}T23:59:59+09:00`);

  // 日付×LP-CR別にカウント
  const dailyCounts = new Map<string, Map<string, number>>(); // date → (regPath → count)
  const allPaths = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateStr = String(row[dateCol] || '').trim();
    const pathStr = String(row[pathCol] || '').trim();
    if (!dateStr || !pathStr) continue;

    const slashMatch = dateStr.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (!slashMatch) continue;
    const y = parseInt(slashMatch[1]), m = parseInt(slashMatch[2]) - 1, d = parseInt(slashMatch[3]);
    const rowDate = new Date(Date.UTC(y, m, d, -9, 0, 0));
    if (rowDate < startDate || rowDate > endDate) continue;

    // スキルプラスの登録経路にマッチするか
    if (!pathStr.startsWith('TikTok広告-スキルプラス-')) continue;

    const dateKey = `${slashMatch[1]}/${String(parseInt(slashMatch[2])).padStart(2, '0')}/${String(parseInt(slashMatch[3])).padStart(2, '0')}`;
    if (!dailyCounts.has(dateKey)) dailyCounts.set(dateKey, new Map());
    const dayMap = dailyCounts.get(dateKey)!;
    dayMap.set(pathStr, (dayMap.get(pathStr) || 0) + 1);
    allPaths.add(pathStr);
  }

  // 3. 表示: 日別×広告別
  const sortedDates = [...dailyCounts.keys()].sort();
  const sortedPaths = [...allPaths].sort();

  // パスごとの合計を先に計算してソート
  const pathTotals = new Map<string, number>();
  for (const p of sortedPaths) {
    let total = 0;
    for (const [_, dayMap] of dailyCounts) total += dayMap.get(p) || 0;
    pathTotals.set(p, total);
  }
  const rankedPaths = [...pathTotals.entries()].sort((a, b) => b[1] - a[1]);

  console.log(`期間: ${START} 〜 ${END}`);
  console.log(`検出オプト: ${[...dailyCounts.values()].reduce((s, m) => s + [...m.values()].reduce((s2, v) => s2 + v, 0), 0)}件\n`);

  for (const [regPath, total] of rankedPaths) {
    const adInfo = adMap.get(regPath);
    const acc = adInfo?.account || '?';
    const adName = adInfo?.adName || regPath;
    // 広告名から制作者/CR名を抽出
    const parts = adName.split('/');
    const displayName = parts.length >= 3 ? `${parts[1]}/${parts[2]}` : adName;
    const lpCr = regPath.replace('TikTok広告-スキルプラス-', '');

    console.log(`\n${acc} | ${lpCr} | ${displayName} | 合計: ${total}オプト`);
    const dailyStr = sortedDates.map(date => {
      const count = dailyCounts.get(date)?.get(regPath) || 0;
      return `${date.slice(5)}:${count}`;
    }).join(' | ');
    console.log(`  ${dailyStr}`);
  }

  // 日別合計
  console.log(`\n${'─'.repeat(60)}`);
  console.log('日別合計:');
  for (const date of sortedDates) {
    const dayTotal = [...(dailyCounts.get(date)?.values() || [])].reduce((s, v) => s + v, 0);
    console.log(`  ${date}: ${dayTotal}オプト`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
