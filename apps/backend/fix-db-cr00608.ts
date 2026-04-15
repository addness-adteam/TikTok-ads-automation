import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });
import { PrismaClient } from '@prisma/client';

async function main() {
  const p = new PrismaClient();
  const adv = await p.advertiser.findFirst({ where: { tiktokAdvertiserId: '7474920444831875080' } });
  if (!adv) throw new Error('SP1 not found');

  // キャンペーン
  let camp = await p.campaign.findFirst({ where: { tiktokId: '1862063400838209' } });
  if (camp) console.log('キャンペーン既存:', camp.id);

  // adGroup
  let ag = await p.adGroup.findFirst({ where: { tiktokId: '1862063400838225' } });
  if (ag) console.log('広告グループ既存:', ag.id);

  // creative（ダミー）
  let creative = await p.creative.findFirst({ where: { name: 'CR00608-smartplus' } });
  if (!creative) {
    creative = await p.creative.create({
      data: {
        advertiserId: adv.id,
        name: 'CR00608-smartplus',
        type: 'VIDEO',
        url: '',
        filename: 'smartplus-multi-video',
      },
    });
    console.log('Creative作成:', creative.id);
  }

  // ad
  if (camp && ag) {
    let ad = await p.ad.findFirst({ where: { tiktokId: '1862063400842561' } });
    if (!ad) {
      ad = await p.ad.create({
        data: {
          tiktokId: '1862063400842561',
          name: '260411/セミ/スマ/セミまとめ(CVポイント検証)再出稿/LP2-CR00608',
          adgroupId: ag.id,
          creativeId: creative.id,
          status: 'ENABLE',
        },
      });
      console.log('広告作成:', ad.id);
    } else {
      console.log('広告既存:', ad.id);
    }
  }

  console.log('DB登録完了');
  await p.$disconnect();
}
main().catch(console.error);
