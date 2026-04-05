/**
 * 広告作成のみ（前回のキャンペーン/広告グループを再利用）
 * video_cover_urlからサムネイル画像をアップロードしてimage_idsに指定
 */
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import FormData from 'form-data';

const prisma = new PrismaClient();
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const TARGET_ADVERTISER = '7580666710525493255';

async function main() {
  const t = await prisma.oAuthToken.findUnique({ where: { advertiserId: TARGET_ADVERTISER } });
  if (!t) return;
  const accessToken = t.accessToken;

  const newVideoId = 'v10033g50000d6spdmfog65hgcq326lg';
  const adgroupId = '1859933174826081';

  // Step 1: カバー画像をダウンロード
  console.log('Step 1: カバー画像ダウンロード...');
  const videoResp = await fetch(
    `${TIKTOK_API_BASE}/v1.3/file/video/ad/info/?advertiser_id=${TARGET_ADVERTISER}&video_ids=${encodeURIComponent(JSON.stringify([newVideoId]))}`,
    { headers: { 'Access-Token': accessToken } },
  );
  const videoData = await videoResp.json();
  const videoList = videoData.data?.list || (Array.isArray(videoData.data) ? videoData.data : []);
  const coverUrl = videoList[0]?.video_cover_url;
  console.log(`  cover_url: ${coverUrl?.substring(0, 80)}`);

  const coverResp = await axios.get(coverUrl, { responseType: 'arraybuffer', timeout: 30000 });
  const coverBuffer = Buffer.from(coverResp.data);
  console.log(`  カバー画像: ${(coverBuffer.length / 1024).toFixed(1)}KB`);

  // Step 2: サムネイル画像としてアップロード
  console.log('\nStep 2: サムネイル画像アップロード...');
  const { createHash } = await import('crypto');
  const imgSignature = createHash('md5').update(coverBuffer).digest('hex');
  const imgFormData = new FormData();
  imgFormData.append('advertiser_id', TARGET_ADVERTISER);
  imgFormData.append('upload_type', 'UPLOAD_BY_FILE');
  imgFormData.append('image_signature', imgSignature);
  imgFormData.append('image_file', coverBuffer, { filename: `thumb_${Date.now()}.jpg`, contentType: 'image/jpeg' });

  const imgResp = await axios.post(`${TIKTOK_API_BASE}/v1.3/file/image/ad/upload/`, imgFormData, {
    headers: { 'Access-Token': accessToken, ...imgFormData.getHeaders() },
    timeout: 30000,
  });
  console.log('  レスポンス:', JSON.stringify(imgResp.data, null, 2));
  const imageId = imgResp.data.data?.image_id;
  console.log(`  image_id: ${imageId}`);

  if (!imageId) { console.log('  画像アップロード失敗'); return; }

  // Step 3: 広告作成
  console.log('\nStep 3: 広告作成...');
  const adName = '260318/千葉信輝/横展開テスト/LP1-CR01071';
  const landingPageUrl = 'https://school.addness.co.jp/p/r2RHcL0PdGIY?ftid=TgRcBroZROsY&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid';
  const adText = 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）';

  const adResp = await axios.post(`${TIKTOK_API_BASE}/v1.3/ad/create/`, {
    advertiser_id: TARGET_ADVERTISER,
    adgroup_id: adgroupId,
    creatives: [{
      ad_name: adName,
      ad_text: adText,
      ad_format: 'SINGLE_VIDEO',
      video_id: newVideoId,
      image_ids: [imageId],
      identity_id: '6fac7e18-0297-5ad3-9849-1de69197cd95',
      identity_type: 'BC_AUTH_TT',
      identity_authorized_bc_id: '7440019834009829392',
      call_to_action: 'LEARN_MORE',
      landing_page_url: landingPageUrl,
    }],
  }, { headers: { 'Access-Token': accessToken } });

  console.log('  レスポンス:', JSON.stringify(adResp.data, null, 2));

  if (adResp.data.code === 0) {
    const adId = adResp.data.data?.ad_ids?.[0] || adResp.data.data?.ad_id;
    console.log(`\n=== 広告作成成功! ad_id: ${adId} ===`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
