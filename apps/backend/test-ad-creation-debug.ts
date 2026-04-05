import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testAdCreationDebug() {
  console.log('🔍 Ad作成パラメータのデバッグ\n');

  const creativeId = '28434c3c-d563-4bf9-b237-f1f79bea1bc7';

  // Creativeを取得
  const creative = await prisma.creative.findUnique({
    where: { id: creativeId },
  });

  if (!creative) {
    console.error('❌ Creative not found:', creativeId);
    await prisma.$disconnect();
    return;
  }

  console.log('📊 Creative情報:');
  console.log(`  ID: ${creative.id}`);
  console.log(`  Name: ${creative.name}`);
  console.log(`  Type: ${creative.type}`);
  console.log(`  TikTok Video ID: ${creative.tiktokVideoId}`);
  console.log(`  TikTok Image ID (Thumbnail): ${creative.tiktokImageId}`);
  console.log('');

  // campaign-builder.service.ts の createAd メソッドで使用されるパラメータを再現
  const adName = 'テスト広告_debug';
  const advertiserId = '7247073333517238273';
  const adgroupId = '1848402640234705'; // 前回作成されたAdGroup ID
  const landingPageUrl = 'https://school.addness.co.jp/page/s4HNscou95B5';
  const appealName = 'SNS';

  // 広告テキスト生成
  const adText = appealName === 'SNS'
    ? 'SNSで独立するなら学んでおきたい本質のSNSマーケ特商法（https://skill.addness.co.jp/tokushoho）'
    : 'AIで独立するなら学んでおきたい本質のAI活用術特商法（https://skill.addness.co.jp/tokushoho）';

  console.log('🎯 createAdメソッドに渡されるパラメータ:');
  console.log('─'.repeat(80));

  if (creative.type === 'VIDEO') {
    if (!creative.tiktokImageId) {
      console.error('❌ ERROR: Video creative missing thumbnail image ID!');
      console.error('   このエラーは campaign-builder.service.ts line 229 で発生するはずです');
    } else {
      console.log('✅ VIDEO creative - 以下のパラメータで createAd を呼び出します:');
      console.log('');
      console.log('  advertiserId:', advertiserId);
      console.log('  adgroupId:', adgroupId);
      console.log('  adName:', adName);
      console.log('  options: {');
      console.log('    identity: "a356c51a-18f2-5f1e-b784-ccb3b107099e"');
      console.log(`    videoId: "${creative.tiktokVideoId}"`);
      console.log(`    imageIds: ["${creative.tiktokImageId}"]  ← サムネイル画像ID`);
      console.log(`    adText: "${adText}"`);
      console.log('    callToAction: "LEARN_MORE"');
      console.log(`    landingPageUrl: "${landingPageUrl}"`);
      console.log('    displayMode: "AD_ONLY"');
      console.log('    creativeAuthorized: false');
      console.log('  }');
      console.log('');
      console.log('📤 TikTok APIに送信されるリクエストボディ（推測）:');
      console.log('─'.repeat(80));
      const creative_obj = {
        ad_name: adName,
        ad_text: adText,
        call_to_action: 'LEARN_MORE',
        landing_page_url: landingPageUrl,
        display_name: 'a356c51a-18f2-5f1e-b784-ccb3b107099e',
        identity_id: 'a356c51a-18f2-5f1e-b784-ccb3b107099e',
        identity_type: 'TT_USER',
        video_id: creative.tiktokVideoId,
        ad_format: 'SINGLE_VIDEO',
        image_ids: [creative.tiktokImageId],
      };
      const requestBody = {
        advertiser_id: advertiserId,
        adgroup_id: adgroupId,
        is_smart_creative: false,
        creatives: [creative_obj],
      };
      console.log(JSON.stringify(requestBody, null, 2));
      console.log('─'.repeat(80));
      console.log('');
      console.log('🔑 重要なポイント:');
      console.log('  ✓ ad_format: "SINGLE_VIDEO"');
      console.log(`  ✓ video_id: "${creative.tiktokVideoId}"`);
      console.log(`  ✓ image_ids: ["${creative.tiktokImageId}"]`);
      console.log('');
      console.log('💡 このリクエストでも "You must upload an image" エラーが出る場合:');
      console.log('   1. image_id が有効でない可能性');
      console.log('   2. TikTok API v1.3 の SINGLE_VIDEO フォーマットが異なる仕様の可能性');
      console.log('   3. 他の必須パラメータが不足している可能性');
    }
  } else if (creative.type === 'IMAGE') {
    console.log('✅ IMAGE creative - 以下のパラメータで createAd を呼び出します:');
    console.log('');
    console.log('  options: {');
    console.log('    identity: "a356c51a-18f2-5f1e-b784-ccb3b107099e"');
    console.log(`    imageIds: ["${creative.tiktokImageId}"]`);
    console.log(`    adText: "${adText}"`);
    console.log('    callToAction: "LEARN_MORE"');
    console.log(`    landingPageUrl: "${landingPageUrl}"`);
    console.log('    displayMode: "AD_ONLY"');
    console.log('    creativeAuthorized: false');
    console.log('  }');
  }

  await prisma.$disconnect();
}

testAdCreationDebug().catch(console.error);
