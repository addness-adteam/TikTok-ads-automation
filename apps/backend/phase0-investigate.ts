/**
 * Phase 0: API調査スクリプト
 * P0-1〜P0-7を一括で調査する
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';

async function main() {
  // AI_2をテスト対象にする（成果が出ているSmart+広告がある）
  const advertiserId = '7523128243466551303';
  const token = await prisma.oAuthToken.findUnique({ where: { advertiserId } });
  if (!token) { console.error('Token not found'); return; }
  const accessToken = token.accessToken;

  // ==============================================================
  // P0-1: smart_plus/ad/get のcreative_listの完全JSONダンプ
  // ==============================================================
  console.log('='.repeat(60));
  console.log('P0-1: smart_plus/ad/get creative_list構造');
  console.log('='.repeat(60));

  const spResp = await fetch(`${TIKTOK_API_BASE}/v1.3/smart_plus/ad/get/?advertiser_id=${advertiserId}&page_size=2`, {
    headers: { 'Access-Token': accessToken },
  });
  const spResult = await spResp.json();
  const spAd = spResult.data?.list?.[0];

  if (spAd) {
    console.log('\n広告名:', spAd.ad_name);
    console.log('smart_plus_ad_id:', spAd.smart_plus_ad_id);
    console.log('\ncreative_list (完全JSON):');
    console.log(JSON.stringify(spAd.creative_list, null, 2));
    console.log('\nad_text_list:', JSON.stringify(spAd.ad_text_list, null, 2));
    console.log('\nlanding_page_url_list:', JSON.stringify(spAd.landing_page_url_list, null, 2));
    console.log('\nad_configuration:', JSON.stringify(spAd.ad_configuration, null, 2));
    console.log('\n全トップレベルキー:', Object.keys(spAd).join(', '));
  }

  // ==============================================================
  // P0-1 方法2: /v1.3/ad/get/ でSmart+広告のvideo_idを取得
  // ==============================================================
  console.log('\n' + '='.repeat(60));
  console.log('P0-1 方法2: /v1.3/ad/get/ でvideo_idを取得');
  console.log('='.repeat(60));

  // smart_plus_ad_idでフィルタして、紐づくad_idからvideo_idを取得
  if (spAd) {
    const adResp = await fetch(
      `${TIKTOK_API_BASE}/v1.3/ad/get/?advertiser_id=${advertiserId}&filtering=${encodeURIComponent(JSON.stringify({ smart_plus_ad_ids: [spAd.smart_plus_ad_id] }))}&page_size=20`,
      { headers: { 'Access-Token': accessToken } },
    );
    const adResult = await adResp.json();
    const childAds = adResult.data?.list || [];
    console.log(`\nsmart_plus_ad_id ${spAd.smart_plus_ad_id} に紐づくad数: ${childAds.length}`);
    for (const ad of childAds.slice(0, 5)) {
      console.log(`  ad_id: ${ad.ad_id} | video_id: ${ad.video_id ?? 'N/A'} | image_ids: ${JSON.stringify(ad.image_ids ?? [])} | ad_name: ${ad.ad_name?.substring(0, 50)}`);
    }
  }

  // ==============================================================
  // P0-2: file/video/ad/info で動画ダウンロードURL取得テスト
  // ==============================================================
  console.log('\n' + '='.repeat(60));
  console.log('P0-2: file/video/ad/info レスポンス構造');
  console.log('='.repeat(60));

  // DBから既知のvideo_idを取得
  const creative = await prisma.creative.findFirst({
    where: { tiktokVideoId: { not: null }, type: 'VIDEO' },
    select: { tiktokVideoId: true, name: true },
  });

  if (creative?.tiktokVideoId) {
    console.log(`\nテスト用video_id: ${creative.tiktokVideoId}`);
    const videoResp = await fetch(
      `${TIKTOK_API_BASE}/v1.3/file/video/ad/info/?advertiser_id=${advertiserId}&video_ids=${encodeURIComponent(JSON.stringify([creative.tiktokVideoId]))}`,
      { headers: { 'Access-Token': accessToken } },
    );
    const videoResult = await videoResp.json();
    console.log('レスポンス全体:', JSON.stringify(videoResult, null, 2));
  }

  // ==============================================================
  // P0-3/4/5: Smart+ create系エンドポイント確認
  // テスト用に最小パラメータでリクエストして、エラーメッセージからパラメータ要件を把握
  // ==============================================================
  console.log('\n' + '='.repeat(60));
  console.log('P0-3: smart_plus/campaign/create エンドポイント確認');
  console.log('='.repeat(60));

  // まずは正しいエンドポイントパスを特定するために最小リクエスト
  for (const path of ['/v1.3/smart_plus/campaign/create/', '/v1.3/campaign/smart_plus_create/']) {
    const resp = await fetch(`${TIKTOK_API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Access-Token': accessToken },
      body: JSON.stringify({ advertiser_id: advertiserId }),
    });
    const result = await resp.json();
    console.log(`\n${path}:`);
    console.log(`  code: ${result.code}, message: ${result.message}`);
    if (result.data) console.log(`  data: ${JSON.stringify(result.data)}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('P0-4: smart_plus/adgroup/create エンドポイント確認');
  console.log('='.repeat(60));

  for (const path of ['/v1.3/smart_plus/adgroup/create/', '/v1.3/adgroup/smart_plus_create/']) {
    const resp = await fetch(`${TIKTOK_API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Access-Token': accessToken },
      body: JSON.stringify({ advertiser_id: advertiserId }),
    });
    const result = await resp.json();
    console.log(`\n${path}:`);
    console.log(`  code: ${result.code}, message: ${result.message}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('P0-5: smart_plus/ad/create エンドポイント確認');
  console.log('='.repeat(60));

  for (const path of ['/v1.3/smart_plus/ad/create/', '/v1.3/ad/smart_plus_create/']) {
    const resp = await fetch(`${TIKTOK_API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Access-Token': accessToken },
      body: JSON.stringify({ advertiser_id: advertiserId }),
    });
    const result = await resp.json();
    console.log(`\n${path}:`);
    console.log(`  code: ${result.code}, message: ${result.message}`);
  }

  // ==============================================================
  // P0-6: 各アカウントのpixel_id, identity_idを取得
  // ==============================================================
  console.log('\n' + '='.repeat(60));
  console.log('P0-6: 各アカウントのpixel_id, identity_id取得');
  console.log('='.repeat(60));

  const targetAccounts = [
    { name: 'AI_1', id: '7468288053866561553' },
    { name: 'AI_2', id: '7523128243466551303' },
    { name: 'AI_3', id: '7543540647266074641' },
    { name: 'AI_4', id: '7580666710525493255' },
    { name: 'SP1', id: '7474920444831875080' },
    { name: 'SP2', id: '7592868952431362066' },
    { name: 'SNS1', id: '7247073333517238273' },
    { name: 'SNS2', id: '7543540100849156112' },
    { name: 'SNS3', id: '7543540381615800337' },
  ];

  for (const acc of targetAccounts) {
    const accToken = await prisma.oAuthToken.findUnique({ where: { advertiserId: acc.id } });
    if (!accToken) { console.log(`\n${acc.name}: トークンなし`); continue; }

    // ad/getから1つ広告を取得してidentity_id, pixel関連情報を抽出
    const adResp = await fetch(
      `${TIKTOK_API_BASE}/v1.3/ad/get/?advertiser_id=${acc.id}&page_size=1`,
      { headers: { 'Access-Token': accToken.accessToken } },
    );
    const adResult = await adResp.json();
    const ad = adResult.data?.list?.[0];

    // adgroupからpixel_idを取得
    let pixelId = 'N/A';
    if (ad?.adgroup_id) {
      const agResp = await fetch(
        `${TIKTOK_API_BASE}/v1.3/adgroup/get/?advertiser_id=${acc.id}&filtering=${encodeURIComponent(JSON.stringify({ adgroup_ids: [ad.adgroup_id] }))}`,
        { headers: { 'Access-Token': accToken.accessToken } },
      );
      const agResult = await agResp.json();
      const ag = agResult.data?.list?.[0];
      pixelId = ag?.pixel_id || ag?.dataset_id || 'N/A';
      if (pixelId === 'N/A') {
        // pixel関連フィールドを探す
        const pixelKeys = Object.keys(ag || {}).filter(k => k.includes('pixel') || k.includes('dataset') || k.includes('event'));
        if (pixelKeys.length > 0) {
          console.log(`  pixel関連キー: ${pixelKeys.map(k => `${k}=${ag[k]}`).join(', ')}`);
        }
      }
    }

    console.log(`\n${acc.name} (${acc.id}):`);
    console.log(`  identity_id: ${ad?.identity_id ?? 'N/A'}`);
    console.log(`  identity_type: ${ad?.identity_type ?? 'N/A'}`);
    console.log(`  pixel_id: ${pixelId}`);
  }

  // ==============================================================
  // P0-7: UTAGEファネルマッピング検証
  // ==============================================================
  console.log('\n' + '='.repeat(60));
  console.log('P0-7: UTAGEファネルマッピング検証はget-tiktok-funnel-details.tsで確認済み');
  console.log('='.repeat(60));
  console.log('→ funnelId/groupId/stepId は要件定義書に記載済み');

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
