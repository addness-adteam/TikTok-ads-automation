/**
 * SNS CR00579, CR00567, CR00566 を SNS2 に横展開（通常配信）
 * 元広告が通常配信のためSmart+ APIを経由せず、/v1.3/ad/get/ で取得
 */
import axios from 'axios';
import * as crypto from 'crypto';

const API_BASE = 'https://tik-tok-ads-automation-backend.vercel.app';
const TIKTOK_API = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

const SOURCE_ADVERTISER_ID = '7247073333517238273'; // SNS1
const TARGET_ADVERTISER_ID = '7543540100849156112'; // SNS2
const TARGET_PIXEL_ID = '7388088697557663760';
const TARGET_IDENTITY_ID = '6fac7e18-0297-5ad3-9849-1de69197cd95';
const TARGET_BC_ID = '7440019834009829392';

const deployTargets = [
  { sourceAdId: '1847937633023249', label: 'CR00579 問題ないです/ひったくりVer' },
  { sourceAdId: '1847734887735393', label: 'CR00567 マジで意味ないです冒頭11' },
  { sourceAdId: '1847734887735409', label: 'CR00566 マジで意味ないです冒頭12' },
];

// ---- TikTok API helpers ----
async function tiktokGet(path: string, params: any) {
  const res = await axios.get(`${TIKTOK_API}${path}`, {
    headers: { 'Access-Token': ACCESS_TOKEN },
    params,
  });
  return res.data;
}

async function tiktokPost(path: string, data: any) {
  const res = await axios.post(`${TIKTOK_API}${path}`, data, {
    headers: { 'Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' },
  });
  return res.data;
}

// 元広告からvideo_id + ad_text + LP URL取得
async function getSourceAd(advertiserId: string, adId: string) {
  const resp = await tiktokGet('/v1.3/ad/get/', {
    advertiser_id: advertiserId,
    filtering: JSON.stringify({ ad_ids: [adId] }),
    fields: JSON.stringify(['ad_id', 'ad_name', 'video_id', 'ad_text', 'landing_page_url', 'call_to_action']),
  });
  const ad = resp.data?.list?.[0];
  if (!ad) throw new Error(`Ad not found: ${adId}`);
  return ad;
}

// video情報取得
async function getVideoInfo(advertiserId: string, videoIds: string[]) {
  const resp = await tiktokGet('/v1.3/file/video/ad/info/', {
    advertiser_id: advertiserId,
    video_ids: JSON.stringify(videoIds),
  });
  return resp.data?.list || [];
}

// 動画ダウンロード
async function downloadVideo(url: string): Promise<Buffer> {
  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 300000 });
  return Buffer.from(resp.data);
}

