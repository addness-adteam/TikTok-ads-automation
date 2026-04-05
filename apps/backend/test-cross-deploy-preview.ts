/**
 * P5-2: preview APIの動作確認
 * Smart+広告のフルデータ取得をテスト
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';

async function main() {
  const advertiserId = '7523128243466551303'; // AI_2
  const token = await prisma.oAuthToken.findUnique({ where: { advertiserId } });
  if (!token) { console.log('トークンなし'); return; }

  // まず1件Smart+広告を取得してIDを確認
  console.log('=== Smart+広告一覧（1件） ===');
  const listResp = await fetch(
    `${TIKTOK_API_BASE}/v1.3/smart_plus/ad/get/?advertiser_id=${advertiserId}&page_size=1`,
    { headers: { 'Access-Token': token.accessToken } },
  );
  const listResult = await listResp.json();
  const ad = listResult.data?.list?.[0];
  if (!ad) { console.log('Smart+広告なし'); return; }

  const adId = ad.smart_plus_ad_id;
  console.log(`Ad ID: ${adId}`);
  console.log(`Ad Name: ${ad.ad_name}`);

  // creative_listからvideo_idを確認
  console.log('\n=== creative_list video_id ===');
  const creativeList = ad.creative_list || [];
  const videoIds: string[] = [];
  for (const c of creativeList) {
    const vid = c?.creative_info?.video_info?.video_id;
    console.log(`  video_id: ${vid || 'N/A'}`);
    if (vid && vid !== 'N/A') videoIds.push(vid);
  }
  console.log(`有効なvideo_id: ${videoIds.length}本`);

  // 広告文
  console.log('\n=== 広告文 ===');
  for (const t of ad.ad_text_list || []) {
    console.log(`  ${t.ad_text}`);
  }

  // LP URL
  console.log('\n=== LP URL ===');
  for (const l of ad.landing_page_url_list || []) {
    console.log(`  ${l.landing_page_url}`);
  }

  // file/video/ad/info で動画ダウンロードURL確認
  if (videoIds.length > 0) {
    console.log('\n=== 動画ダウンロードURL確認 ===');
    const videoResp = await fetch(
      `${TIKTOK_API_BASE}/v1.3/file/video/ad/info/?advertiser_id=${advertiserId}&video_ids=${encodeURIComponent(JSON.stringify(videoIds.slice(0, 3)))}`,
      { headers: { 'Access-Token': token.accessToken } },
    );
    const videoResult = await videoResp.json();
    for (const v of videoResult.data?.list || []) {
      console.log(`  ${v.video_id}: preview_url=${v.preview_url ? 'あり' : 'なし'} | size=${v.size || 'N/A'}`);
    }
  }

  // ad_configuration確認
  console.log('\n=== ad_configuration ===');
  console.log(JSON.stringify(ad.ad_configuration, null, 2));

  console.log('\n=== プレビュー結果サマリー ===');
  console.log(`広告名: ${ad.ad_name}`);
  console.log(`動画数: ${videoIds.length}本`);
  console.log(`広告文: ${(ad.ad_text_list || []).length}個`);
  console.log(`LP URL: ${(ad.landing_page_url_list || []).length}個`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
