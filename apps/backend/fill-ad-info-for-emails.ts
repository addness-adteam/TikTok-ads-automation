/**
 * メールアドレスに対応する広告CRの登録経路を入れるスクリプト
 *
 * 流れ:
 * 1. ターゲットシート (マスターデータ_AI / マスターデータ_SNS) のE列からメールを取得
 * 2. F列に既に値がある行はスキップ
 * 3. オプトインシート (TT_オプト) でメールを検索 → ファネル登録経路を取得
 * 4. 登録経路からCR番号を抽出 (例: CR376 → CR00376, CR00511はそのまま)
 * 5. DBで広告名にCR番号を含む広告を検索
 * 6. 広告名をF列、動画リンク(HYPERLINK)をG列に書き込み
 */

import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const prisma = new PrismaClient();
const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheetsApi = google.sheets({ version: 'v4', auth });

const TARGET_SHEET_ID = '1h--o9lmiCoBRM-lyB998n1H1Lep795T-NupK2ifo0eA';
const AI_OPTIN_SHEET_ID = '1FlTEktuSWOZce8h92foKoh5p8wCFFgZVM9ePqIRnUKk';
const SNS_OPTIN_SHEET_ID = '1JlEC8rQAM3h2E7GuUplMPrLyVdA5Q3nZ0lGneC2nZvY';
const TIKTOK_API_BASE = process.env.TIKTOK_API_BASE_URL || 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '';

// Account IDs
const AI_ACCOUNT_IDS = [
  '7468288053866561553', // AI_1
  '7523128243466551303', // AI_2
  '7543540647266074641', // AI_3
  '7580666710525493255', // AI_4
];
const SNS_ACCOUNT_IDS = [
  '7247073333517238273', // SNS_1
  '7543540381615800337', // SNS1
];
const SEMINAR_ACCOUNT_IDS = [
  '7474920444831875080', // スキルプラス1
  '7592868952431362066', // スキルプラス2
];

interface EmailCRMapping {
  email: string;
  registrationPath: string;
  crNumber: string; // e.g., "CR00376"
  rowIndex: number;
}

interface AdInfo {
  adName: string;
  tiktokVideoId: string | null;
  advertiserId: string;
}

/**
 * 登録経路かどうかを判定 (URLやただの日付は除外)
 * TikTok関連の登録経路パターン:
 * - "TikTok広告-AI-LP1-CR00511" (新形式)
 * - "AIカレッジTT_optinB CV　CR376" (旧形式)
 * - "3垢_センサーズTT_簡潔LP　コンバージョン　CR380" (旧形式)
 */
function isTikTokRegistrationPath(value: string): boolean {
  if (!value || value.startsWith('http')) return false;
  // CR番号を含む + TikTokまたはTTを含む
  if (/CR\d+/.test(value) && (/TikTok/i.test(value) || /TT[_\s]/.test(value))) {
    return true;
  }
  return false;
}

/**
 * オプトインシートからメール→登録経路のマッピングを構築
 * 列位置がずれている場合にも対応: 全列をスキャンしてメールと登録経路を探す
 */
async function buildEmailToPathMap(
  sheetId: string,
): Promise<Map<string, string>> {
  console.log(`  Loading opt-in sheet ${sheetId}...`);
  const response = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'TT_オプト!A:J',
  });
  const rows = response.data.values || [];
  console.log(`  Total rows: ${rows.length}`);

  const emailToPath = new Map<string, string>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    // メールアドレスを全列から探す
    let email = '';
    for (let j = 0; j < Math.min(row.length, 4); j++) {
      const val = (row[j] || '').trim().toLowerCase();
      if (val.includes('@') && val.includes('.') && !val.startsWith('http')) {
        email = val;
        break;
      }
    }
    if (!email) continue;

    // 登録経路を全列から探す（CR番号 + TikTok/TT を含む値）
    let regPath = '';
    for (let j = 0; j < row.length; j++) {
      const val = (row[j] || '').trim();
      if (isTikTokRegistrationPath(val)) {
        regPath = val;
        break;
      }
    }
    if (!regPath) continue;

    // 最初の一致を使用（同じメールが複数回登録されている場合）
    if (!emailToPath.has(email)) {
      emailToPath.set(email, regPath);
    }
  }
  console.log(`  Emails with TikTok paths: ${emailToPath.size}`);
  return emailToPath;
}

/**
 * 登録経路からCR番号を抽出し、5桁ゼロ埋め形式に変換
 * 例: "AIカレッジTT_optinB CV　CR376" → "CR00376"
 * 例: "TikTok広告-AI-LP1-CR00511" → "CR00511" (既に5桁)
 */
function extractCRNumber(registrationPath: string): string | null {
  const match = registrationPath.match(/CR(\d+)/);
  if (!match) return null;
  const num = match[1];
  return `CR${num.padStart(5, '0')}`;
}

/**
 * DBから全広告をプリロード（CR番号→広告情報のマッピング）
 * 全アカウントから取得
 */
