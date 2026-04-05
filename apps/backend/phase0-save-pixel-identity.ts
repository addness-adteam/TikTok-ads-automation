/**
 * P1-3: P0-6で取得したpixel_id/identity_idをAdvertiserテーブルに保存
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const accountData = [
  { id: '7468288053866561553', name: 'AI_1', pixelId: '7395091852346654737', identityId: '6fac7e18-0297-5ad3-9849-1de69197cd95' },
  { id: '7523128243466551303', name: 'AI_2', pixelId: '7395091852346654737', identityId: '6fac7e18-0297-5ad3-9849-1de69197cd95' },
  { id: '7543540647266074641', name: 'AI_3', pixelId: '7543912551630061575', identityId: '6fac7e18-0297-5ad3-9849-1de69197cd95' },
  { id: '7580666710525493255', name: 'AI_4', pixelId: '7580671757758464018', identityId: '6fac7e18-0297-5ad3-9849-1de69197cd95' },
  { id: '7474920444831875080', name: 'SP1', pixelId: '7545348380013199368', identityId: '6fac7e18-0297-5ad3-9849-1de69197cd95' },
  { id: '7592868952431362066', name: 'SP2', pixelId: '7606956193143210002', identityId: '55fc7dd2-572d-5945-8363-0b45f294473c' },
  { id: '7247073333517238273', name: 'SNS1', pixelId: '7388088697557663760', identityId: '6fac7e18-0297-5ad3-9849-1de69197cd95' },
  { id: '7543540100849156112', name: 'SNS2', pixelId: '7388088697557663760', identityId: '6fac7e18-0297-5ad3-9849-1de69197cd95' },
  { id: '7543540381615800337', name: 'SNS3', pixelId: '7543909365699461128', identityId: '6fac7e18-0297-5ad3-9849-1de69197cd95' },
];

async function main() {
  for (const acc of accountData) {
    const result = await prisma.advertiser.update({
      where: { tiktokAdvertiserId: acc.id },
      data: { pixelId: acc.pixelId, identityId: acc.identityId },
    });
    console.log(`✅ ${acc.name}: pixelId=${result.pixelId}, identityId=${result.identityId}`);
  }
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
