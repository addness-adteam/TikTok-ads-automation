// TODO1実行: AI_3の非効率広告を一括停止
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ADVERTISER_ID = '7543540647266074641'; // AI_3

// 停止対象: CPA>¥4,032 or CV0で消化¥4,032超
const PAUSE_TARGET_IDS = [
  '1858653774232881',   // AIまとめ（勝ちCR) CPA:¥10,681
  '1858735903063041',   // スマ AIまとめ(ALL_tCPA) CPA:¥18,961
  '1858736944951553',   // スマ AIまとめ(林社長関連) CPA:¥10,778
  '1858632377271298',   // AIまとめ（休日ブースト) CPA:¥10,666
  '1858625479932002',   // AI副業の嘘2 CR00999 CPA:¥5,633
  '1858637324004497',   // AIまとめ（林さん関連) CV0 消化¥116k
  '1858823712221234',   // CR01009 CV0 消化¥24k
  '1859446465187921',   // CR01048 CV0 消化¥16k
  '1858631802378321',   // スマプラ/箕輪＆3兆円 CV0 消化¥7k
];

async function main() {
  // Get access token
  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: ADVERTISER_ID },
  });
  if (!token) { console.error('Token not found'); return; }

  console.log(`=== AI_3 非効率広告一括停止 ===`);
  console.log(`対象: ${PAUSE_TARGET_IDS.length}本`);
  console.log(`アクセストークン: ${token.accessToken.substring(0, 20)}...`);

  // TikTok API: ad/status/update
  const response = await fetch(`${TIKTOK_API_BASE}/v1.3/ad/status/update/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Access-Token': token.accessToken,
    },
    body: JSON.stringify({
      advertiser_id: ADVERTISER_ID,
      ad_ids: PAUSE_TARGET_IDS,
      operation_status: 'DISABLE',
    }),
  });

  const result = await response.json();
  console.log('API Response:', JSON.stringify(result, null, 2));

  if (result.code === 0) {
    console.log(`✓ ${PAUSE_TARGET_IDS.length}本の広告を停止しました`);

    // Update DB status
    for (const tiktokId of PAUSE_TARGET_IDS) {
      await prisma.ad.updateMany({
        where: { tiktokId },
        data: { status: 'DISABLE' },
      });
    }
    console.log('✓ DB更新完了');

    // Log changes
    for (const tiktokId of PAUSE_TARGET_IDS) {
      await prisma.changeLog.create({
        data: {
          entityType: 'AD',
          entityId: tiktokId,
          action: 'PAUSE',
          source: 'MANUAL_OPTIMIZATION',
          reason: 'CPA超過/CV0の非効率広告を手動停止（TODO1: AI_3立て直し）',
        },
      });
    }
    console.log('✓ ChangeLog記録完了');
  } else {
    console.error('API Error:', result.message);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
