/**
 * 既に作成済みのキャンペーン/広告グループに6つの広告を個別追加
 * npx tsx apps/backend/create-smartplus-multi-fix.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

const ADVERTISER_ID = '7468288053866561553'; // AI_1
const ADGROUP_ID = '1861908477959170'; // 先ほど作成済み

const AD_TEXT = 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）';
const IDENTITY_ID = '6fac7e18-0297-5ad3-9849-1de69197cd95';
const IDENTITY_BC_ID = '7440019834009829392';

// 先ほどUTAGE経路作成済みの6件
const ADS = [
  {
    crStr: 'CR01192',
    videoId: 'v10033g50000d73jgovog65rempsvtcg',
    coverWebUri: null as string | null, // 後で取得
    srcAdName: '高橋海斗/【ねねさん】Claude_Code',
    lpUrl: 'https://school.addness.co.jp/p/r2RHcL0PdGIY?ftid=Q8OAxDH76Gmf&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid',
  },
  {
    crStr: 'CR01193',
    videoId: 'v10033g50000d10mfl7og65trcf42l5g',
    coverWebUri: null as string | null,
    srcAdName: '鈴木織大/おい会社員_1年後悔',
    lpUrl: 'https://school.addness.co.jp/p/r2RHcL0PdGIY?ftid=liAdVxMcB3Nq&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid',
  },
  {
    crStr: 'CR01194',
    videoId: 'v10033g50000d5reklnog65uj38psptg',
    coverWebUri: null as string | null,
    srcAdName: '高橋海斗/やれやめろ＿編集強化',
    lpUrl: 'https://school.addness.co.jp/p/r2RHcL0PdGIY?ftid=Ydt6GIKoXxU1&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid',
  },
  {
    crStr: 'CR01195',
    videoId: 'v10033g50000d34k1pnog65l9k1377d0',
    coverWebUri: null as string | null,
    srcAdName: '在中悠也/説明しようAI_冒頭1_林社長',
    lpUrl: 'https://school.addness.co.jp/p/r2RHcL0PdGIY?ftid=MGmeekttS8wk&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid',
  },
  {
    crStr: 'CR01196',
    videoId: 'v10033g50000d6onmc7og65m24ip5vig',
    coverWebUri: null as string | null,
    srcAdName: '石黒研太/AI全部やめました渋谷Ver',
    lpUrl: 'https://school.addness.co.jp/p/r2RHcL0PdGIY?ftid=fuqREWPCsnLX&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid',
  },
  {
    crStr: 'CR01197',
    videoId: 'v10033g50000d6pv7lnog65gfhdsgfug',
    coverWebUri: null as string | null,
    srcAdName: '鈴木織大/一撃YouTube動画作成_途中CTAあり',
    lpUrl: 'https://school.addness.co.jp/p/r2RHcL0PdGIY?ftid=ZvVCU2S35Txz&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid',
  },
];

async function tiktokApi(endpoint: string, body: any): Promise<any> {
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
  console.log('===== 6広告を既存広告グループに追加 =====');
  console.log(`広告グループID: ${ADGROUP_ID}\n`);

  // CTA ID取得
  const ctaData = await tiktokGet('/v1.3/smart_plus/ad/get/', {
    advertiser_id: ADVERTISER_ID,
    page_size: '5',
  });
  const ctaId = ctaData.data?.list?.[0]?.ad_configuration?.call_to_action_id || '';
  console.log(`CTA ID: ${ctaId}\n`);

  // カバー画像は先ほどアップロード済みだが、web_uriを保存していなかったので再取得＆アップロード
  const crypto = require('crypto');
  for (const ad of ADS) {
    const vidData = await tiktokGet('/v1.3/file/video/ad/info/', {
      advertiser_id: ADVERTISER_ID,
      video_ids: JSON.stringify([ad.videoId]),
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
          if (resp.data.code === 0) {
            ad.coverWebUri = resp.data.data?.web_uri || resp.data.data?.image_id;
          }
        }
      } catch {}
    }
    console.log(`${ad.crStr}: カバー画像 ${ad.coverWebUri ? 'OK' : 'SKIP'}`);
  }

  // 各広告を個別作成
  console.log('\n--- 広告作成 ---');
  const results: { crStr: string; adId: string; srcAdName: string }[] = [];

  for (const ad of ADS) {
    const adName = `260409/スマプラ/${ad.srcAdName}/LP1-${ad.crStr}`;
    const creativeInfo: any = {
      ad_format: 'SINGLE_VIDEO',
      video_info: { video_id: ad.videoId },
      identity_id: IDENTITY_ID,
      identity_type: 'BC_AUTH_TT',
      identity_authorized_bc_id: IDENTITY_BC_ID,
    };
    if (ad.coverWebUri) {
      creativeInfo.image_info = [{ web_uri: ad.coverWebUri }];
    }

    try {
      const data = await tiktokApi('/v1.3/smart_plus/ad/create/', {
        advertiser_id: ADVERTISER_ID,
        adgroup_id: ADGROUP_ID,
        ad_name: adName,
        creative_list: [{ creative_info: creativeInfo }],
        ad_text_list: [{ ad_text: AD_TEXT }],
        landing_page_url_list: [{ landing_page_url: ad.lpUrl }],
        ad_configuration: { call_to_action_id: ctaId },
        operation_status: 'ENABLE',
        request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
      });
      const adId = String(data.data?.ad_id || data.data?.smart_plus_ad_id);
      console.log(`✅ ${ad.crStr}: ${adName} → ad_id=${adId}`);
      results.push({ crStr: ad.crStr, adId, srcAdName: ad.srcAdName });
    } catch (e: any) {
      console.error(`❌ ${ad.crStr}: ${e.message}`);
    }
  }

  console.log('\n===== 完了 =====');
  console.log(`作成成功: ${results.length}/${ADS.length}件`);
  for (const r of results) {
    console.log(`  ${r.crStr}: ${r.srcAdName} → ad_id=${r.adId}`);
  }
}

main().catch(console.error);
