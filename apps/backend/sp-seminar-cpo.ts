/**
 * スキルプラス導線 セミナー着座CPO（直近7日出稿CR別）
 *
 * 紐づけ:
 *   TT_オプト(email→CR登録経路) → セミナー予約フォーム(email→回答者名) → member CSV(表示名→着座フラグ)
 *
 * npx tsx apps/backend/sp-seminar-cpo.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.join(__dirname, '.env') });

const { google } = require('googleapis');

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SP_CV_SPREADSHEET_ID = '1kfsPgNDewEdkSotjoq4pHlqD_eGhzBeGPp7u2nEFJFk';

const SP_ACCOUNTS = [
  { id: '7474920444831875080', name: 'SP1' },
  { id: '7592868952431362066', name: 'SP2' },
  { id: '7616545514662051858', name: 'SP3' },
];

const SEMINAR_FORM_CSV = 'c:/Users/itali/Downloads/セミナー予約特典フォーム - シート1 (2).csv';
const MEMBER_CSV = 'c:/Users/itali/Downloads/member_202604101457_20260410145746.csv';

function extractLPCR(s: string): string | null {
  const m = s.match(/(LP\d+-CR\d+)/i);
  return m ? m[1].toUpperCase() : null;
}

function jstDateStr(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')}`;
}

async function tiktokGet(endpoint: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

/** セミナー予約フォームCSVを読み込み: email→回答者名 マッピング */
function loadSeminarForm(): Map<string, string> {
  const content = fs.readFileSync(SEMINAR_FORM_CSV, 'utf-8');
  const lines = content.split('\n');
  const map = new Map<string, string>();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const name = (cols[3] || '').trim();
    const email = (cols[7] || '').trim().toLowerCase();
    if (email && name) {
      map.set(email, name);
    }
  }
  return map;
}

