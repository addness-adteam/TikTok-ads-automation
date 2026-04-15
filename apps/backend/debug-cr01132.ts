import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(process.cwd(), process.cwd().endsWith('backend') ? '../../.env' : '.env') });

import { PrismaClient } from '@prisma/client';
import { GoogleSheetsService } from './src/google-sheets/google-sheets.service';

class MiniConfigService {
  get<T = string>(key: string): T | undefined { return process.env[key] as any; }
}

async function main() {
  const prisma = new PrismaClient();
  const appeal = await prisma.appeal.findFirst({ where: { name: 'AI' } });
  if (!appeal?.cvSpreadsheetUrl) throw new Error('AI appeal or cvSpreadsheetUrl missing');
  console.log(`cvSpreadsheetUrl: ${appeal.cvSpreadsheetUrl}`);

  const sheets = new GoogleSheetsService(new MiniConfigService() as any);

  // スプシのTT_オプトシート全体を取得してLP1-CR01132に関連するものを全部見る
  const url = appeal.cvSpreadsheetUrl;
  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) throw new Error('cant parse id');
  const id = match[1];

  // 内部メソッド直接は呼べないので、google APIで直接取得
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const api = google.sheets({ version: 'v4', auth });

  const resp = await api.spreadsheets.values.get({ spreadsheetId: id, range: 'TT_オプト!A:Z' });
  const rows = resp.data.values || [];
  console.log(`TT_オプト 全行数: ${rows.length}`);
  console.log(`ヘッダ行: ${JSON.stringify(rows[0])}`);

  // 登録経路列位置を特定
  const header = rows[0] || [];
  const pathCol = header.findIndex((h: string) => h && (h.includes('登録経路') || h.includes('流入経路')));
  const dateCol = header.findIndex((h: string) => h && (h.includes('登録日') || h.includes('日時')));
  console.log(`登録経路列=${pathCol}(${header[pathCol]})  日付列=${dateCol}(${header[dateCol]})`);

  // CR01132を含むパスをすべて列挙
  const seen = new Map<string, number>();
  let totalContaining = 0;
  const samples: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i][pathCol];
    if (!p) continue;
    if (String(p).includes('CR01132')) {
      totalContaining++;
      seen.set(String(p), (seen.get(String(p)) ?? 0) + 1);
      if (samples.length < 5) samples.push(`row${i}: path=${JSON.stringify(p)} date=${JSON.stringify(rows[i][dateCol])}`);
    }
  }
  console.log(`\nCR01132 を含む行の数: ${totalContaining}`);
  console.log(`ユニーク登録経路文字列と件数:`);
  for (const [p, c] of [...seen.entries()].sort((a,b)=>b[1]-a[1])) {
    console.log(`  "${p}" (${p.length}文字): ${c}件`);
  }
  console.log(`\n先頭5サンプル:`);
  for (const s of samples) console.log(`  ${s}`);

  // 厳密一致の件数
  const exact = 'TikTok広告-AI-LP1-CR01132';
  let exactCount = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][pathCol] === exact) exactCount++;
  }
  console.log(`\n厳密一致 "${exact}" (${exact.length}文字): ${exactCount}件`);

  // 日付別分布
  const byMonth = new Map<string, number>();
  const inApril = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][pathCol] !== exact) continue;
    const d = String(rows[i][dateCol] || '');
    const ym = d.substring(0, 7);
    byMonth.set(ym, (byMonth.get(ym) ?? 0) + 1);
    if (ym === '2026-04') inApril.push(d);
  }
  console.log(`\n月別分布:`);
  for (const [m, c] of [...byMonth.entries()].sort()) console.log(`  ${m}: ${c}件`);
  console.log(`\n4月の日付サンプル(先頭10):`);
  for (const d of inApril.slice(0, 10)) console.log(`  ${d}`);
  console.log(`\n4月の日付サンプル(末尾10):`);
  for (const d of inApril.slice(-10)) console.log(`  ${d}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
