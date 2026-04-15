/**
 * 高CVキャンペーンの上位広告の正体を特定
 * - どの動画が上位に来ているか
 * - 3キャンペーン間で共通する動画はあるか
 * - Smart+広告内の動画リストの並び順と予算配分の関係
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';

async function get(ep: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const r = await fetch(`${BASE}${ep}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return r.json();
}

// 高CVキャンペーン3つ
const TARGETS = [
  {
    label: '85CV (3/31 AI_2)',
    advId: '7523128243466551303',
    campId: '1861004791150721',
    date: '2026-03-31',
    // 上位広告のad_id（前回の分析結果から）
    topAds: [
      { adId: '1861004809630897', spend: 183967, cv: 43 },  // 50.1%
      { adId: '1861004809627777', spend: 64735, cv: 13 },   // 17.6%
      { adId: '1861004809627809', spend: 42506, cv: 14 },   // 11.6%
    ],
  },
  {
    label: '55CV (3/27 AI_1)',
    advId: '7468288053866561553',
    campId: '1860642870567953',
    date: '2026-03-27',
    topAds: [
      { adId: '1860644215212114', spend: 81187, cv: 26 },   // 42.8%
      { adId: '1860644215211074', spend: 78675, cv: 25 },   // 41.5%
    ],
  },
  {
    label: '37CV (4/5 AI_2)',
    advId: '7523128243466551303',
    campId: '1861474097696017',
    date: '2026-04-05',
    topAds: [
      { adId: '1861474109213746', spend: 59407, cv: 20 },   // 63.6%
      { adId: '1861474109213714', spend: 14546, cv: 10 },   // 15.6%
    ],
  },
];

async function main() {
  console.log('=== 高CVキャンペーン上位広告の正体特定 ===\n');

  // 全動画IDを名前と紐づけるためのマップ
  const videoNames = new Map<string, string>();

  for (const t of TARGETS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${t.label} | campaign: ${t.campId}`);
    console.log('='.repeat(60));

    // Smart+広告の詳細取得（creative_list含む）
    let allAds: any[] = [];
    let page = 1;
    while (true) {
      const adResp = await get('/v1.3/smart_plus/ad/get/', {
        advertiser_id: t.advId,
        filtering: JSON.stringify({ campaign_ids: [t.campId] }),
        fields: JSON.stringify(['smart_plus_ad_id', 'ad_name', 'creative_list', 'campaign_id', 'operation_status']),
        page_size: '100',
        page: String(page),
      });
      if (adResp.code !== 0) { console.log('Error:', adResp.message); break; }
      allAds.push(...(adResp.data?.list || []));
      if ((adResp.data?.list || []).length < 100) break;
      page++;
    }

    console.log(`\nSmart+広告数: ${allAds.length}`);

    // 各広告のcreative_listを展開し、ad_idとvideo_idの対応を作る
    // Smart+の場合、1つのSmart+ adに複数creativeがあり、
    // TikTokが内部的にcreativeごとにsub-ad_idを振る
    // → レポートのad_idはsub-ad_id（=creative単位）

    // まず、Smart+広告内のcreative一覧を出力
    for (const ad of allAds) {
      console.log(`\n--- Smart+ Ad: ${ad.smart_plus_ad_id} | ${ad.ad_name} ---`);
      const creatives = ad.creative_list || [];
      console.log(`creative_list (${creatives.length}本):`);
      for (let i = 0; i < creatives.length; i++) {
        const c = creatives[i];
        const videoId = c?.creative_info?.video_info?.video_id || 'N/A';
        const materialId = c?.ad_material_id || 'N/A';
        const coverUri = c?.creative_info?.image_info?.[0]?.web_uri || 'N/A';
        const materialName = c?.creative_info?.material_name || '';
        const status = c?.material_operation_status || '';
        console.log(`  [${i}] material_id=${materialId} | video=${videoId} | status=${status}`);
        if (materialName) console.log(`       name: ${materialName}`);

        // 動画の詳細名取得
        if (videoId !== 'N/A' && !videoNames.has(videoId)) {
          const vInfo = await get('/v1.3/file/video/ad/info/', {
            advertiser_id: t.advId,
            video_ids: JSON.stringify([videoId]),
          });
          const fileName = vInfo.data?.list?.[0]?.file_name || '';
          videoNames.set(videoId, fileName);
        }
        const vName = videoNames.get(videoId) || '';
        if (vName) console.log(`       file: ${vName}`);
      }
    }

    // レポートのad_idとcreativeの紐づけ
    // TikTokのSmart+では、レポートのad_idは各creativeのad_material_idに対応
    console.log(`\n--- 上位広告の特定 ---`);

    // 全creativeのmaterial_idリストを作成
    const materialToVideo = new Map<string, { videoId: string; fileName: string; index: number; adName: string }>();
    for (const ad of allAds) {
      for (let i = 0; i < (ad.creative_list || []).length; i++) {
        const c = ad.creative_list[i];
        const matId = c?.ad_material_id;
        const videoId = c?.creative_info?.video_info?.video_id || '';
        if (matId) {
          materialToVideo.set(matId, {
            videoId,
            fileName: videoNames.get(videoId) || '',
            index: i,
            adName: ad.ad_name,
          });
        }
      }
    }

    // 上位広告のad_idでマッチング
    // ad_idがmaterial_idと一致するか、またはad_idで通常広告APIから取得
    for (const topAd of t.topAds) {
      const match = materialToVideo.get(topAd.adId);
      if (match) {
        console.log(`  ad:${topAd.adId} → video:${match.videoId} [index:${match.index}]`);
        console.log(`    file: ${match.fileName}`);
        console.log(`    spend: ¥${topAd.spend.toLocaleString()} | ${topAd.cv}CV`);
      } else {
        // 通常広告APIで試す
        const adResp = await get('/v1.3/ad/get/', {
          advertiser_id: t.advId,
          filtering: JSON.stringify({ ad_ids: [topAd.adId] }),
          fields: JSON.stringify(['ad_id', 'ad_name', 'video_id']),
        });
        const ad = adResp.data?.list?.[0];
        if (ad) {
          const vName = videoNames.get(ad.video_id) || '';
          if (ad.video_id && !videoNames.has(ad.video_id)) {
            const vInfo = await get('/v1.3/file/video/ad/info/', {
              advertiser_id: t.advId,
              video_ids: JSON.stringify([ad.video_id]),
            });
            const fn = vInfo.data?.list?.[0]?.file_name || '';
            videoNames.set(ad.video_id, fn);
          }
          console.log(`  ad:${topAd.adId} → video:${ad.video_id} (通常広告API)`);
          console.log(`    name: ${ad.ad_name}`);
          console.log(`    file: ${videoNames.get(ad.video_id) || '?'}`);
          console.log(`    spend: ¥${topAd.spend.toLocaleString()} | ${topAd.cv}CV`);
        } else {
          console.log(`  ad:${topAd.adId} → 特定できず`);
          console.log(`    spend: ¥${topAd.spend.toLocaleString()} | ${topAd.cv}CV`);
        }
      }
    }
  }

  // ========================================
  // 共通動画の分析
  // ========================================
  console.log('\n\n' + '='.repeat(60));
  console.log('共通動画分析');
  console.log('='.repeat(60));

  // 全キャンペーンに含まれる動画IDを収集
  const campVideos = new Map<string, Set<string>>();
  for (const t of TARGETS) {
    let allAds: any[] = [];
    let page = 1;
    while (true) {
      const adResp = await get('/v1.3/smart_plus/ad/get/', {
        advertiser_id: t.advId,
        filtering: JSON.stringify({ campaign_ids: [t.campId] }),
        fields: JSON.stringify(['smart_plus_ad_id', 'creative_list']),
        page_size: '100',
        page: String(page),
      });
      if (adResp.code !== 0) break;
      allAds.push(...(adResp.data?.list || []));
      if ((adResp.data?.list || []).length < 100) break;
      page++;
    }

    const videos = new Set<string>();
    for (const ad of allAds) {
      for (const c of ad.creative_list || []) {
        const vid = c?.creative_info?.video_info?.video_id;
        if (vid) videos.add(vid);
      }
    }
    campVideos.set(t.label, videos);
    console.log(`\n${t.label}: ${videos.size}本`);
    for (const vid of videos) {
      console.log(`  ${vid} → ${videoNames.get(vid) || '?'}`);
    }
  }

  // 共通動画を探す
  console.log('\n--- 全3キャンペーン共通の動画 ---');
  const allSets = [...campVideos.values()];
  if (allSets.length >= 2) {
    const common12 = [...allSets[0]].filter(v => allSets[1].has(v));
    const commonAll = common12.filter(v => allSets.length < 3 || allSets[2].has(v));

    if (commonAll.length > 0) {
      for (const vid of commonAll) {
        console.log(`  ✅ ${vid} → ${videoNames.get(vid) || '?'}`);
      }
    } else {
      console.log('  なし');
    }

    console.log('\n--- 2キャンペーン以上で共通 ---');
    const inMultiple = new Map<string, string[]>();
    for (const [label, vids] of campVideos) {
      for (const vid of vids) {
        if (!inMultiple.has(vid)) inMultiple.set(vid, []);
        inMultiple.get(vid)!.push(label);
      }
    }
    for (const [vid, labels] of inMultiple) {
      if (labels.length >= 2) {
        console.log(`  ${vid} → ${videoNames.get(vid) || '?'} | ${labels.join(', ')}`);
      }
    }
  }
}

main().catch(console.error);
