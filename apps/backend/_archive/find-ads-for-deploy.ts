/**
 * CR00580, CR00585, CR00577, CR00574, CR00588, CR00591 の広告IDを検索
 */
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SP1 = '7474920444831875080';

async function tiktokGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return resp.json();
}

async function main() {
  const targetCRs = ['CR00580', 'CR00585', 'CR00577', 'CR00574', 'CR00588', 'CR00591'];

  // SP1の広告を検索（通常広告API）
  console.log('=== SP1 通常広告検索 ===');
  const adData = await tiktokGet('/v1.3/ad/get/', {
    advertiser_id: SP1,
    filtering: JSON.stringify({}),
    fields: JSON.stringify(['ad_id', 'ad_name', 'video_id', 'status']),
    page_size: '100',
  });

  const ads = adData.data?.list || [];
  console.log(`通常広告: ${ads.length}件`);
  for (const ad of ads) {
    for (const cr of targetCRs) {
      if (ad.ad_name?.includes(cr)) {
        console.log(`  [通常] ${ad.ad_name} → ad_id: ${ad.ad_id}, video_id: ${ad.video_id}, status: ${ad.status}`);
      }
    }
  }

  // SP1のSmart+広告を検索
  console.log('\n=== SP1 Smart+広告検索 ===');
  const spData = await tiktokGet('/v1.3/smart_plus/ad/get/', {
    advertiser_id: SP1,
    page_size: '100',
  });

  const spAds = spData.data?.list || [];
  console.log(`Smart+広告: ${spAds.length}件`);
  for (const ad of spAds) {
    const name = ad.smart_plus_ad_name || ad.ad_name || '';
    for (const cr of targetCRs) {
      if (name.includes(cr)) {
        const creativeList = ad.creative_list || [];
        const videoIds: string[] = [];
        for (const c of creativeList) {
          const vid = c?.creative_info?.video_info?.video_id;
          if (vid && vid !== 'N/A') videoIds.push(vid);
        }
        console.log(`  [Smart+] ${name} → ad_id: ${ad.smart_plus_ad_id || ad.ad_id}, videos: [${videoIds.join(', ')}], status: ${ad.operation_status}`);
      }
    }
  }

  // 全広告名も表示（CRが見つからない場合の確認用）
  console.log('\n=== SP1 最近の全広告名（参考） ===');
  for (const ad of ads.slice(-20)) {
    console.log(`  [通常] ${ad.ad_name} → ${ad.ad_id}`);
  }
  for (const ad of spAds.slice(-30)) {
    const name = ad.smart_plus_ad_name || ad.ad_name || '';
    console.log(`  [SP+] ${name} → ${ad.smart_plus_ad_id || ad.ad_id}`);
  }
}

main().catch(console.error);
