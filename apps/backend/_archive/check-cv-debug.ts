/**
 * CR01190の4/9 CV数をオプトシートで確認するデバッグスクリプト
 */
import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const prisma = new PrismaClient();

async function main() {
  // 1. AI_1のappeal設定を取得
  const advertiser = await prisma.advertiser.findFirst({
    where: { tiktokAdvertiserId: '7468288053866561553' },
    include: { appeal: true },
  });

  if (!advertiser || !advertiser.appeal) {
    console.error('Advertiser or appeal not found');
    return;
  }

  const appeal = advertiser.appeal;
  console.log('=== Appeal設定 ===');
  console.log(`name: ${appeal.name}`);
  console.log(`targetCPA: ${appeal.targetCPA}`);
  console.log(`cvSpreadsheetUrl: ${appeal.cvSpreadsheetUrl}`);

  // 2. 登録経路を生成
  const lpName = 'LP1-CR01190';
  const registrationPath = `TikTok広告-${appeal.name}-${lpName}`;
  console.log(`\n=== 登録経路 ===`);
  console.log(`registrationPath: ${registrationPath}`);

  const registrationPathLP1Only = `TikTok広告-${appeal.name}-LP1`;
  console.log(`registrationPath (LP1のみ): ${registrationPathLP1Only}`);

  // 3. Google Sheets認証
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const spreadsheetId = appeal.cvSpreadsheetUrl!.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1];
  if (!spreadsheetId) {
    console.error('Cannot extract spreadsheet ID');
    return;
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'TT_オプト',
  });

  const rows = response.data.values;
  if (!rows) {
    console.error('No data in sheet');
    return;
  }

  console.log(`\n=== TT_オプト シートデータ ===`);
  console.log(`Total rows: ${rows.length}`);
  console.log(`Header: ${JSON.stringify(rows[0])}`);

  // 4. 登録経路と日付の列を特定
  const header = rows[0];
  let pathColIndex = -1;
  let dateColIndex = -1;
  for (let i = 0; i < header.length; i++) {
    const h = String(header[i]).trim();
    if (h === '登録経路' || h.includes('経路')) {
      pathColIndex = i;
      console.log(`登録経路列: ${i} (${h})`);
    }
    if (h === '登録日時' || h === '日時' || h === '日付' || h.includes('日時') || h.includes('日付')) {
      dateColIndex = i;
      console.log(`日付列: ${i} (${h})`);
    }
  }

  if (pathColIndex === -1 || dateColIndex === -1) {
    console.error(`列が見つかりません。pathCol=${pathColIndex}, dateCol=${dateColIndex}`);
    console.log('全ヘッダー:', header.map((h: any, i: number) => `${i}:${h}`).join(', '));
    return;
  }

  // 5. 4/9の全登録経路をリスト（TikTok広告-AI関連のみ）
  console.log(`\n=== 2026-04-09のCV一覧（TikTok広告-AI） ===`);
  let matchCount = 0;
  let lp1MatchCount = 0;
  const pathCounts = new Map<string, number>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateValue = row[dateColIndex];
    const pathValue = row[pathColIndex];

    if (!dateValue || !pathValue) continue;

    const dateStr = String(dateValue);
    if (!dateStr.includes('2026-04-09') && !dateStr.includes('2026/04/09') && !dateStr.includes('4/9')) continue;

    const pathStr = String(pathValue);
    if (!pathStr.includes('TikTok広告-AI')) continue;

    pathCounts.set(pathStr, (pathCounts.get(pathStr) || 0) + 1);
    if (pathStr === registrationPath) matchCount++;
    if (pathStr === registrationPathLP1Only) lp1MatchCount++;
  }

  console.log(`\n4/9の「TikTok広告-AI」含む登録経路:`);
  for (const [p, count] of pathCounts.entries()) {
    const marker = p === registrationPath ? ' ★完全一致★' :
                   p === registrationPathLP1Only ? ' ★LP1のみ一致★' :
                   p.includes('LP1') ? ' ← LP1含む' : '';
    console.log(`  ${count}件: ${p}${marker}`);
  }

  console.log(`\n=== マッチ結果 ===`);
  console.log(`「${registrationPath}」完全一致: ${matchCount}件`);
  console.log(`「${registrationPathLP1Only}」一致: ${lp1MatchCount}件`);

  // 6. Snapshot履歴
  try {
    const snapshots = await prisma.$queryRaw`
      SELECT "adId", "adName", "todayCVCount", "createdAt"
      FROM "BudgetOptimizationV2Snapshot"
      WHERE "adName" LIKE '%CR01190%'
      AND "createdAt" >= '2026-04-09T00:00:00Z'
      AND "createdAt" < '2026-04-10T00:00:00Z'
      ORDER BY "createdAt" ASC
    `;
    console.log(`\n=== 4/9のSnapshot履歴 ===`);
    console.log(JSON.stringify(snapshots, null, 2));
  } catch (e) {
    console.log('Snapshot table query error:', (e as Error).message);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
