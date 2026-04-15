/**
 * 同じ動画を使った全CRの個別予約・成約を確認
 * 動画名（キャンペーン名の3セグメント目）でグルーピング
 *
 * npx tsx apps/backend/check-video-family-sales.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.join(__dirname, '.env') });

import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';
const INDRES_SHEET_ID = '1MsJRbZGrLOkgd7lRApr1ciFQ1GOZaIjmrXQSIe3_nCA';

const ACCOUNTS = [
  { id: '7468288053866561553', name: 'AI_1' },
  { id: '7523128243466551303', name: 'AI_2' },
  { id: '7543540647266074641', name: 'AI_3' },
  { id: '7580666710525493255', name: 'AI_4' },
];

// 調べたい動画名（キャンペーン名の3セグメント目）
const TARGET_VIDEOS = [
  '尻込み',        // ちえみさん
  '箕輪さんまとめ',  // 箕輪さん
  'お絵描きムービー', // お絵描き
];

async function get(ep: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const r = await fetch(`${BASE}${ep}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return r.json();
}

function extractLpCr(text: string): string | null {
  const match = text.match(/(LP\d+-CR\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

async function main() {
  console.log('=== 同一動画ファミリーの個別予約・成約確認 ===\n');

  // 1. 全アカウントの全キャンペーン名を取得
  console.log('キャンペーン一覧取得中...');
  const allCamps: { id: string; name: string; account: string; lpCr: string }[] = [];

  for (const acc of ACCOUNTS) {
    let page = 1;
    while (true) {
      const resp = await get('/v1.3/campaign/get/', {
        advertiser_id: acc.id, page_size: '100', page: String(page),
        fields: JSON.stringify(['campaign_id', 'campaign_name']),
      });
      if (resp.code !== 0) break;
      for (const c of resp.data?.list || []) {
        const lpCr = extractLpCr(c.campaign_name || '');
        if (lpCr) {
          allCamps.push({ id: c.campaign_id, name: c.campaign_name, account: acc.name, lpCr });
        }
      }
      if ((resp.data?.list || []).length < 100) break;
      page++;
    }
  }
  console.log(`  全キャンペーン: ${allCamps.length}件\n`);

  // 2. 個別予約スプレッドシートからCR別予約数を取得
  console.log('個別予約データ取得中...');
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const indResResp = await sheets.spreadsheets.values.get({
    spreadsheetId: INDRES_SHEET_ID,
    range: 'AI!A:AZ',
  });
  const indResRows = indResResp.data.values || [];

  // AU列(46)からLP-CR別の個別予約数
  const indResByCr = new Map<string, number>();
  for (let i = 1; i < indResRows.length; i++) {
    const pathCell = indResRows[i]?.[46] || '';
    for (const line of pathCell.split('\n')) {
      const cr = extractLpCr(line.trim());
      if (cr) indResByCr.set(cr, (indResByCr.get(cr) || 0) + 1);
    }
  }
  console.log(`  個別予約データ: ${indResByCr.size}種類のCR\n`);

  // 3. オプトインシートからメール→CRマッピング
  console.log('オプトインデータ取得中...');
  const appeal = await prisma.appeal.findFirst({ where: { name: 'AI' } });
  const spreadsheetId = appeal?.cvSpreadsheetUrl?.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] || '';

  const optinResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'TT_オプト!A:Z',
  });
  const optinRows = optinResp.data.values || [];
  // ヘッダーからカラム特定
  const optHeader = optinRows[0] || [];
  let emailCol = -1, pathCol = -1;
  for (let i = 0; i < optHeader.length; i++) {
    const h = String(optHeader[i] || '').trim();
    if (h.includes('メール') || h.includes('email')) emailCol = i;
    if (['登録経路', '流入経路', 'ファネル登録経路'].includes(h)) pathCol = i;
  }

  // メール→CR一覧
  const emailToCrs = new Map<string, Set<string>>();
  const crToEmails = new Map<string, Set<string>>();
  for (let i = 1; i < optinRows.length; i++) {
    const row = optinRows[i];
    const email = String(row[emailCol] || '').toLowerCase().trim();
    const regPath = String(row[pathCol] || '').trim();
    if (!email || !regPath.startsWith('TikTok広告-')) continue;
    const cr = extractLpCr(regPath);
    if (!cr) continue;
    if (!emailToCrs.has(email)) emailToCrs.set(email, new Set());
    emailToCrs.get(email)!.add(cr);
    if (!crToEmails.has(cr)) crToEmails.set(cr, new Set());
    crToEmails.get(cr)!.add(email);
  }
  console.log(`  オプトインメール: ${emailToCrs.size}件\n`);

  // 4. 成約CSVからメール一覧
  const csvPath = 'c:/Users/itali/Downloads/決済履歴集計表_商品購入集計表_表.csv';
  const csvData = fs.readFileSync(csvPath, 'utf-8');
  const csvLines = csvData.split('\n').filter(l => l.trim());

  const salesEmails = new Set<string>();
  const salesByEmail = new Map<string, { name: string; product: string; amount: number; date: string }[]>();
  for (let i = 1; i < csvLines.length; i++) {
    const parts: string[] = [];
    let current = '', inP = false;
    for (const ch of csvLines[i]) {
      if (ch === '(' || ch === '（') inP = true;
      if (ch === ')' || ch === '）') inP = false;
      if (ch === ',' && !inP) { parts.push(current.trim()); current = ''; } else current += ch;
    }
    parts.push(current.trim());
    const email = (parts[6] || '').toLowerCase().trim();
    const amount = parseInt(parts[8] || '0');
    if (!email || amount < 100000) continue; // バックエンドのみ
    salesEmails.add(email);
    if (!salesByEmail.has(email)) salesByEmail.set(email, []);
    salesByEmail.get(email)!.push({ name: parts[5] || '', product: parts[4] || '', amount, date: parts[0] || '' });
  }

  // 5. 動画ファミリーごとに集計
  for (const videoKeyword of TARGET_VIDEOS) {
    console.log(`${'='.repeat(60)}`);
    console.log(`動画: 「${videoKeyword}」`);
    console.log(`${'='.repeat(60)}\n`);

    // この動画名を含むキャンペーンを検索
    const matchedCamps = allCamps.filter(c => c.name.includes(videoKeyword));
    const lpCrs = [...new Set(matchedCamps.map(c => c.lpCr))];

    console.log(`関連キャンペーン: ${matchedCamps.length}件 | ユニークCR: ${lpCrs.length}件\n`);

    // CR別の詳細
    let totalIndRes = 0;
    let totalSales = 0;
    let totalSalesAmount = 0;

    for (const lpCr of lpCrs) {
      const camps = matchedCamps.filter(c => c.lpCr === lpCr);
      const indRes = indResByCr.get(lpCr) || 0;
      totalIndRes += indRes;

      // このCRのオプトインメールで成約した人
      const crEmails = crToEmails.get(lpCr) || new Set();
      const salesFromCr: { name: string; product: string; amount: number; date: string; email: string }[] = [];
      for (const email of crEmails) {
        if (salesEmails.has(email)) {
          const records = salesByEmail.get(email) || [];
          for (const r of records) {
            salesFromCr.push({ ...r, email });
          }
        }
      }
      totalSales += salesFromCr.length;
      totalSalesAmount += salesFromCr.reduce((s, r) => s + r.amount, 0);

      const accounts = [...new Set(camps.map(c => c.account))].join(', ');
      const optinCount = crEmails.size;

      console.log(`  ${lpCr} | 個別予約: ${indRes}件 | オプト: ${optinCount}件 | 成約: ${salesFromCr.length}件 | ${accounts}`);
      for (const camp of camps) {
        console.log(`    ${camp.name}`);
      }
      for (const sale of salesFromCr) {
        console.log(`    → 成約: ${sale.name} | ${sale.product} | ¥${sale.amount.toLocaleString()} (${sale.date})`);
      }
    }

    console.log(`\n  合計: 個別予約 ${totalIndRes}件 | 成約 ${totalSales}件 | 売上 ¥${totalSalesAmount.toLocaleString()}\n`);
  }

  // CR01144も確認
  console.log(`${'='.repeat(60)}`);
  console.log(`動画: 「AI全部やめました渋谷Ver」（参考）`);
  console.log(`${'='.repeat(60)}\n`);

  const cr01144Camps = allCamps.filter(c => c.name.includes('AI全部やめました') || c.name.includes('渋谷Ver'));
  const cr01144LpCrs = [...new Set(cr01144Camps.map(c => c.lpCr))];
  let total01144IndRes = 0, total01144Sales = 0;

  for (const lpCr of cr01144LpCrs) {
    const camps = cr01144Camps.filter(c => c.lpCr === lpCr);
    const indRes = indResByCr.get(lpCr) || 0;
    total01144IndRes += indRes;
    const crEmails = crToEmails.get(lpCr) || new Set();
    const salesFromCr: any[] = [];
    for (const email of crEmails) {
      if (salesEmails.has(email)) {
        for (const r of salesByEmail.get(email) || []) salesFromCr.push({ ...r, email });
      }
    }
    total01144Sales += salesFromCr.length;
    console.log(`  ${lpCr} | 個別予約: ${indRes}件 | オプト: ${crEmails.size}件 | 成約: ${salesFromCr.length}件`);
    for (const camp of camps) console.log(`    ${camp.name}`);
    for (const s of salesFromCr) console.log(`    → 成約: ${s.name} | ¥${s.amount.toLocaleString()} (${s.date})`);
  }
  console.log(`\n  合計: 個別予約 ${total01144IndRes}件 | 成約 ${total01144Sales}件\n`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); });
