import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';
const ADV = '7468288053866561553';
const AG_ID = '1861909330784434';
const IDENTITY_ID = '6fac7e18-0297-5ad3-9849-1de69197cd95';
const BC_ID = '7440019834009829392';
const AD_TEXT = 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）';
const LP_URL = 'https://school.addness.co.jp/p/r2RHcL0PdGIY?ftid=Q8OAxDH76Gmf&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid';
const AD_NAME = '260409/スマプラ/CR01131_CR01172_CR01169_CR01161_CR01144_CR01165/LP1-CR01192';

const VIDS = [
  'v10033g50000d73jgovog65rempsvtcg',
  'v10033g50000d10mfl7og65trcf42l5g',
  'v10033g50000d5reklnog65uj38psptg',
  'v10033g50000d34k1pnog65l9k1377d0',
  'v10033g50000d6onmc7og65m24ip5vig',
  'v10033g50000d6pv7lnog65gfhdsgfug',
];

async function main() {
  const FormData = require('form-data');
  const axios = require('axios');

  // カバー画像取得＆アップロード
  const covers: string[] = [];
  for (const vid of VIDS) {
    console.log(`\nProcessing ${vid}...`);
    
    // Get cover URL
    const infoResp = await fetch(`${BASE}/v1.3/file/video/ad/info/?advertiser_id=${ADV}&video_ids=["${vid}"]`, {
      headers: { 'Access-Token': ACCESS_TOKEN },
    });
    const infoData = await infoResp.json();
    const coverUrl = infoData.data?.list?.[0]?.video_cover_url;
    console.log('  Cover URL:', coverUrl ? coverUrl.substring(0, 60) + '...' : 'NONE');
    if (!coverUrl) throw new Error('No cover URL for ' + vid);

    // Download
    const imgResp = await fetch(coverUrl);
    console.log('  Download:', imgResp.status, imgResp.headers.get('content-type'));
    const buf = Buffer.from(await imgResp.arrayBuffer());
    console.log('  Size:', buf.byteLength);

    // Upload
    const form = new FormData();
    form.append('advertiser_id', ADV);
    form.append('upload_type', 'UPLOAD_BY_FILE');
    form.append('image_signature', crypto.createHash('md5').update(buf).digest('hex'));
    form.append('image_file', buf, { filename: `cover_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`, contentType: 'image/jpeg' });

    const uploadResp = await axios.post(`${BASE}/v1.3/file/image/ad/upload/`, form, {
      headers: { 'Access-Token': ACCESS_TOKEN, ...form.getHeaders() },
      timeout: 30000,
    });
    console.log('  Upload:', JSON.stringify(uploadResp.data.data));
    const webUri = uploadResp.data.data?.web_uri || uploadResp.data.data?.image_id || uploadResp.data.data?.id;
    if (uploadResp.data.code !== 0) throw new Error('Upload failed: ' + uploadResp.data.message + ' data=' + JSON.stringify(uploadResp.data.data));
    if (!webUri) throw new Error('No web_uri: ' + JSON.stringify(uploadResp.data.data));
    covers.push(webUri);
  }

  console.log('\nAll covers:', covers);

  // CTA ID
  const ctaResp = await fetch(`${BASE}/v1.3/smart_plus/ad/get/?advertiser_id=${ADV}&page_size=5`, {
    headers: { 'Access-Token': ACCESS_TOKEN },
  });
  const ctaData = await ctaResp.json();
  const ctaId = ctaData.data?.list?.[0]?.ad_configuration?.call_to_action_id || '';
  console.log('CTA ID:', ctaId);

  // Create ad
  const creativeList = VIDS.map((vid, i) => ({
    creative_info: {
      ad_format: 'SINGLE_VIDEO',
      video_info: { video_id: vid },
      identity_id: IDENTITY_ID,
      identity_type: 'BC_AUTH_TT',
      identity_authorized_bc_id: BC_ID,
      image_info: [{ web_uri: covers[i] }],
    },
  }));

  console.log('\nCreating ad...');
  const adResp = await fetch(`${BASE}/v1.3/smart_plus/ad/create/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Access-Token': ACCESS_TOKEN },
    body: JSON.stringify({
      advertiser_id: ADV,
      adgroup_id: AG_ID,
      ad_name: AD_NAME,
      creative_list: creativeList,
      ad_text_list: [{ ad_text: AD_TEXT }],
      landing_page_url_list: [{ landing_page_url: LP_URL }],
      ad_configuration: { call_to_action_id: ctaId },
      operation_status: 'ENABLE',
      request_id: Date.now() + '' + Math.floor(Math.random() * 100000),
    }),
  });
  const adData = await adResp.json();
  console.log('Ad create result:', JSON.stringify(adData, null, 2));

  if (adData.code === 0) {
    const adId = adData.data?.ad_id || adData.data?.smart_plus_ad_id;
    console.log('\n===== 完了 =====');
    console.log('広告ID:', adId);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
