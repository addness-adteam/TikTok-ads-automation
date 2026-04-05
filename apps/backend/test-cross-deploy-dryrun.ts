/**
 * P5-3: dry-run テスト
 * AI_2の広告を取得→動画1本だけダウンロード→AI_4にアップロード→広告作成はスキップ
 */
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import FormData from 'form-data';
import { createHash } from 'crypto';

const prisma = new PrismaClient();
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';

const SOURCE_ADVERTISER = '7523128243466551303'; // AI_2
const TARGET_ADVERTISER = '7580666710525493255'; // AI_4

async function getToken(advertiserId: string): Promise<string> {
  const t = await prisma.oAuthToken.findUnique({ where: { advertiserId } });
  if (!t) throw new Error(`トークンなし: ${advertiserId}`);
  return t.accessToken;
}

async function main() {
  console.log('=== dry-run テスト開始 ===\n');

  // Step 1: 元広告データ取得
  console.log('Step 1: 元広告データ取得...');
  const sourceToken = await getToken(SOURCE_ADVERTISER);
  const listResp = await fetch(
    `${TIKTOK_API_BASE}/v1.3/smart_plus/ad/get/?advertiser_id=${SOURCE_ADVERTISER}&page_size=1`,
    { headers: { 'Access-Token': sourceToken } },
  );
  const listResult = await listResp.json();
  const ad = listResult.data?.list?.[0];
  if (!ad) { console.log('Smart+広告なし'); return; }

  console.log(`  広告名: ${ad.ad_name}`);
  const videoIds: string[] = [];
  for (const c of ad.creative_list || []) {
    const vid = c?.creative_info?.video_info?.video_id;
    if (vid) videoIds.push(vid);
  }
  console.log(`  動画数: ${videoIds.length}本`);

  // テスト用に1本目の動画だけ使う
  const testVideoId = videoIds[0];
  console.log(`  テスト動画: ${testVideoId}\n`);

  // Step 2: 動画のダウンロードURL取得
  console.log('Step 2: 動画メタ情報取得...');
  const videoResp = await fetch(
    `${TIKTOK_API_BASE}/v1.3/file/video/ad/info/?advertiser_id=${SOURCE_ADVERTISER}&video_ids=${encodeURIComponent(JSON.stringify([testVideoId]))}`,
    { headers: { 'Access-Token': sourceToken } },
  );
  const videoResult = await videoResp.json();
  const videoInfo = videoResult.data?.list?.[0];
  if (!videoInfo?.preview_url) {
    console.log('  preview_urlなし!');
    console.log('  レスポンス:', JSON.stringify(videoResult, null, 2));
    return;
  }
  console.log(`  preview_url: ${videoInfo.preview_url.substring(0, 80)}...`);
  console.log(`  サイズ: ${(videoInfo.size / 1024 / 1024).toFixed(1)}MB\n`);

  // Step 3: 動画ダウンロード
  console.log('Step 3: 動画ダウンロード...');
  const downloadResp = await axios.get(videoInfo.preview_url, {
    responseType: 'arraybuffer',
    timeout: 120000,
  });
  const buffer = Buffer.from(downloadResp.data);
  console.log(`  ダウンロード完了: ${(buffer.length / 1024 / 1024).toFixed(1)}MB\n`);

  // Step 4: AI_4にアップロード
  console.log('Step 4: AI_4に動画アップロード...');
  const targetToken = await getToken(TARGET_ADVERTISER);

  // MD5ハッシュ計算
  const md5Hash = createHash('md5').update(buffer).digest('hex');
  console.log(`  video_signature (MD5): ${md5Hash}`);

  const formData = new FormData();
  formData.append('advertiser_id', TARGET_ADVERTISER);
  formData.append('upload_type', 'UPLOAD_BY_FILE');
  formData.append('video_signature', md5Hash);
  const uniqueFilename = `cd_${Date.now()}_${testVideoId.slice(-8)}.mp4`;
  formData.append('video_file', buffer, {
    filename: uniqueFilename,
    contentType: 'video/mp4',
  });

  const uploadResp = await axios.post(
    `${TIKTOK_API_BASE}/v1.3/file/video/ad/upload/`,
    formData,
    {
      headers: {
        'Access-Token': targetToken,
        ...formData.getHeaders(),
      },
      timeout: 120000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    },
  );

  console.log('  アップロードレスポンス:', JSON.stringify(uploadResp.data, null, 2));

  if (uploadResp.data.code !== 0) {
    console.log(`  アップロード失敗: ${uploadResp.data.message}`);
    return;
  }

  const newVideoId = uploadResp.data.data?.video_id;
  console.log(`  アップロード成功! 新video_id: ${newVideoId}\n`);

  // Step 5: 動画処理完了待ち
  console.log('Step 5: 動画処理完了待ち...');
  let ready = false;
  let delay = 3000;
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, delay));
    delay = Math.floor(delay * 1.5);

    const checkResp = await fetch(
      `${TIKTOK_API_BASE}/v1.3/file/video/ad/info/?advertiser_id=${TARGET_ADVERTISER}&video_ids=${encodeURIComponent(JSON.stringify([newVideoId]))}`,
      { headers: { 'Access-Token': targetToken } },
    );
    const checkResult = await checkResp.json();
    const vid = checkResult.data?.list?.[0];
    if (vid?.poster_url || vid?.video_cover_url) {
      console.log(`  処理完了! (${i + 1}回目のチェック)`);
      ready = true;
      break;
    }
    console.log(`  処理中... (${i + 1}/5)`);
  }

  if (!ready) {
    console.log('  タイムアウト（アップロード自体は成功済み）');
  }

  // Step 6: ターゲットのAdvertiser情報を確認
  console.log('\nStep 6: ターゲットアカウント情報...');
  const targetAdv = await prisma.advertiser.findUnique({
    where: { tiktokAdvertiserId: TARGET_ADVERTISER },
  });
  console.log(`  名前: ${targetAdv?.name}`);
  console.log(`  pixelId: ${targetAdv?.pixelId}`);
  console.log(`  identityId: ${targetAdv?.identityId}`);

  // サマリー
  console.log('\n=== dry-run 結果サマリー ===');
  console.log(`元広告: ${ad.ad_name}`);
  console.log(`元video_id: ${testVideoId}`);
  console.log(`新video_id: ${newVideoId} (AI_4)`);
  console.log(`ステータス: 動画アップロード成功`);
  console.log(`次ステップ: UTAGE登録経路作成 → キャンペーン/広告グループ/広告作成`);
  console.log('\n[dry-run] 広告作成はスキップ。実行する場合は本番テストへ。');

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