/** member CSV (Shift-JIS) を読み込み: 表示名→着座フラグ */
function loadMemberAttendance(): Map<string, boolean> {
  const { execSync } = require('child_process');
  const content = execSync(`iconv -f SHIFT-JIS -t UTF-8//IGNORE "${MEMBER_CSV}"`).toString();
  const lines = content.split('\n');
  const map = new Map<string, boolean>();
  for (let i = 2; i < lines.length; i++) { // skip 2 header rows
    const cols = lines[i].split(',').map((c: string) => c.replace(/"/g, '').trim());
    const displayName = cols[1] || '';
    const lineName = cols[2] || '';
    const attended = cols[3] === '1';
    if (displayName) map.set(displayName, attended);
    if (lineName && lineName !== displayName) map.set(lineName, attended);
  }
  return map;
}

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS!);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  // 1. TT_オプトからemail→CR登録経路を取得
  console.log('=== ① TT_オプト読み込み ===');
  const optRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SP_CV_SPREADSHEET_ID,
    range: 'TT_オプト!A:F',
  });
  const optRows: any[][] = optRes.data.values || [];
  // email → { lpCr, date }
  const emailToCR = new Map<string, { lpCr: string; date: string }>();
  for (let i = 1; i < optRows.length; i++) {
    const row = optRows[i];
    const email = (row[1] || '').trim().toLowerCase();
    const regPath = row[4] || '';
    const date = row[5] || '';
    const lpCr = extractLPCR(regPath);
    if (email && lpCr) {
      emailToCR.set(email, { lpCr, date });
    }
  }
  console.log(`  オプト件数: ${emailToCR.size}件（CR登録経路あり）`);

  // 2. セミナー予約フォーム: email→回答者名
  console.log('\n=== ② セミナー予約フォーム読み込み ===');
  const formMap = loadSeminarForm();
  console.log(`  セミナー予約者: ${formMap.size}件`);

  // 3. member CSV: 名前→着座フラグ
  console.log('\n=== ③ member CSV読み込み ===');
  const memberMap = loadMemberAttendance();
  const attendedCount = [...memberMap.values()].filter(v => v).length;
  console.log(`  会員数: ${memberMap.size}名, うち着座: ${attendedCount}名`);

  // 4. 紐づけ: email → CR + 着座フラグ
  console.log('\n=== ④ 紐づけ ===');
  // オプトシートのemail → フォームのemail(名前) → member(着座)
  const crAttendance = new Map<string, { attended: number; reserved: number; optins: number }>();

  let matchCount = 0;
  let noFormMatch = 0;
  let noMemberMatch = 0;

  for (const [email, crData] of emailToCR) {
    const lpCr = crData.lpCr;
    if (!crAttendance.has(lpCr)) {
      crAttendance.set(lpCr, { attended: 0, reserved: 0, optins: 0 });
    }
    const cr = crAttendance.get(lpCr)!;
    cr.optins++;

    // セミナー予約フォームにメールがあるか
    const formName = formMap.get(email);
    if (!formName) {
      // フォーム未回答 = セミナー予約していない
      continue;
    }
    cr.reserved++;

    // member CSVで着座フラグ確認
    const attended = memberMap.get(formName);
    if (attended === undefined) {
      noMemberMatch++;
      // 名前の部分一致も試す（スペースやゼロ幅文字の違い対策）
      const normalizedName = formName.replace(/[\s　]/g, '');
      let found = false;
      for (const [mName, mAttended] of memberMap) {
        if (mName.replace(/[\s　]/g, '') === normalizedName) {
          if (mAttended) { cr.attended++; matchCount++; }
          found = true;
          break;
        }
      }
      if (!found) continue;
    } else {
      if (attended) { cr.attended++; matchCount++; }
    }
  }
  console.log(`  着座紐づけ成功: ${matchCount}件, member不一致: ${noMemberMatch}件`);

  // 5. 直近7日で出稿したCR（TikTok API）の広告費取得
  console.log('\n=== ⑤ 直近7日出稿CRの広告費取得 ===');
  const now = new Date();
  const endDate = jstDateStr(now);
  const startDate = jstDateStr(new Date(now.getTime() - 7 * 86400000));

  interface AdInfo { adId: string; adName: string; lpCr: string; accountName: string; accountId: string; spend: number; createTime: string }
  const allAds: AdInfo[] = [];

  for (const account of SP_ACCOUNTS) {
    let page = 1;
    while (true) {
      const resp = await tiktokGet('/v1.3/ad/get/', {
        advertiser_id: account.id,
        fields: JSON.stringify(['ad_id', 'ad_name', 'create_time']),
        page_size: '100',
        page: String(page),
      });
      if (resp.code !== 0) break;
      const list = resp.data?.list || [];
      for (const ad of list) {
        const lpCr = extractLPCR(ad.ad_name || '');
        if (!lpCr) continue;
        // 直近7日間に作成された広告
        const createDate = (ad.create_time || '').substring(0, 10);
        if (createDate >= startDate && createDate <= endDate) {
          allAds.push({
            adId: ad.ad_id,
            adName: ad.ad_name,
            lpCr,
            accountName: account.name,
            accountId: account.id,
            spend: 0,
            createTime: createDate,
          });
        }
      }
      if (list.length < 100) break;
      page++;
    }
  }

  // LP-CRでグルーピング
  const crAds = new Map<string, { adIds: string[]; accountId: string; accountName: string; adName: string; createTime: string }>();
  for (const ad of allAds) {
    const key = `${ad.accountName}:${ad.lpCr}`;
    const existing = crAds.get(key);
    if (existing) {
      existing.adIds.push(ad.adId);
    } else {
      crAds.set(key, { adIds: [ad.adId], accountId: ad.accountId, accountName: ad.accountName, adName: ad.adName, createTime: ad.createTime });
    }
  }

  // 広告費取得
  const crSpend = new Map<string, { totalSpend: number; accounts: string[]; adName: string; createTime: string }>();
  for (const [key, data] of crAds) {
    const lpCr = key.split(':')[1];
    // レポートAPI
    let spend = 0;
    for (let i = 0; i < data.adIds.length; i += 100) {
      const batch = data.adIds.slice(i, i + 100);
      const resp = await tiktokGet('/v1.3/report/integrated/get/', {
        advertiser_id: data.accountId,
        report_type: 'BASIC',
        data_level: 'AUCTION_AD',
        dimensions: JSON.stringify(['ad_id']),
        metrics: JSON.stringify(['spend']),
        start_date: startDate,
        end_date: endDate,
        filtering: JSON.stringify([{ field_name: 'ad_ids', filter_type: 'IN', filter_value: JSON.stringify(batch) }]),
        page_size: '1000',
      });
      if (resp.code === 0 && resp.data?.list) {
        for (const row of resp.data.list) {
          spend += parseFloat(row.metrics?.spend || '0');
        }
      }
    }

    const existing = crSpend.get(lpCr);
    if (existing) {
      existing.totalSpend += spend;
      existing.accounts.push(`${data.accountName}(¥${Math.round(spend).toLocaleString()})`);
    } else {
      crSpend.set(lpCr, {
        totalSpend: spend,
        accounts: [`${data.accountName}(¥${Math.round(spend).toLocaleString()})`],
        adName: data.adName,
        createTime: data.createTime,
      });
    }
  }

  console.log(`  直近7日出稿CR: ${crSpend.size}種類`);

  // 6. 結果表示
  console.log('\n┌──────────────────────────────────────────────────────────────┐');
  console.log('│  スキルプラス セミナー着座CPO（直近7日出稿CR）              │');
  console.log('└──────────────────────────────────────────────────────────────┘\n');

  interface Result {
    lpCr: string;
    spend: number;
    optins: number;
    reserved: number;
    attended: number;
    cpo: number | null;
    accounts: string[];
    adName: string;
    createTime: string;
  }

  const results: Result[] = [];
  for (const [lpCr, spendData] of crSpend) {
    const att = crAttendance.get(lpCr) || { attended: 0, reserved: 0, optins: 0 };
    results.push({
      lpCr,
      spend: spendData.totalSpend,
      optins: att.optins,
      reserved: att.reserved,
      attended: att.attended,
      cpo: att.attended > 0 ? spendData.totalSpend / att.attended : null,
      accounts: spendData.accounts,
      adName: spendData.adName,
      createTime: spendData.createTime,
    });
  }

  // spend降順
  results.sort((a, b) => b.spend - a.spend);

  for (const r of results) {
    const cpoStr = r.cpo !== null ? `¥${Math.round(r.cpo).toLocaleString()}` : '∞（着座0）';
    const warn = (r.cpo === null && r.spend >= 30000) ? '🔴 停止候補' : (r.cpo === null && r.spend > 0) ? '⚠️' : '';

    console.log(`${warn} ${r.lpCr} [出稿${r.createTime}]`);
    console.log(`  セミナー着座CPO: ${cpoStr}`);
    console.log(`  ファネル: オプト${r.optins} → セミナー予約${r.reserved} → 着座${r.attended}`);
    console.log(`  7日広告費: ¥${Math.round(r.spend).toLocaleString()}`);
    console.log(`  アカウント: ${r.accounts.join(', ')}`);
    console.log(`  広告名: ${r.adName}`);
    console.log('');
  }

  // 集計
  const totalSpend = results.reduce((s, r) => s + r.spend, 0);
  const totalAttended = results.reduce((s, r) => s + r.attended, 0);
  const stopCandidates = results.filter(r => r.cpo === null && r.spend >= 30000);

  console.log('--- 集計 ---');
  console.log(`出稿CR数: ${results.length}`);
  console.log(`総広告費: ¥${Math.round(totalSpend).toLocaleString()}`);
  console.log(`総着座数: ${totalAttended}`);
  if (totalAttended > 0) {
    console.log(`全体平均着座CPO: ¥${Math.round(totalSpend / totalAttended).toLocaleString()}`);
  }
  console.log(`🔴 停止候補（¥30,000+消化 & 着座0）: ${stopCandidates.length}件`);
  if (stopCandidates.length > 0) {
    for (const r of stopCandidates) {
      console.log(`  ${r.lpCr} - ¥${Math.round(r.spend).toLocaleString()} / ${r.adName}`);
    }
  }
}

main().catch(console.error);
