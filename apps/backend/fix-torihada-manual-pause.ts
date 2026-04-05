import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

async function main() {
  // TORIHADAの停止漏れ2件
  const targetTiktokIds = [
    '1860553655497858', // AI学べば稼げる
    '1860536147210561', // ハリポタトレースTORIHADAVer
  ];

  for (const tiktokId of targetTiktokIds) {
    // TikTok APIで現在のステータスを取得
    const ad = await prisma.ad.findUnique({
      where: { tiktokId },
      include: { adGroup: { include: { campaign: true } } },
    });
    if (!ad) {
      console.log(`Ad ${tiktokId} not found in DB`);
      continue;
    }

    const advertiserId = ad.adGroup.campaign.advertiserId;
    const advertiser = await prisma.advertiser.findUnique({ where: { id: advertiserId } });
    if (!advertiser) continue;

    // TikTok APIから最新ステータス取得
    const resp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/ad/get/', {
      headers: { 'Access-Token': ACCESS_TOKEN },
      params: {
        advertiser_id: advertiser.tiktokAdvertiserId,
        filtering: JSON.stringify({ ad_ids: [tiktokId] }),
        fields: JSON.stringify(['ad_id', 'ad_name', 'operation_status']),
      },
    });

    const apiAd = resp.data?.data?.list?.[0];
    const apiStatus = apiAd?.operation_status || 'UNKNOWN';
    console.log(`[${ad.name}] DB: ${ad.status} → API: ${apiStatus}`);

    if (apiStatus.includes('DISABLE') && !ad.status.includes('DISABLE')) {
      // DB更新
      await prisma.ad.update({
        where: { tiktokId },
        data: { status: apiStatus },
      });

      // ChangeLog記録
      await prisma.changeLog.create({
        data: {
          entityType: 'AD',
          entityId: tiktokId,
          action: 'PAUSE',
          source: 'MANUAL',
          reason: `手動停止検知 (${ad.status} → ${apiStatus})`,
          beforeData: { status: ad.status },
          afterData: { status: apiStatus },
        },
      });
      console.log(`  → DB更新 & ChangeLog記録完了`);
    } else if (apiStatus === ad.status) {
      console.log(`  → TikTok APIでもまだ ${apiStatus}。本当にTikTok管理画面で停止済み？`);
    } else {
      console.log(`  → ステータス: ${apiStatus}（DISABLE系ではない）`);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
