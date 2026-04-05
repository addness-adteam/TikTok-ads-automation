// TODO2実行: スキルプラス1の非効率広告を一括停止
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ADVERTISER_ID = '7474920444831875080'; // スキルプラス1

// 停止対象: CPA>¥6,000 (11本) + CV0で消化¥6,000超 (17本) = 28本
const PAUSE_TARGET_IDS = [
  // CPA > ¥6,000
  '1858733926506721',   // 林社長も絶賛-ニュース-長編 CPA:¥13,054
  '1858800334384177',   // おい会社員_ちえみさん CPA:¥10,298
  '1859149040871553',   // おい会社員/演出あり/冒頭1 CR00472 CPA:¥8,935
  '1859149352512945',   // おい会社員/演出あり/冒頭1 CR00473 CPA:¥8,648
  '1859349259442209',   // 1日2時間あったら CR00488 CPA:¥8,767
  '1859349901372770',   // 二極化2 CR00489 CPA:¥6,904
  '1859348480997393',   // AI副業の嘘セミナー CR00487 CPA:¥6,856
  '1859709464799409',   // 副業自信ない CR00496 CPA:¥7,109
  '1858545716416641',   // 1日2時間あったら CR00450 CPA:¥8,885
  '1858733902931985',   // 林社長も絶賛-ニュース-短編 CPA:¥8,828
  '1858348293725570',   // 1日2時間あったら CR00447 CPA:¥10,800
  // CV0 + 消化¥6,000超
  '1859208183913730',   // 新セミナーダイジェスト/トレンド_CTAなし 消化¥143k
  '1858932481921217',   // おい会社員まとめ CR00471 消化¥98k
  '1858932378268738',   // おい会社員まとめ CR00470 消化¥88k
  '1858925563208785',   // パパの脳内会議 消化¥85k
  '1859208183913762',   // 新セミナーダイジェスト/権威_CTAあり 消化¥48k
  '1859208183914562',   // 新セミナーダイジェスト/権威_CTAなし 消化¥43k
  '1859208183910610',   // 新セミナーダイジェスト/キャンペーン 消化¥42k
  '1859283866212353',   // おい会社員まとめ CR00479 消化¥39k
  '1859284583530993',   // おい会社員/演出あり CR00481 消化¥39k
  '1859603603641665',   // CVポイント検証 CR00492 消化¥16k
  '1859573305468002',   // 同じ1時間ー 消化¥12k
  '1859716791837825',   // 後悔書く 消化¥10k
  '1858643537311777',   // AI副業の嘘セミナー インスタ 消化¥10k
  '1858643781674417',   // AI副業の嘘2セミナー毎日投稿 消化¥8k
  '1858645592557729',   // これじゃなくてこれ① 消化¥8k
  '1859284150422962',   // はいそこまで 消化¥8k
  '1859284807518897',   // おい会社員_ちえみさん CR00482 消化¥7k
];

async function main() {
  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: ADVERTISER_ID },
  });
  if (!token) { console.error('Token not found'); return; }

  console.log(`=== スキルプラス1 非効率広告一括停止 ===`);
  console.log(`対象: ${PAUSE_TARGET_IDS.length}本`);

  // TikTok API has a limit of 20 ads per request, so batch
  const batchSize = 20;
  for (let i = 0; i < PAUSE_TARGET_IDS.length; i += batchSize) {
    const batch = PAUSE_TARGET_IDS.slice(i, i + batchSize);
    console.log(`\nバッチ ${Math.floor(i/batchSize) + 1}: ${batch.length}本`);

    const response = await fetch(`${TIKTOK_API_BASE}/v1.3/ad/status/update/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Token': token.accessToken,
      },
      body: JSON.stringify({
        advertiser_id: ADVERTISER_ID,
        ad_ids: batch,
        operation_status: 'DISABLE',
      }),
    });

    const result = await response.json();
    console.log('API Response:', JSON.stringify(result, null, 2));

    if (result.code === 0) {
      console.log(`✓ ${batch.length}本停止成功`);
    } else {
      console.error('API Error:', result.message);
    }

    // Wait between batches
    if (i + batchSize < PAUSE_TARGET_IDS.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Update DB
  for (const tiktokId of PAUSE_TARGET_IDS) {
    await prisma.ad.updateMany({
      where: { tiktokId },
      data: { status: 'DISABLE' },
    });
    await prisma.changeLog.create({
      data: {
        entityType: 'AD',
        entityId: tiktokId,
        action: 'PAUSE',
        source: 'MANUAL_OPTIMIZATION',
        reason: 'CPA超過/CV0の非効率広告を手動停止（TODO2: スキルプラス1立て直し）',
      },
    });
  }
  console.log('✓ DB更新・ChangeLog記録完了');

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
