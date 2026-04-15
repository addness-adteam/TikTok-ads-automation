/**
 * SP3マルチ動画 広告作成リトライ（カバー画像付き）
 * キャンペーンID: 1861819641394258
 * 広告グループID: 1861819641397378
 */
import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SP3 = '7616545514662051858';
const ADGROUP_ID = '1861819641397378';

const SP3_VIDEO_IDS = [
  'v10033g50000d7aghp7og65jm8eun9jg', 'v10033g50000d7aghrfog65lvohfp0sg',
  'v10033g50000d7aghtvog65q2b04iodg', 'v10033g50000d7agi17og65lbb4qi6fg',
  'v10033g50000d7agi3fog65kc5cr05u0', 'v10033g50000d7agi6vog65kml799790',
  'v10033g50000d7agia7og65mkk95eerg', 'v10033g50000d7agidfog65g6rpfvqvg',
  'v10033g50000d7agihfog65i8549kdmg', 'v10033g50000d7agikvog65jt7hhd850',
  'v10033g50000d7agionog65o5m680a20', 'v10033g50000d7agirvog65hrk0avasg',
  'v10033g50000d7agivvog65vhipenms0', 'v10033g50000d7agj47og65nldlb3ong',
  'v10033g50000d7agj7fog65kg6hsdvbg', 'v10033g50000d7agjbfog65hlou5qt80',
  'v10033g50000d7agjenog65knkierukg', 'v10033g50000d7agjhvog65h2e93fa10',
  'v10033g50000d7agjkvog65ktneagjbg', 'v10033g50000d7agjo7og65nge2a7hpg',
  'v10033g50000d7agjqvog65jie3ujdr0', 'v10033g50000d7agjufog65r1p516i10',
  'v10033g50000d7agk27og65rg5plgg80',
];

const LANDING_PAGE_URL = 'https://school.addness.co.jp/p/doc7hffUAVTv?ftid=ER7SW3k2TQmN&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid';
const AD_NAME = '260408/清水絢吾/セミまとめ+追加動画/LP2-CR00598';
const AD_TEXT = 'スキルで独立するなら学んでおきたい本質のスキル活用術特商法（https://skill.addness.co.jp/tokushoho）';

async function tiktokApi(endpoint: string, body: any): Promise<any> {
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Access-Token': ACCESS_TOKEN },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`${data.message} (code: ${data.code})\n${JSON.stringify(data)}`);
  return data;
}

async function tiktokGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

async function uploadCoverImage(advertiserId: string, coverUrl: string, videoId: string): Promise<string | null> {
  try {
    const resp = await fetch(coverUrl);
    if (!resp.ok) return null;
    const buffer = Buffer.from(await resp.arrayBuffer());
    const FormData = require('form-data');
    const axios = require('axios');
    const form = new FormData();
    form.append('advertiser_id', advertiserId);
    form.append('upload_type', 'UPLOAD_BY_FILE');
    form.append('image_signature', crypto.createHash('md5').update(buffer).digest('hex'));
    form.append('image_file', buffer, { filename: `cover_${videoId}_${Date.now()}.jpg`, contentType: 'image/jpeg' });
    const uploadResp = await axios.post(`${TIKTOK_API_BASE}/v1.3/file/image/ad/upload/`, form, {
      headers: { 'Access-Token': ACCESS_TOKEN, ...form.getHeaders() },
      timeout: 30000,
    });
    if (uploadResp.data.code !== 0) return null;
    return Array.isArray(uploadResp.data.data) ? uploadResp.data.data[0]?.image_id : uploadResp.data.data.image_id;
  } catch { return null; }
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const adv = await prisma.advertiser.findUnique({
      where: { tiktokAdvertiserId: SP3 },
      select: { identityId: true, identityAuthorizedBcId: true },
    });
    if (!adv) throw new Error('SP3 not found');

    const ctaData = await tiktokGet('/v1.3/smart_plus/ad/get/', { advertiser_id: SP3, page_size: '5' });
    const ctaId = ctaData.data?.list?.[0]?.ad_configuration?.call_to_action_id || '';

    // 全動画のカバー画像を取得・アップロード
    console.log(`カバー画像取得中... (${SP3_VIDEO_IDS.length}本)`);
    const coverMap = new Map<string, string>();

    for (let i = 0; i < SP3_VIDEO_IDS.length; i += 50) {
      const batch = SP3_VIDEO_IDS.slice(i, i + 50);
      const data = await tiktokGet('/v1.3/file/video/ad/info/', {
        advertiser_id: SP3,
        video_ids: JSON.stringify(batch),
      });
      for (const video of (data.data?.list || [])) {
        if (video.video_cover_url && video.video_id) {
          const imageId = await uploadCoverImage(SP3, video.video_cover_url, video.video_id);
          if (imageId) {
            coverMap.set(video.video_id, imageId);
            console.log(`  [${coverMap.size}/${SP3_VIDEO_IDS.length}] ${video.video_id} → ${imageId}`);
          }
        }
      }
    }
    console.log(`カバー画像: ${coverMap.size}/${SP3_VIDEO_IDS.length}件`);

    // 広告作成
    const creative_list = SP3_VIDEO_IDS.map(videoId => {
      const creativeInfo: any = {
        ad_format: 'SINGLE_VIDEO',
        video_info: { video_id: videoId },
        identity_id: adv.identityId,
        identity_type: 'BC_AUTH_TT',
        identity_authorized_bc_id: adv.identityAuthorizedBcId,
      };
      const coverId = coverMap.get(videoId);
      if (coverId) {
        creativeInfo.image_info = [{ web_uri: coverId }];
      }
      return { creative_info: creativeInfo };
    });

    console.log('\n広告作成中...');
    const adData = await tiktokApi('/v1.3/smart_plus/ad/create/', {
      advertiser_id: SP3,
      adgroup_id: ADGROUP_ID,
      ad_name: AD_NAME,
      creative_list,
      ad_text_list: [{ ad_text: AD_TEXT }],
      landing_page_url_list: [{ landing_page_url: LANDING_PAGE_URL }],
      ad_configuration: { call_to_action_id: ctaId },
      operation_status: 'ENABLE',
      request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
    });
    const adId = String(adData.data?.ad_id || adData.data?.smart_plus_ad_id);

    console.log('\n===== SP3マルチ動画 完了 =====');
    console.log(`広告名: ${AD_NAME}`);
    console.log(`広告ID: ${adId}`);
    console.log(`動画数: ${SP3_VIDEO_IDS.length}本（カバー画像: ${coverMap.size}件）`);

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