async function buildCRToAdMap(accountIds: string[]): Promise<Map<string, AdInfo>> {
  console.log(`  Loading ads from DB for ${accountIds.length} accounts...`);

  const ads = await prisma.ad.findMany({
    where: {
      adGroup: {
        campaign: {
          advertiser: {
            tiktokAdvertiserId: { in: accountIds },
          },
        },
      },
    },
    include: {
      creative: {
        select: { tiktokVideoId: true, type: true },
      },
      adGroup: {
        include: {
          campaign: {
            include: {
              advertiser: {
                select: { tiktokAdvertiserId: true },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`  Total ads loaded: ${ads.length}`);

  // CR番号→広告のマッピング（最新の広告を優先）
  const crToAd = new Map<string, AdInfo>();
  for (const ad of ads) {
    // 広告名からCR番号を抽出（末尾のLP-CR形式、例: LP2-CR00216）
    const crMatch = ad.name.match(/(CR\d{5})$/);
    if (!crMatch) continue;
    const crKey = crMatch[1];

    if (crToAd.has(crKey)) continue;

    crToAd.set(crKey, {
      adName: ad.name,
      tiktokVideoId: ad.creative?.tiktokVideoId || null,
      advertiserId: ad.adGroup.campaign.advertiser.tiktokAdvertiserId,
    });
  }

  console.log(`  Unique CR numbers in ads: ${crToAd.size}`);
  return crToAd;
}

/**
 * TikTok APIから動画のプレビューURLをバッチ取得
 */
async function getVideoUrls(
  advertiserToVideoIds: Map<string, string[]>,
): Promise<Map<string, string>> {
  const videoUrlMap = new Map<string, string>();

  for (const [advertiserId, vIds] of advertiserToVideoIds) {
    // 重複除去
    const uniqueIds = [...new Set(vIds)];
    for (let i = 0; i < uniqueIds.length; i += 60) {
      const batch = uniqueIds.slice(i, i + 60);
      try {
        const response = await axios.get(`${TIKTOK_API_BASE}/v1.3/file/video/ad/info/`, {
          params: {
            advertiser_id: advertiserId,
            video_ids: JSON.stringify(batch),
          },
          headers: { 'Access-Token': ACCESS_TOKEN },
        });

        const list = response.data?.data?.list || [];
        for (const item of list) {
          const url = item.preview_url || item.video_url || item.preview_url_expire_time ? item.preview_url : null;
          if (item.video_id && url) {
            videoUrlMap.set(item.video_id, url);
          }
        }
        console.log(`  Got ${list.length} video URLs for advertiser ${advertiserId} (batch ${Math.floor(i / 60) + 1})`);
      } catch (e: any) {
        console.error(`  Error getting video URLs for ${advertiserId}:`, e.message);
      }
    }
  }

  return videoUrlMap;
}

/**
 * メインのシート処理
 */
async function processSheet(
  sheetName: string,
  optinSheetId: string,
  accountIds: string[],
) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing: ${sheetName}`);
  console.log(`${'='.repeat(60)}`);

  // 1. ターゲットシートのデータを読み込み
  console.log('\n[Step 1] Reading target sheet...');
  const targetResponse = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: TARGET_SHEET_ID,
    range: `'${sheetName}'!A:J`,
  });
  const targetRows = targetResponse.data.values || [];
  console.log(`  Total rows: ${targetRows.length}`);

  // 処理対象行を特定（E列にメールあり、F列が空）
  const targetEmails: EmailCRMapping[] = [];
  for (let i = 1; i < targetRows.length; i++) {
    const row = targetRows[i];
    const email = (row[4] || '').trim().toLowerCase(); // E列 (index 4)
    const existingAdName = (row[5] || '').trim(); // F列 (index 5)

    if (!email || !email.includes('@')) continue;
    if (existingAdName) continue;

    targetEmails.push({
      email,
      registrationPath: '',
      crNumber: '',
      rowIndex: i,
    });
  }
  console.log(`  Emails to process (F column empty): ${targetEmails.length}`);

  if (targetEmails.length === 0) {
    console.log('  No emails to process, skipping.');
    return;
  }

  // 2. オプトインシートからメール→登録経路マッピングを構築
  console.log('\n[Step 2] Building email → registration path mapping...');
  const emailToPath = await buildEmailToPathMap(optinSheetId);

  // 3. 各メールの登録経路とCR番号を特定
  console.log('\n[Step 3] Matching emails to registration paths...');
  let matchedCount = 0;
  let noMatchCount = 0;
  for (const entry of targetEmails) {
    const regPath = emailToPath.get(entry.email);
    if (regPath) {
      entry.registrationPath = regPath;
      const cr = extractCRNumber(regPath);
      if (cr) {
        entry.crNumber = cr;
        matchedCount++;
      } else {
        noMatchCount++;
      }
    } else {
      noMatchCount++;
    }
  }
  console.log(`  Matched with CR: ${matchedCount}, No match: ${noMatchCount}`);

  const matched = targetEmails.filter(e => e.crNumber);
  if (matched.length === 0) {
    console.log('  No matched entries, skipping.');
    return;
  }

  // 4. DBから広告情報を取得（全アカウント）
  console.log('\n[Step 4] Loading ads from DB...');
  const allAccountIds = [...new Set([...accountIds, ...SEMINAR_ACCOUNT_IDS])];
  const crToAd = await buildCRToAdMap(allAccountIds);

  // 5. マッチ結果を確認
  console.log('\n[Step 5] Matching CR numbers to ads...');
  let adMatchCount = 0;
  const adMatchResults: Array<{
    rowIndex: number;
    email: string;
    registrationPath: string;
    crNumber: string;
    adName: string;
    tiktokVideoId: string | null;
    advertiserId: string;
  }> = [];

  for (const entry of matched) {
    const adInfo = crToAd.get(entry.crNumber);
    if (adInfo) {
      adMatchCount++;
      adMatchResults.push({
        rowIndex: entry.rowIndex,
        email: entry.email,
        registrationPath: entry.registrationPath,
        crNumber: entry.crNumber,
        adName: adInfo.adName,
        tiktokVideoId: adInfo.tiktokVideoId,
        advertiserId: adInfo.advertiserId,
      });
    }
  }
  console.log(`  Ads found: ${adMatchCount} / ${matched.length}`);

  // CRが見つからなかったもののサンプル
  const notFound = matched.filter(e => !crToAd.has(e.crNumber));
  if (notFound.length > 0) {
    console.log(`  CR numbers not found in DB (sample):`);
    const uniqueNotFoundCR = [...new Set(notFound.map(e => `${e.crNumber} (from: ${e.registrationPath.substring(0, 60)})`))];
    uniqueNotFoundCR.slice(0, 10).forEach(cr => console.log(`    ${cr}`));
  }

  // 6. TikTok APIから動画URLを取得
  console.log('\n[Step 6] Getting video preview URLs from TikTok API...');
  const advertiserToVideoIds = new Map<string, string[]>();
  for (const result of adMatchResults) {
    if (!result.tiktokVideoId) continue;
    const existing = advertiserToVideoIds.get(result.advertiserId) || [];
    existing.push(result.tiktokVideoId);
    advertiserToVideoIds.set(result.advertiserId, existing);
  }

  const videoUrlMap = await getVideoUrls(advertiserToVideoIds);
  console.log(`  Video URLs obtained: ${videoUrlMap.size}`);

  // 7. スプレッドシートに書き込み
  console.log('\n[Step 7] Writing results to spreadsheet...');
  const batchData: { range: string; values: string[][] }[] = [];

  for (const result of adMatchResults) {
    const rowNum = result.rowIndex + 1;
    const videoUrl = result.tiktokVideoId ? videoUrlMap.get(result.tiktokVideoId) || '' : '';

    // F列に広告名
    batchData.push({
      range: `'${sheetName}'!F${rowNum}`,
      values: [[result.adName]],
    });

    // G列に動画リンク（ハイパーリンク形式）
    if (videoUrl) {
      batchData.push({
        range: `'${sheetName}'!G${rowNum}`,
        values: [[`=HYPERLINK("${videoUrl}","動画リンク")`]],
      });
    }
  }

  // 登録経路は見つかったがDBに広告がないもの → F列に「広告なし (登録経路)」
  for (const entry of notFound) {
    const rowNum = entry.rowIndex + 1;
    batchData.push({
      range: `'${sheetName}'!F${rowNum}`,
      values: [[`広告なし (${entry.registrationPath})`]],
    });
  }

  // バッチ更新
  if (batchData.length > 0) {
    await sheetsApi.spreadsheets.values.batchUpdate({
      spreadsheetId: TARGET_SHEET_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: batchData,
      },
    });
    console.log(`  Written to sheet: ${adMatchResults.length} ad matches + ${notFound.length} "広告なし" entries`);
  }

  // サマリー
  console.log(`\n[Summary for ${sheetName}]`);
  console.log(`  Total emails processed: ${targetEmails.length}`);
  console.log(`  Matched to opt-in with CR: ${matchedCount}`);
  console.log(`  Matched to ads in DB: ${adMatchCount}`);
  console.log(`  Not found in DB: ${notFound.length}`);
  console.log(`  No opt-in match at all: ${noMatchCount}`);
}

async function main() {
  console.log('Starting email → ad CR mapping script...\n');

  try {
    // AI導線
    await processSheet(
      'マスターデータ_AI',
      AI_OPTIN_SHEET_ID,
      AI_ACCOUNT_IDS,
    );

    // SNS導線
    await processSheet(
      'マスターデータ_SNS',
      SNS_OPTIN_SHEET_ID,
      SNS_ACCOUNT_IDS,
    );

    console.log('\n\nDone!');
  } catch (error: any) {
    console.error('Error:', error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

main();
