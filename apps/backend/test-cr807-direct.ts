const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';
const ADV_ID = '7468288053866561553';

async function main() {
  // まずテスト用キャンペーン + 広告グループを作ってvideo_idが使えるか確認
  // ad/createでvideo_idを指定して、エラー内容から判断

  // 既存のキャンペーン/広告グループを使ってテスト
  // まずは最小限のバリデーションチェック - video/ad/info のレスポンスを詳しく見る
  
  // 全動画を検索して7599678317318897671を探す
  console.log('=== 動画ライブラリ全検索 ===');
  let page = 1;
  let found = false;
  while (page <= 5 && !found) {
    const r = await fetch(`${BASE}/v1.3/file/video/ad/search/?advertiser_id=${ADV_ID}&page=${page}&page_size=100`, {
      headers: { 'Access-Token': ACCESS_TOKEN },
    });
    const d = await r.json();
    const videos = d.data?.list || [];
    console.log(`Page ${page}: ${videos.length} videos`);
    
    for (const v of videos) {
      // Check various ID fields
      const ids = [v.video_id, v.item_id, v.material_id].filter(Boolean);
      if (ids.includes('7599678317318897671')) {
        console.log('FOUND!', JSON.stringify(v, null, 2));
        found = true;
        break;
      }
    }
    
    if (videos.length < 100) break;
    page++;
  }
  
  if (!found) {
    console.log('動画ライブラリに見つからず');
    
    // 最新の動画IDフォーマットを確認
    const r = await fetch(`${BASE}/v1.3/file/video/ad/search/?advertiser_id=${ADV_ID}&page=1&page_size=3`, {
      headers: { 'Access-Token': ACCESS_TOKEN },
    });
    const d = await r.json();
    for (const v of (d.data?.list || []).slice(0, 3)) {
      console.log(`  sample video_id: ${v.video_id} | keys: ${Object.keys(v).join(',')}`);
    }
  }
}
main();
