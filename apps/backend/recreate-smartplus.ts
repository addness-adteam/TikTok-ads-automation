/**
 * スマプラ広告を正しく作り直す
 * - 旧キャンペーン停止
 * - 新キャンペーン + 広告グループ（ディープファネル + 債務整理除外）+ 1広告6動画
 */
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ADVERTISER_ID = '7468288053866561553';

const IDENTITY_ID = '6fac7e18-0297-5ad3-9849-1de69197cd95';
const IDENTITY_BC_ID = '7440019834009829392';
const PIXEL_ID = '7395091852346654737';

const AD_TEXT = 'AIで独立す���なら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）';
const LP_URL = 'https://school.addness.co.jp/p/r2RHcL0PdGIY?ftid=Q8OAxDH76Gmf&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid';
const AD_NAME = '260409/スマプラ/CR01131_CR01172_CR01169_CR01161_CR01144_CR01165/LP1-CR01192';

const VIDEOS = [
  { videoId: 'v10033g50000d73jgovog65rempsvtcg', name: '【ねねさん】Claude_Code' },
  { videoId: 'v10033g50000d10mfl7og65trcf42l5g', name: 'おい会社員_1年後悔' },
  { videoId: 'v10033g50000d5reklnog65uj38psptg', name: 'やれやめろ��編集強化' },
  { videoId: 'v10033g50000d34k1pnog65l9k1377d0', name: '説明���ようAI_冒頭1_林社長' },
  { videoId: 'v10033g50000d6onmc7og65m24ip5vig', name: 'AI全部やめました渋谷Ver' },
  { videoId: 'v10033g50000d6pv7lnog65gfhdsgfug', name: '一撃YouTube���画作成_途中CTAあり' },
];

async function tiktokApi(endpoint: string, body: any): Promise<any> {
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Access-Token': ACCESS_TOKEN },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`API: ${data.message} (${data.code})\n${JSON.stringify(data, null, 2)}`);
  return data;
}

async function tiktokGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

async function main() {
  // 先ほど作成済みのキャンペーン/広告グループを再利用（旧は停止済み）
  const campaignId = '1861909219829826';
  const adgroupId = '1861909330784434';
  console.log('キャンペーンID: ' + campaignId);
  console.log('広告グループID: ' + adgroupId);
  console.log('(ディープファネル + 除外3件 + 手動ターゲティング 設定済み)');

  // 4. カバー画像（リトライ付き）
  console.log('\n4. カバー画像...');
  const covers: (string | null)[] = [];
  for (const v of VIDEOS) {
    let uri: string | null = null;
    for (let retry = 0; retry < 5 && !uri; retry++) {
      if (retry > 0) await new Promise(r => setTimeout(r, 2000));
      try {
        const vid = await tiktokGet('/v1.3/file/video/ad/info/', {
          advertiser_id: ADVERTISER_ID,
          video_ids: JSON.stringify([v.videoId]),
        });
        const coverUrl = vid.data?.list?.[0]?.video_cover_url;
        if (!coverUrl) { console.log('   ' + v.name + ': no cover URL (retry ' + retry + ', code=' + vid.code + ')'); continue; }
        const imgResp = await fetch(coverUrl);
        if (!imgResp.ok) { console.log('   ' + v.name + ': fetch failed ' + imgResp.status); continue; }
        const buf = Buffer.from(await imgResp.arrayBuffer());
        const FormData = require('form-data');
        const axios = require('axios');
        const form = new FormData();
        form.append('advertiser_id', ADVERTISER_ID);
        form.append('upload_type', 'UPLOAD_BY_FILE');
        form.append('image_signature', crypto.createHash('md5').update(buf).digest('hex'));
        form.append('image_file', buf, { filename: 'c.jpg', contentType: 'image/jpeg' });
        const r = await axios.post(TIKTOK_API_BASE + '/v1.3/file/image/ad/upload/', form, {
          headers: { 'Access-Token': ACCESS_TOKEN, ...form.getHeaders() },
          timeout: 30000,
        });
        if (r.data.code === 0) uri = r.data.data?.web_uri;
      } catch (e: any) {
        console.log('   ' + v.name + ': error ' + e.message + '\n' + e.stack);
      }
    }
    covers.push(uri);
    console.log('   ' + v.name + ': ' + (uri ? 'OK (' + uri + ')' : 'FAIL'));
  }

  // 5. 広告作成（1広告 × 6動画）
  console.log('\n5. 広告作成（1広告 × 6動画）...');
  const ctaData = await tiktokGet('/v1.3/smart_plus/ad/get/', {
    advertiser_id: ADVERTISER_ID,
    page_size: '5',
  });
  const ctaId = ctaData.data?.list?.[0]?.ad_configuration?.call_to_action_id || '';

  const creativeList = VIDEOS.map((v, i) => {
    const info: any = {
      ad_format: 'SINGLE_VIDEO',
      video_info: { video_id: v.videoId },
      identity_id: IDENTITY_ID,
      identity_type: 'BC_AUTH_TT',
      identity_authorized_bc_id: IDENTITY_BC_ID,
    };
    if (covers[i]) info.image_info = [{ web_uri: covers[i] }];
    return { creative_info: info };
  });

  const adData = await tiktokApi('/v1.3/smart_plus/ad/create/', {
    advertiser_id: ADVERTISER_ID,
    adgroup_id: adgroupId,
    ad_name: AD_NAME,
    creative_list: creativeList,
    ad_text_list: [{ ad_text: AD_TEXT }],
    landing_page_url_list: [{ landing_page_url: LP_URL }],
    ad_configuration: { call_to_action_id: ctaId },
    operation_status: 'ENABLE',
    request_id: Date.now() + '' + Math.floor(Math.random() * 100000),
  });
  const adId = String(adData.data?.ad_id || adData.data?.smart_plus_ad_id);

  console.log('\n===== 完了 =====');
  console.log('キャ��ペーンID: ' + campaignId);
  console.log('広告グループID: ' + adgroupId);
  console.log('広告ID: ' + adId);
  console.log('広告名: ' + AD_NAME);
  console.log('動画: ' + VIDEOS.length + '本');
  console.log('ディープファネル: COMPLETE_PAYMENT');
  console.log('除外: AIオプトイン + TikTok除外 + 債務整理類似');
  console.log('ターゲティング: 手動 25-54');
}

main().catch(err => { console.error(err); process.exit(1); });
