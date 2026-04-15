/**
 * 間違えた6個の個別広告を停止 → 正しい1広告（6動画入り）を作成
 * npx tsx apps/backend/fix-smartplus-multi.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

const ADVERTISER_ID = '7468288053866561553'; // AI_1
const CAMPAIGN_ID = '1861908475052177'; // 既存キャンペーン
const ADGROUP_ID = '1861908477959170'; // 既存広告グループ

const AD_TEXT = 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）';
const IDENTITY_ID = '6fac7e18-0297-5ad3-9849-1de69197cd95';
const IDENTITY_BC_ID = '7440019834009829392';

// 間違えて作った6個の広告ID
const WRONG_AD_IDS = [
  '1861908555842129',
  '1861908549777682',
  '1861908570125313',
  '1861908577684561',
  '1861908577688609',
  '1861908567766226',
];

// 正しい6動画
const VIDEOS = [
  { videoId: 'v10033g50000d73jgovog65rempsvtcg', name: '高橋海斗/【ねねさん】Claude_Code' },
  { videoId: 'v10033g50000d10mfl7og65trcf42l5g', name: '鈴木織大/おい会社員_1年後悔' },
  { videoId: 'v10033g50000d5reklnog65uj38psptg', name: '高橋海斗/やれやめろ＿編集強化' },
  { videoId: 'v10033g50000d34k1pnog65l9k1377d0', name: '在中悠也/説明しようAI_冒頭1_林社長' },
  { videoId: 'v10033g50000d6onmc7og65m24ip5vig', name: '石黒研太/AI全部やめました渋谷Ver' },
  { videoId: 'v10033g50000d6pv7lnog65gfhdsgfug', name: '鈴木織大/一撃YouTube動画作成_途中CTAあり' },
];

// CR01192のUTAGE URL（最初に作ったもの）を1広告用に使う
const LP_URL = 'https://school.addness.co.jp/p/r2RHcL0PdGIY?ftid=Q8OAxDH76Gmf&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid';

async function tiktokApi(endpoint: string, body: any): Promise<any> {
  console.log(`  API: ${endpoint}`);
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Access-Token': ACCESS_TOKEN },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`TikTok API エラー: ${data.message} (code: ${data.code})\n${JSON.stringify(data, null, 2)}`);
  return data;
}

async function tiktokGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

async function main() {
  const crypto = require('crypto');

  // 1. 間違えた6個を停止
  console.log('=== 間違えた6個の広告を停止 ===');
  for (const adId of WRONG_AD_IDS) {
    try {
      await tiktokApi('/v1.3/smart_plus/ad/status/update/', {
        advertiser_id: ADVERTISER_ID,
        smart_plus_ad_ids: [adId],
        opt_status: 'DISABLE',
      });
      console.log(`  ✅ ${adId} → DISABLE`);
    } catch (e: any) {
      console.error(`  ❌ ${adId}: ${e.message}`);
    }
  }

  // 2. カバー画像取得＆アップロード
  console.log('\n=== カバー画像取得 ===');
  const coverWebUris: (string | null)[] = [];
  for (const v of VIDEOS) {
    let webUri: string | null = null;
    const vidData = await tiktokGet('/v1.3/file/video/ad/info/', {
      advertiser_id: ADVERTISER_ID,
      video_ids: JSON.stringify([v.videoId]),
    });
    const coverUrl = vidData.data?.list?.[0]?.video_cover_url;
    if (coverUrl) {
      try {
        const imgResp = await fetch(coverUrl);
        if (imgResp.ok) {
          const buffer = Buffer.from(await imgResp.arrayBuffer());
          const FormData = require('form-data');
          const axios = require('axios');
          const form = new FormData();
          form.append('advertiser_id', ADVERTISER_ID);
          form.append('upload_type', 'UPLOAD_BY_FILE');
          form.append('image_signature', crypto.createHash('md5').update(buffer).digest('hex'));
          form.append('image_file', buffer, { filename: `cover_${Date.now()}.jpg`, contentType: 'image/jpeg' });
          const resp = await axios.post(`${TIKTOK_API_BASE}/v1.3/file/image/ad/upload/`, form, {
            headers: { 'Access-Token': ACCESS_TOKEN, ...form.getHeaders() },
            timeout: 30000,
          });
          if (resp.data.code === 0) webUri = resp.data.data?.web_uri || resp.data.data?.image_id;
        }
      } catch {}
    }
    coverWebUris.push(webUri);
    console.log(`  ${v.name}: ${webUri ? 'OK' : 'SKIP'}`);
  }

  // 3. 正しい1広告を作成（6動画をcreative_listに入れる）
  console.log('\n=== 正しいSmart+広告作成（1広告 × 6動画） ===');

  // CTA ID取得
  const ctaData = await tiktokGet('/v1.3/smart_plus/ad/get/', {
    advertiser_id: ADVERTISER_ID,
    page_size: '5',
  });
  const ctaId = ctaData.data?.list?.[0]?.ad_configuration?.call_to_action_id || '';
  console.log(`  CTA ID: ${ctaId}`);

  const creativeList = VIDEOS.map((v, i) => {
    const info: any = {
      ad_format: 'SINGLE_VIDEO',
      video_info: { video_id: v.videoId },
      identity_id: IDENTITY_ID,
      identity_type: 'BC_AUTH_TT',
      identity_authorized_bc_id: IDENTITY_BC_ID,
    };
    if (coverWebUris[i]) {
      info.image_info = [{ web_uri: coverWebUris[i] }];
    }
    return { creative_info: info };
  });

  const adName = '260409/スマプラ/CR01131_CR01172_CR01169_CR01161_CR01144_CR01165/LP1-CR01192';

  const adData = await tiktokApi('/v1.3/smart_plus/ad/create/', {
    advertiser_id: ADVERTISER_ID,
    adgroup_id: ADGROUP_ID,
    ad_name: adName,
    creative_list: creativeList,
    ad_text_list: [{ ad_text: AD_TEXT }],
    landing_page_url_list: [{ landing_page_url: LP_URL }],
    ad_configuration: { call_to_action_id: ctaId },
    operation_status: 'ENABLE',
    request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
  });
  const adId = String(adData.data?.ad_id || adData.data?.smart_plus_ad_id);

  console.log('\n===== 完了 =====');
  console.log(`広告ID: ${adId}`);
  console.log(`広告名: ${adName}`);
  console.log(`クリエイティブ: ${VIDEOS.length}本`);
  for (const v of VIDEOS) console.log(`  - ${v.name}`);
  console.log(`LP URL: CR01192（UTAGE: TikTok広告-AI-LP1-CR01192）`);
  console.log(`手動ターゲティング + ディープファネル: 既存広告グループの設定を継承`);
}

main().catch(err => {
  console.error('\n===== エラー =====');
  console.error(err);
  process.exit(1);
});