// 動画アップロード
async function uploadVideo(advertiserId: string, buffer: Buffer, filename: string): Promise<string> {
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('advertiser_id', advertiserId);
  form.append('upload_type', 'UPLOAD_BY_FILE');
  form.append('video_file', buffer, { filename, contentType: 'video/mp4' });
  const signature = crypto.createHash('md5').update(buffer).digest('hex');
  form.append('video_signature', signature);
  form.append('file_name', filename);

  const resp = await axios.post(`${TIKTOK_API}/v1.3/file/video/ad/upload/`, form, {
    headers: { 'Access-Token': ACCESS_TOKEN, ...form.getHeaders() },
    timeout: 300000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  // data is array: [{video_id: "...", ...}] or object: {video_id: "..."}
  const data = resp.data?.data;
  const videoId = Array.isArray(data) ? data[0]?.video_id : data?.video_id;
  if (!videoId) throw new Error(`Video upload failed: ${JSON.stringify(resp.data).substring(0, 300)}`);
  return videoId;
}

// 動画Ready待ち
async function waitForVideoReady(advertiserId: string, videoId: string) {
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const info = await getVideoInfo(advertiserId, [videoId]);
    const status = info[0]?.video_status;
    console.log(`    動画ステータス: ${status} (${i + 1}/30)`);
    if (status === 'VIDEO_STATUS_CONFIRM') return;
    if (status === 'VIDEO_STATUS_FAIL') throw new Error('Video processing failed');
  }
  throw new Error('Video ready timeout');
}

// サムネイルアップロード
async function uploadThumbnail(advertiserId: string, videoId: string): Promise<string> {
  const info = await getVideoInfo(advertiserId, [videoId]);
  const coverUrl = info[0]?.video_cover_url;
  if (!coverUrl) throw new Error('No video cover URL');

  const imgBuffer = await axios.get(coverUrl, { responseType: 'arraybuffer', timeout: 60000 });
  const imgData = Buffer.from(imgBuffer.data);

  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('advertiser_id', advertiserId);
  form.append('upload_type', 'UPLOAD_BY_FILE');
  form.append('image_file', imgData, { filename: `thumb_${videoId}.jpg`, contentType: 'image/jpeg' });
  const signature = crypto.createHash('md5').update(imgData).digest('hex');
  form.append('image_signature', signature);
  form.append('file_name', `thumb_${videoId}.jpg`);

  const resp = await axios.post(`${TIKTOK_API}/v1.3/file/image/ad/upload/`, form, {
    headers: { 'Access-Token': ACCESS_TOKEN, ...form.getHeaders() },
    timeout: 60000,
  });

  const imageId = resp.data?.data?.image_id;
  if (!imageId) throw new Error(`Image upload failed: ${JSON.stringify(resp.data).substring(0, 200)}`);
  return imageId;
}

// UTAGE登録経路作成（APIサーバー経由）
async function createUtageRegistrationPath(appeal: string, lpNumber: number) {
  // 直接APIを呼ぶ（バックエンドサーバーにUTAGE用のエンドポイントがない場合は手動）
  // cross-deploy/deployが内部で使うutageServiceと同じ処理をAPI経由で呼ぶ
  // 代わりにcross-deploy APIのpreviewを使って最新CR番号を取得し、直接構築する
  const resp = await axios.post(`${API_BASE}/api/utage/registration-path`, {
    appeal,
    lpNumber,
  }).catch(() => null);

  if (resp?.data) return resp.data;

  // UTAGEエンドポイントがない場合はcross-deploy内部でやるしかない
  // → cross-deployのdry-runを使う手もあるが、Smart+ APIで失敗する
  throw new Error('UTAGE API endpoint not available');
}

// ---- メイン処理 ----
async function main() {
  console.log('=== SNS CR横展開 → SNS2 ===\n');

  // ターゲットアカウントの情報を確認
  console.log('ターゲットアカウント情報取得中...');
  const advResp = await tiktokGet('/v1.3/advertiser/info/', {
    advertiser_ids: JSON.stringify([TARGET_ADVERTISER_ID]),
  });
  console.log(`  SNS2: ${advResp.data?.list?.[0]?.name || 'OK'}\n`);

  // SNS2のpixel_id, identity_idをDBから取得（APIサーバー経由）
  const dbResp = await axios.get(`${API_BASE}/api/advertisers/${TARGET_ADVERTISER_ID}`).catch(() => null);
  const pixelId = TARGET_PIXEL_ID;
  const identityId = TARGET_IDENTITY_ID;
  const identityBcId = TARGET_BC_ID;
  console.log(`  pixelId: ${pixelId}`);
  console.log(`  identityId: ${identityId}`);
  console.log(`  bcId: ${identityBcId}\n`);

  for (const target of deployTargets) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 ${target.label}`);
    console.log(`  元: SNS1 / ad_id: ${target.sourceAdId}`);

    try {
      // 1. 元広告データ取得
      console.log('  1. 元広告データ取得...');
      const sourceAd = await getSourceAd(SOURCE_ADVERTISER_ID, target.sourceAdId);
      console.log(`    ad_name: ${sourceAd.ad_name}`);
      console.log(`    video_id: ${sourceAd.video_id}`);
      console.log(`    ad_text: ${sourceAd.ad_text?.substring(0, 50)}`);

      if (!sourceAd.video_id) throw new Error('video_idがありません');

      // 2. 動画をダウンロード
      console.log('  2. 動画ダウンロード...');
      const videoInfos = await getVideoInfo(SOURCE_ADVERTISER_ID, [sourceAd.video_id]);
      const downloadUrl = videoInfos[0]?.preview_url || videoInfos[0]?.video_url;
      if (!downloadUrl) throw new Error('動画ダウンロードURLなし');
      const videoBuffer = await downloadVideo(downloadUrl);
      console.log(`    サイズ: ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB`);

      // 3. SNS2にアップロード
      console.log('  3. SNS2に動画アップロード...');
      const ts = Date.now();
      const newVideoId = await uploadVideo(TARGET_ADVERTISER_ID, videoBuffer, `cross_deploy_${ts}.mp4`);
      console.log(`    新video_id: ${newVideoId}`);

      // 4. 動画Ready待ち
      console.log('  4. 動画処理待ち...');
      await waitForVideoReady(TARGET_ADVERTISER_ID, newVideoId);

      // 5. UTAGE登録経路作成
      console.log('  5. UTAGE登録経路作成...');
      let utageResult: any;
      try {
        utageResult = await createUtageRegistrationPath('SNS', 1);
        console.log(`    経路: ${utageResult.registrationPath}`);
        console.log(`    LP: ${utageResult.destinationUrl}`);
      } catch (e: any) {
        console.log(`    ⚠ UTAGE API失敗: ${e.message}`);
        console.log('    → cross-deploy APIを修正して通常配信対応するか、手動でUTAGE作成が必要');
        console.log(`    動画アップロードは完了: video_id=${newVideoId}`);
        continue;
      }

      // 6. サムネイル画像アップロード
      console.log('  6. サムネイルアップロード...');
      const thumbnailImageId = await uploadThumbnail(TARGET_ADVERTISER_ID, newVideoId);
      console.log(`    image_id: ${thumbnailImageId}`);

      // 7. キャンペーン作成
      const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const dateStr = `${String(jst.getUTCFullYear()).slice(2)}${String(jst.getUTCMonth() + 1).padStart(2, '0')}${String(jst.getUTCDate()).padStart(2, '0')}`;
      const parts = sourceAd.ad_name.split('/');
      const creator = parts.length >= 2 ? parts[1] : '横展開';
      const crName = parts.length >= 3 ? parts[2] : '横展開CR';
      const crStr = String(utageResult.crNumber).padStart(5, '0');
      const adName = `${dateStr}/${creator}/${crName}/LP1-CR${crStr}`;

      console.log(`  7. キャンペーン作成: ${adName}`);
      const campaignResp = await tiktokPost('/v1.3/campaign/create/', {
        advertiser_id: TARGET_ADVERTISER_ID,
        campaign_name: adName,
        objective_type: 'LEAD_GENERATION',
        budget_mode: 'BUDGET_MODE_INFINITE',
      });
      const campaignId = String(campaignResp.data?.campaign_id);
      console.log(`    campaign_id: ${campaignId}`);

      // 8. 広告グループ作成
      console.log('  8. 広告グループ作成...');
      const scheduleTime = new Date(Date.now() + 10 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
      const adgroupResp = await tiktokPost('/v1.3/adgroup/create/', {
        advertiser_id: TARGET_ADVERTISER_ID,
        campaign_id: campaignId,
        adgroup_name: `${dateStr} ノンタゲ`,
        placement_type: 'PLACEMENT_TYPE_NORMAL',
        placements: ['PLACEMENT_TIKTOK'],
        budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET',
        budget: 3000,
        bid_type: 'BID_TYPE_NO_BID',
        optimization_goal: 'CONVERT',
        pixel_id: pixelId,
        optimization_event: 'ON_WEB_REGISTER',
        schedule_type: 'SCHEDULE_FROM_NOW',
        schedule_start_time: scheduleTime,
        location_ids: ['1861060'],
        age_groups: ['AGE_18_24', 'AGE_25_34', 'AGE_35_44', 'AGE_45_54', 'AGE_55_100'],
        gender: 'GENDER_UNLIMITED',
        languages: ['ja'],
        operating_system: 'ANDROID_IOS',
      });
      const adgroupId = String(adgroupResp.data?.adgroup_id);
      console.log(`    adgroup_id: ${adgroupId}`);

      // 9. 広告作成
      console.log('  9. 広告作成...');
      const adText = sourceAd.ad_text || 'SNSで独立するなら学んでおきたい本質のSNSマーケ特商法（https://skill.addness.co.jp/tokushoho）';
      const lpUrl = `${utageResult.destinationUrl}${utageResult.destinationUrl.includes('?') ? '&' : '?'}utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;

      const adResp = await tiktokPost('/v1.3/ad/create/', {
        advertiser_id: TARGET_ADVERTISER_ID,
        adgroup_id: adgroupId,
        creatives: [{
          ad_name: adName,
          identity_id: identityId,
          identity_type: 'BC_AUTH_TT',
          identity_authorized_bc_id: identityBcId,
          video_id: newVideoId,
          image_ids: [thumbnailImageId],
          ad_text: adText,
          call_to_action: 'LEARN_MORE',
          landing_page_url: lpUrl,
          ad_format: 'SINGLE_VIDEO',
        }],
      });

      const newAdId = adResp.data?.ad_ids?.[0] || 'unknown';
      console.log(`  ✅ 成功!`);
      console.log(`    Ad ID: ${newAdId}`);
      console.log(`    Ad Name: ${adName}`);
      console.log(`    UTAGE経路: ${utageResult.registrationPath}`);
      console.log(`    LP: ${lpUrl.substring(0, 80)}...`);
      console.log(`    日予算: ¥3,000`);

    } catch (e: any) {
      console.log(`  ❌ エラー: ${e.message?.substring(0, 200)}`);
      if (e.response?.data) {
        console.log(`    API応答: ${JSON.stringify(e.response.data).substring(0, 300)}`);
      }
    }
  }

  console.log('\n\n=== 完了 ===');
}

main().catch(console.error);
