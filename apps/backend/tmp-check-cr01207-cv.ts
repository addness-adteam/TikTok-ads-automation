import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });
import { PrismaClient } from '@prisma/client';
const { google } = require('googleapis');

const prisma = new PrismaClient();

async function main() {
  console.log('=== CR01207 CV数確認 ===\n');

  // 1. Appeal情報取得（AI導線のスプレッドシートURL）
  const appeal = await prisma.appeal.findFirst({ where: { name: 'AI' } });
  if (!appeal?.cvSpreadsheetUrl) { console.log('AI appealなし'); return; }

  const spreadsheetId = appeal.cvSpreadsheetUrl.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] || '';
  console.log(`CVスプレッドシート: ${spreadsheetId}`);

  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  // 2. TT_オプトシートからCR01207のCV数を確認
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'TT_オプト!A:Z',
  });
  const rows = res.data.values || [];
  const header = rows[0] || [];

  // カラム特定
  let pathCol = -1, dateCol = -1;
  for (let i = 0; i < header.length; i++) {
    const h = String(header[i] || '').trim();
    if (['登録経路', '流入経路', 'ファネル登録経路'].includes(h)) pathCol = i;
    if (['登録日時', '登録日', 'アクション実行日時', '実行日時'].includes(h)) dateCol = i;
  }
  console.log(`登録経路列: ${pathCol}, 日時列: ${dateCol}\n`);

  // CR01207に一致する行を抽出
  const matches: { date: string; path: string }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const regPath = String(rows[i]?.[pathCol] || '');
    const dateVal = String(rows[i]?.[dateCol] || '');
    if (regPath.includes('CR01207')) {
      matches.push({ date: dateVal, path: regPath });
    }
  }

  console.log(`CR01207 全期間オプト: ${matches.length}件`);
  for (const m of matches) {
    console.log(`  ${m.date} | ${m.path}`);
  }

  // 今日のCV数（JST）
  const jstNow = new Date(Date.now() + 9 * 3600000);
  const todayStr = `${jstNow.getUTCFullYear()}/${String(jstNow.getUTCMonth() + 1).padStart(2, '0')}/${String(jstNow.getUTCDate()).padStart(2, '0')}`;
  const todayMatches = matches.filter(m => m.date.startsWith(todayStr) || m.date.startsWith(todayStr.replace(/\//g, '-')));
  console.log(`\n今日(${todayStr})のCV: ${todayMatches.length}件`);

  // 昨日
  const yesterday = new Date(jstNow.getTime() - 86400000);
  const yesterdayStr = `${yesterday.getUTCFullYear()}/${String(yesterday.getUTCMonth() + 1).padStart(2, '0')}/${String(yesterday.getUTCDate()).padStart(2, '0')}`;
  const yesterdayMatches = matches.filter(m => m.date.startsWith(yesterdayStr) || m.date.startsWith(yesterdayStr.replace(/\//g, '-')));
  console.log(`昨日(${yesterdayStr})のCV: ${yesterdayMatches.length}件`);

  // 3. V2がこのCRの登録経路をどう認識しているか確認
  // 登録経路は TikTok広告-AI-LP1-CR01207 のはず
  const expectedPath = 'TikTok広告-AI-LP1-CR01207';
  console.log(`\n期待される登録経路: ${expectedPath}`);

  // この経路で直近のCVを数える（V2と同じロジック）
  let todayCvForV2 = 0;
  for (let i = 1; i < rows.length; i++) {
    const regPath = String(rows[i]?.[pathCol] || '').trim();
    const dateVal = String(rows[i]?.[dateCol] || '');
    if (regPath !== expectedPath) continue;

    // 日付解析
    const dateMatch = dateVal.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (!dateMatch) continue;
    const y = parseInt(dateMatch[1]), mo = parseInt(dateMatch[2]), d = parseInt(dateMatch[3]);
    if (y === jstNow.getUTCFullYear() && mo === jstNow.getUTCMonth() + 1 && d === jstNow.getUTCDate()) {
      todayCvForV2++;
    }
  }
  console.log(`V2が認識する今日のCV数: ${todayCvForV2}件`);

  // 4. 他のCR454横展開キャンペーンのCV数も確認（混同の可能性）
  console.log('\n=== CR454横展開の全CRの今日CV ===');
  const cr454Pattern = /CR454/i;
  const cr454Cvs = new Map<string, number>();
  for (let i = 1; i < rows.length; i++) {
    const regPath = String(rows[i]?.[pathCol] || '').trim();
    const dateVal = String(rows[i]?.[dateCol] || '');
    if (!regPath.includes('CR0') && !regPath.includes('CR1')) continue;

    const dateMatch = dateVal.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (!dateMatch) continue;
    const y = parseInt(dateMatch[1]), mo = parseInt(dateMatch[2]), d = parseInt(dateMatch[3]);
    if (y === jstNow.getUTCFullYear() && mo === jstNow.getUTCMonth() + 1 && d === jstNow.getUTCDate()) {
      const crMatch = regPath.match(/(LP\d+-CR\d+)/i);
      if (crMatch) {
        const cr = crMatch[1].toUpperCase();
        cr454Cvs.set(cr, (cr454Cvs.get(cr) || 0) + 1);
      }
    }
  }
  // 最近のCR番号（01100以降）を表示
  const recent = [...cr454Cvs.entries()].filter(([cr]) => {
    const num = parseInt(cr.match(/CR(\d+)/)?.[1] || '0');
    return num >= 1100;
  }).sort((a, b) => b[1] - a[1]);

  console.log(`今日の全CR（CR01100以降）:`);
  for (const [cr, count] of recent) {
    console.log(`  ${cr}: ${count}件`);
  }

  // 5. V2の予算増額ログ（HourlyOptimizationSnapshot）を広告ID「1862060201804962」で検索
  console.log('\n=== V2スナップショット（adId: 1862060201804962）===');
  const snaps = await prisma.hourlyOptimizationSnapshot.findMany({
    where: { adId: '1862060201804962' },
    orderBy: { executionTime: 'desc' },
    take: 10,
  });
  if (snaps.length === 0) {
    // 広告名でも検索
    const snaps2 = await prisma.hourlyOptimizationSnapshot.findMany({
      where: { adName: { contains: 'CR01207' } },
      orderBy: { executionTime: 'desc' },
      take: 10,
    });
    if (snaps2.length > 0) {
      for (const s of snaps2) console.log(`${s.executionTime.toISOString()} | ${s.action} | CV:${s.todayCVCount} | budget:${s.dailyBudget} | new:${s.newBudget} | ${s.reason}`);
    } else {
      console.log('スナップショットなし');
    }
  } else {
    for (const s of snaps) console.log(`${s.executionTime.toISOString()} | ${s.action} | CV:${s.todayCVCount} | budget:${s.dailyBudget} | new:${s.newBudget} | ${s.reason}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); });
