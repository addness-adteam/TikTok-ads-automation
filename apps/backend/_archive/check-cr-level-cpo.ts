/**
 * CR単位の個別予約CPO算出
 * 1. 個別予約スプシでSPのタグ名等からCR情報を探る
 * 2. DB広告名からCR番号を抽出して支出を紐付ける
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

const RES_SPREADSHEET_ID = '1WdvXZiGakoRFTGqZGCBAKlfZgjVP4xhBPE55oMVgsic';

async function main() {
  // ===== 1. SP個別予約のタグ名を確認 =====
  console.log('=== 1. SP個別予約のタグ名・全列確認 ===\n');

  const resData = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: RES_SPREADSHEET_ID,
    range: "'シート1'!A:I",
  });
  const resRows = resData.data.values || [];
  console.log(`ヘッダー: ${resRows[0]?.map((h: any, i: number) => `[${i}]${h}`).join(' | ')}\n`);

  // TikTok広告_スキルプラスの行を全列表示（最大20行）
  let spCount = 0;
  console.log('--- TikTok広告_スキルプラスのサンプル ---');
  for (let i = 1; i < resRows.length && spCount < 20; i++) {
    const row = resRows[i];
    const inflow = String(row[2] || '').trim();
    if (inflow === 'TikTok広告_スキルプラス') {
      spCount++;
      console.log(`  [0]日付: ${row[0]} | [2]流入: ${inflow} | [5]タグ: ${String(row[5] || '').substring(0, 80)} | [7]CR名: ${row[7]}`);
    }
  }

  // ===== 2. DB広告名のパターン確認 =====
  console.log('\n\n=== 2. DB広告名のサンプル確認 ===\n');

  // 各チャネルの広告名サンプル
  const sampleAds = await prisma.$queryRaw<Array<{
    adName: string;
    advName: string;
    tiktokAdvId: string;
    totalSpend: number;
  }>>`
    SELECT a.name as "adName", adv.name as "advName", adv."tiktokAdvertiserId" as "tiktokAdvId",
           COALESCE(SUM(m.spend), 0) as "totalSpend"
    FROM ads a
    JOIN adgroups ag ON a."adgroupId" = ag.id
    JOIN campaigns c ON ag."campaignId" = c.id
    JOIN advertisers adv ON c."advertiserId" = adv.id
    LEFT JOIN metrics m ON m."adId" = a.id AND m."statDate" >= '2025-01-01' AND m."statDate" < '2026-01-01'
    WHERE a.status = 'ENABLE' OR COALESCE(
      (SELECT SUM(m2.spend) FROM metrics m2 WHERE m2."adId" = a.id AND m2."statDate" >= '2025-01-01' AND m2."statDate" < '2026-01-01'),
      0
    ) > 0
    GROUP BY a.name, adv.name, adv."tiktokAdvertiserId"
    ORDER BY COALESCE(SUM(m.spend), 0) DESC
    LIMIT 30
  `;

  for (const ad of sampleAds) {
    console.log(`  ¥${Math.round(Number(ad.totalSpend)).toLocaleString().padStart(10)} | ${ad.advName} | ${ad.adName?.substring(0, 60)}`);
  }

  // ===== 3. 広告名からCR番号を抽出するパターンを確認 =====
  console.log('\n\n=== 3. 広告名のCR番号パターン確認 ===\n');

  // CR番号を含む広告名のパターンを調べる
  const allAds = await prisma.$queryRaw<Array<{
    adName: string;
  }>>`
    SELECT DISTINCT a.name as "adName"
    FROM ads a
    JOIN adgroups ag ON a."adgroupId" = ag.id
    JOIN campaigns c ON ag."campaignId" = c.id
    JOIN metrics m ON m."adId" = a.id AND m."statDate" >= '2025-01-01' AND m."statDate" < '2026-01-01'
    WHERE m.spend > 0
    LIMIT 100
  `;

  const crPatterns = new Set<string>();
  for (const ad of allAds) {
    const name = ad.adName || '';
    // CR番号っぽいパターンを探す
    const crMatch = name.match(/CR\d+/i);
    if (crMatch) crPatterns.add(`${crMatch[0]} ← ${name.substring(0, 60)}`);
  }

  console.log(`CR番号を含む広告名: ${crPatterns.size}件`);
  for (const p of Array.from(crPatterns).slice(0, 20)) {
    console.log(`  ${p}`);
  }

  // パターンがない場合、広告名の構造を確認
  console.log('\n広告名の構造パターン（スラッシュ区切り）:');
  const structures = new Set<string>();
  for (const ad of allAds) {
    const parts = (ad.adName || '').split('/');
    structures.add(`${parts.length}パーツ: ${parts.map((p, i) => `[${i}]${p.substring(0, 20)}`).join(' / ')}`);
  }
  for (const s of Array.from(structures).slice(0, 20)) {
    console.log(`  ${s}`);
  }

  // ===== 4. adgroup名やcampaign名にCR情報があるか確認 =====
  console.log('\n\n=== 4. AdGroup/Campaign名のサンプル ===\n');

  const agSamples = await prisma.$queryRaw<Array<{
    campaignName: string;
    adgroupName: string;
    adName: string;
  }>>`
    SELECT c.name as "campaignName", ag.name as "adgroupName", a.name as "adName"
    FROM ads a
    JOIN adgroups ag ON a."adgroupId" = ag.id
    JOIN campaigns c ON ag."campaignId" = c.id
    JOIN metrics m ON m."adId" = a.id AND m."statDate" >= '2025-01-01' AND m."statDate" < '2026-01-01'
    WHERE m.spend > 0
    GROUP BY c.name, ag.name, a.name
    ORDER BY SUM(m.spend) DESC
    LIMIT 20
  `;

  for (const s of agSamples) {
    console.log(`  Campaign: ${s.campaignName?.substring(0, 40)}`);
    console.log(`  AdGroup:  ${s.adgroupName?.substring(0, 40)}`);
    console.log(`  Ad:       ${s.adName?.substring(0, 40)}`);
    console.log('');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
