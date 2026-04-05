/**
 * この広告がSmart+広告かどうか確認
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkIfSmartPlus() {
  try {
    const tiktokAdId = '1848545700919346';

    const ad = await prisma.ad.findUnique({
      where: { tiktokId: tiktokAdId },
      include: {
        adGroup: {
          include: {
            campaign: true,
          },
        },
        creative: true,
      },
    });

    if (!ad) {
      console.log('広告が見つかりません');
      return;
    }

    console.log('========================================');
    console.log('Smart+広告判定');
    console.log('========================================\n');

    console.log('【広告情報】');
    console.log(`  広告名: ${ad.name}`);
    console.log(`  広告ID: ${ad.tiktokId}`);
    console.log(`  ステータス: ${ad.status}\n`);

    console.log('【AdGroup情報】');
    console.log(`  AdGroup名: ${ad.adGroup.name}`);
    console.log(`  最適化目標: ${ad.adGroup.bidType || '不明'}\n`);

    console.log('【Campaign情報】');
    console.log(`  Campaign名: ${ad.adGroup.campaign.name}`);
    console.log(`  目的: ${ad.adGroup.campaign.objectiveType}\n`);

    console.log('【Creative情報】');
    console.log(`  Creative名: ${ad.creative.name}`);
    console.log(`  Creativeタイプ: ${ad.creative.type}\n`);

    // 広告名のパターンをチェック
    const hasManualAdName = ad.name.includes('/');
    const hasExtension = /\.(mp4|jpg|jpeg|png|gif)$/i.test(ad.name);

    console.log('【判定】');
    console.log(`  手動広告名パターン（/を含む）: ${hasManualAdName ? 'YES' : 'NO'}`);
    console.log(`  クリエイティブ名パターン（拡張子あり）: ${hasExtension ? 'YES' : 'NO'}\n`);

    if (hasManualAdName && !hasExtension) {
      console.log('✓ 通常の広告（または新Smart+広告）と判定');
      console.log('  新Smart+広告の場合、/smart_plus/ad/get/ APIから正しいメトリクスを取得すべき\n');
    } else if (!hasManualAdName && hasExtension) {
      console.log('✓ 旧スマートプラス広告のクリエイティブと判定');
      console.log('  キャンペーンレベルでメトリクスを集計すべき\n');
    }

    // 同じキャンペーン内の広告をチェック
    const campaignAds = await prisma.ad.findMany({
      where: {
        adGroup: {
          campaignId: ad.adGroup.campaign.id,
        },
      },
      select: {
        name: true,
        status: true,
      },
    });

    const hasOnlyCreativeNames = campaignAds.every(
      (a) => /\.(mp4|jpg|jpeg|png|gif)$/i.test(a.name)
    );

    const hasManualNames = campaignAds.some(
      (a) => a.name.includes('/') && !/\.(mp4|jpg|jpeg|png|gif)$/i.test(a.name)
    );

    console.log('【キャンペーン内の広告パターン】');
    console.log(`  全ての広告がクリエイティブ名: ${hasOnlyCreativeNames ? 'YES（旧スマートプラス）' : 'NO'}`);
    console.log(`  手動広告名を含む: ${hasManualNames ? 'YES（通常 or 新Smart+）' : 'NO'}\n`);

    console.log('========================================');
    console.log('推奨対応');
    console.log('========================================\n');

    if (hasManualAdName && !hasOnlyCreativeNames) {
      console.log('この広告は新Smart+広告の可能性が高いです。');
      console.log('');
      console.log('対応策:');
      console.log('1. TikTok APIの /smart_plus/ad/get/ エンドポイントで広告情報を取得');
      console.log('2. creative_listから各クリエイティブのメトリクスを集計');
      console.log('3. 集計した値を広告レベルのメトリクスとして保存');
      console.log('');
      console.log('現状:');
      console.log('- おそらく /ad/get/ エンドポイントから間違ったメトリクスを取得している');
      console.log('- またはcreative_listの集計値をそのまま保存している');
    }

  } catch (error) {
    console.error('エラー:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkIfSmartPlus();
