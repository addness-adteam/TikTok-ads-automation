import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const prisma = new PrismaClient();
const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });

async function main() {
  // 1. Check some ad names in DB to understand CR naming
  console.log('=== Sample Ad Names from DB ===');
  const sampleAds = await prisma.ad.findMany({
    take: 20,
    orderBy: { createdAt: 'desc' },
    select: { name: true, tiktokId: true, creativeId: true },
  });
  sampleAds.forEach(ad => console.log(`  ${ad.name}`));

  // 2. Check ad names containing "CR" pattern
  console.log('\n=== Ads with CR in name (sample) ===');
  const crAds = await prisma.ad.findMany({
    where: { name: { contains: 'CR0' } },
    take: 20,
    select: { name: true, tiktokId: true },
    orderBy: { createdAt: 'desc' },
  });
  crAds.forEach(ad => console.log(`  ${ad.name} (${ad.tiktokId})`));

  // 3. Check creative URLs to understand video link structure
  console.log('\n=== Sample Creatives (with video) ===');
  const creatives = await prisma.creative.findMany({
    where: { type: 'VIDEO' },
    take: 5,
    select: { id: true, name: true, url: true, tiktokVideoId: true, type: true },
    orderBy: { createdAt: 'desc' },
  });
  creatives.forEach(c => console.log(`  name=${c.name}, url=${c.url}, videoId=${c.tiktokVideoId}`));

  // 4. Check a full ad with creative
  console.log('\n=== Full Ad with Creative (sample) ===');
  const fullAd = await prisma.ad.findFirst({
    where: { name: { contains: 'CR0' } },
    include: { creative: true, adGroup: { include: { campaign: { include: { advertiser: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
  if (fullAd) {
    console.log(`  Ad: ${fullAd.name}`);
    console.log(`  Creative URL: ${fullAd.creative.url}`);
    console.log(`  Creative type: ${fullAd.creative.type}`);
    console.log(`  TikTok Video ID: ${fullAd.creative.tiktokVideoId}`);
    console.log(`  Advertiser: ${fullAd.adGroup.campaign.advertiser.name} (${fullAd.adGroup.campaign.advertiser.tiktokAdvertiserId})`);
  }

  // 5. Look at a few opt-in rows to understand registration path patterns
  console.log('\n=== AI Opt-in: Registration Path Patterns (TT only) ===');
  const aiOptinSheetId = '1FlTEktuSWOZce8h92foKoh5p8wCFFgZVM9ePqIRnUKk';
  const aiOptin = await sheets.spreadsheets.values.get({
    spreadsheetId: aiOptinSheetId,
    range: 'TT_オプト!A1:F50',
  });
  const aiRows = aiOptin.data.values || [];
  const pathsAI = new Set<string>();
  for (let i = 1; i < aiRows.length; i++) {
    const regPath = aiRows[i]?.[4]; // E column = ファネル登録経路
    if (regPath && regPath.includes('TT')) {
      pathsAI.add(regPath);
    }
  }
  console.log(`  Unique TT paths (first 50 rows): ${pathsAI.size}`);
  pathsAI.forEach(p => console.log(`    ${p}`));

  // 6. Check SNS opt-in patterns
  console.log('\n=== SNS Opt-in: Registration Path Patterns (TT only) ===');
  const snsOptinSheetId = '1JlEC8rQAM3h2E7GuUplMPrLyVdA5Q3nZ0lGneC2nZvY';
  const snsOptin = await sheets.spreadsheets.values.get({
    spreadsheetId: snsOptinSheetId,
    range: 'TT_オプト!A1:F50',
  });
  const snsRows = snsOptin.data.values || [];
  const pathsSNS = new Set<string>();
  for (let i = 1; i < snsRows.length; i++) {
    const regPath = snsRows[i]?.[4]; // E column
    if (regPath && regPath.includes('TT')) {
      pathsSNS.add(regPath);
    }
  }
  console.log(`  Unique TT paths (first 50 rows): ${pathsSNS.size}`);
  pathsSNS.forEach(p => console.log(`    ${p}`));

  // 7. Check total count of unique registration paths
  console.log('\n=== All unique TT paths from AI opt-in ===');
  const aiOptinAll = await sheets.spreadsheets.values.get({
    spreadsheetId: aiOptinSheetId,
    range: 'TT_オプト!E:E',
  });
  const allAiPaths = new Set<string>();
  (aiOptinAll.data.values || []).slice(1).forEach(row => {
    if (row[0] && row[0].includes('TT')) allAiPaths.add(row[0]);
  });
  console.log(`  Total unique TT paths: ${allAiPaths.size}`);
  allAiPaths.forEach(p => console.log(`    ${p}`));

  await prisma.$disconnect();
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); });
