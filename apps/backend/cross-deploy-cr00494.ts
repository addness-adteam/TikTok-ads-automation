import * as dotenv from 'dotenv';
dotenv.config();

const API = 'https://tik-tok-ads-automation-backend.vercel.app';

// SP1 → SP2 横展開: CR00494（急募メモ②）= 動画20本 + 画像1枚の混合Smart+広告
async function main() {
  // まずpreview
  console.log('=== Preview ===');
  const previewUrl = `${API}/api/cross-deploy/preview?sourceAdvertiserId=7474920444831875080&sourceAdId=1859608524699041`;
  const previewResp = await fetch(previewUrl);
  const preview = await previewResp.json() as any;
  console.log('Status:', previewResp.status);
  console.log('Ad name:', preview.adName);
  console.log('Ad format:', preview.adFormat);
  console.log('Video count:', preview.videoCount);
  console.log('Image count:', preview.imageCount);
  console.log('Image IDs:', preview.imageIds);

  // deploy (SMART_PLUS: 動画+画像を全て含めて1広告)
  console.log('\n=== Deploy ===');
  const deployResp = await fetch(`${API}/api/cross-deploy/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceAdvertiserId: '7474920444831875080',
      sourceAdId: '1859608524699041',
      targetAdvertiserIds: ['7592868952431362066'], // SP2
      mode: 'SMART_PLUS',
      dailyBudget: 5000,
    }),
  });
  const result = await deployResp.text();
  console.log('Status:', deployResp.status);
  console.log('Result:', result.slice(0, 2000));
}
main();
