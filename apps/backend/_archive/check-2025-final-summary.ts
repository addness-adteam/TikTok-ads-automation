/**
 * 2025年 最終サマリー
 * - CR単位: CV, フロント, 個別予約（AI/SNS）
 * - チャネル単位: 支出, 個別予約CPO
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
const START_DATE = new Date(2025, 0, 1);
const END_DATE = new Date(2026, 0, 1);

// アカウントIDとチャネルのマッピング
const ACCOUNT_CHANNEL: Record<string, string> = {
  '7468288053866561553': 'AI',   // AI_1
  '7523128243466551303': 'AI',   // AI_2
  '7543540647266074641': 'AI',   // AI_3
  '7580666710525493255': 'AI',   // AI_4
  '7247073333517238273': 'SNS',  // SNS1
  '7543540100849156112': 'SNS',  // SNS2
  '7543540381615800337': 'SNS',  // SNS3
  '7474920444831875080': 'SP',   // SP1
  '7592868952431362066': 'SP',   // SP2
};

function parseDate(dateString: string): Date | null {
  if (!dateString) return null;
  const match = dateString.trim().match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!match) return null;
  return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
}

async function main() {
  // ===== 1. チャネル別支出（2025年） =====
  console.log('=== チャネル別支出（2025年） ===\n');

  const advertisers = await prisma.advertiser.findMany();
  const channelSpend: Record<string, number> = { AI: 0, SNS: 0, SP: 0 };

  for (const adv of advertisers) {
    const channel = ACCOUNT_CHANNEL[adv.tiktokAdvertiserId];
    if (!channel) continue;

    const spend = await prisma.metric.aggregate({
      where: {
        entityType: 'AD',
        ad: { adGroup: { campaign: { advertiserId: adv.id } } },
        statDate: { gte: START_DATE, lt: END_DATE },
      },
      _sum: { spend: true },
    });
    const s = spend._sum.spend || 0;
    channelSpend[channel] += s;
    console.log(`  ${adv.name || adv.tiktokAdvertiserId}: ¥${Math.round(s).toLocaleString()}`);
  }

  console.log(`\n  AI合計: ¥${Math.round(channelSpend.AI).toLocaleString()}`);
  console.log(`  SNS合計: ¥${Math.round(channelSpend.SNS).toLocaleString()}`);
  console.log(`  SP合計: ¥${Math.round(channelSpend.SP).toLocaleString()}`);
  console.log(`  全体: ¥${Math.round(channelSpend.AI + channelSpend.SNS + channelSpend.SP).toLocaleString()}`);

  // ===== 2. 個別予約（流入経路ベース） =====
  console.log('\n=== 個別予約（流入経路ベース・2025年） ===\n');

  const resData = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: RES_SPREADSHEET_ID,
    range: "'シート1'!A:H",
  });
  const resRows = resData.data.values || [];

  // 流入経路 → チャネルマッピング
  const inflowToChannel: Record<string, string> = {
    'TikTok広告_AI': 'AI',
    'TikTok広告_センサーズ': 'SNS',
    'TikTok_みかみメイン': 'SNS',
    'TikTok広告_スキルプラス': 'SP',
    'TikTok_スキルプラス': 'SP',
    'TikTok広告_デザジュク': 'OTHER',
    'TikTok広告_直個別': 'OTHER',
  };

  const channelRes: Record<string, number> = { AI: 0, SNS: 0, SP: 0, OTHER: 0 };

  for (let i = 1; i < resRows.length; i++) {
    const row = resRows[i];
    const dateValue = String(row[0] || '');
    const inflow = String(row[2] || '').trim();
    const rowDate = parseDate(dateValue);
    if (!rowDate || rowDate < START_DATE || rowDate >= END_DATE) continue;

    const channel = inflowToChannel[inflow];
    if (channel) {
      channelRes[channel]++;
    }
  }

  console.log(`  AI: ${channelRes.AI}件`);
  console.log(`  SNS: ${channelRes.SNS}件`);
  console.log(`  SP: ${channelRes.SP}件`);
  console.log(`  OTHER: ${channelRes.OTHER}件`);

  // ===== 3. チャネル別 個別予約CPO =====
  console.log('\n=== チャネル別 個別予約CPO（2025年） ===\n');

  for (const ch of ['AI', 'SNS', 'SP']) {
    const spend = channelSpend[ch];
    const res = channelRes[ch];
    const cpo = res > 0 ? Math.round(spend / res) : null;
    console.log(`  ${ch}: 支出=¥${Math.round(spend).toLocaleString()} / 個別予約=${res}件 → CPO=${cpo ? `¥${cpo.toLocaleString()}` : 'N/A'}`);
  }

  // ===== 4. 許容値との比較 =====
  console.log('\n=== KPI比較 ===\n');
  const appeals = await prisma.appeal.findMany();
  for (const appeal of appeals) {
    const ch = appeal.name === 'AI' ? 'AI' : appeal.name === 'SNS' ? 'SNS' : 'SP';
    const spend = channelSpend[ch];
    const res = channelRes[ch];
    const cpo = res > 0 ? Math.round(spend / res) : null;
    const allowable = appeal.allowableIndividualReservationCPO;
    const met = cpo && allowable ? cpo <= allowable : false;
    console.log(`  ${appeal.name}: 個別予約CPO=¥${cpo?.toLocaleString() || 'N/A'} vs 許容=¥${allowable?.toLocaleString() || 'N/A'} → ${met ? '✅達成' : '❌未達'}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
