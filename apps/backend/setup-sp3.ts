/**
 * スキルプラス3 (7616545514662051858) の初期セットアップ
 * 1. ピクセル取得
 * 2. アイデンティティ取得
 * 3. DB登録（Advertiser + OAuthToken）
 */
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();
const TIKTOK_API = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const SP3_ID = '7616545514662051858';
const BC_ID = '7440019834009829392';

async function tiktokGet(path: string, params: any) {
  const res = await axios.get(`${TIKTOK_API}${path}`, {
    headers: { 'Access-Token': ACCESS_TOKEN },
    params,
  });
  return res.data;
}

async function main() {
  console.log('=== スキルプラス3 セットアップ ===\n');

  // 1. ピクセル一覧取得
  console.log('1. ピクセル確認...');
  const pixelResp = await tiktokGet('/v1.3/pixel/list/', {
    advertiser_id: SP3_ID,
    page_size: 20,
  });
  const pixels = pixelResp.data?.pixels || [];
  console.log(`  ピクセル数: ${pixels.length}`);
  for (const p of pixels) {
    console.log(`    pixel_id: ${p.pixel_id} | name: ${p.pixel_name} | status: ${p.status}`);
  }

  // 2. アイデンティティ取得
  console.log('\n2. アイデンティティ確認...');
  const identResp = await tiktokGet('/v1.3/identity/get/', {
    advertiser_id: SP3_ID,
    identity_type: 'BC_AUTH_TT',
    identity_authorized_bc_id: BC_ID,
  });
  const identities = identResp.data?.list || identResp.data?.identity_list || [];
  console.log(`  アイデンティティ数: ${identities.length}`);
  for (const id of identities) {
    console.log(`    identity_id: ${id.identity_id} | name: ${id.display_name || id.identity_name}`);
  }

  // SP1/SP2のピクセル・アイデンティティも参照
  console.log('\n参考: SP1/SP2の設定');
  const sp1 = await prisma.advertiser.findUnique({ where: { tiktokAdvertiserId: '7474920444831875080' } });
  const sp2 = await prisma.advertiser.findUnique({ where: { tiktokAdvertiserId: '7592868952431362066' } });
  console.log(`  SP1: pixel=${sp1?.pixelId}, identity=${sp1?.identityId}`);
  console.log(`  SP2: pixel=${sp2?.pixelId}, identity=${sp2?.identityId}`);

  // ピクセルがなければ、BC共有のピクセルを確認
  if (pixels.length === 0) {
    console.log('\n  ピクセルなし → BC共有ピクセルを確認...');
    try {
      const bcPixelResp = await tiktokGet('/v1.3/bc/asset/get/', {
        bc_id: BC_ID,
        asset_type: 'PIXEL',
        advertiser_id: SP3_ID,
        page_size: 20,
      });
      console.log(`  BC共有ピクセル: ${JSON.stringify(bcPixelResp.data).substring(0, 300)}`);
    } catch (e: any) {
      console.log(`  BC共有ピクセル取得エラー: ${e.message?.substring(0, 100)}`);
    }
  }

  // 3. DB登録
  const pixelId = pixels[0]?.pixel_id || '';
  const identityId = identities[0]?.identity_id || '';

  if (pixelId && identityId) {
    console.log(`\n3. DB登録...(pixel=${pixelId}, identity=${identityId})`);

    // Appeal取得（スキルプラス）
    const spAppeal = await prisma.appeal.findFirst({ where: { name: 'スキルプラス' } });

    const adv = await prisma.advertiser.upsert({
      where: { tiktokAdvertiserId: SP3_ID },
      update: {
        name: 'アドネス株式会社_スキルプラス_3',
        pixelId,
        identityId,
        identityAuthorizedBcId: BC_ID,
        appealId: spAppeal?.id,
        timezone: 'Asia/Tokyo',
        currency: 'JPY',
      },
      create: {
        tiktokAdvertiserId: SP3_ID,
        name: 'アドネス株式会社_スキルプラス_3',
        pixelId,
        identityId,
        identityAuthorizedBcId: BC_ID,
        appealId: spAppeal?.id,
        timezone: 'Asia/Tokyo',
        currency: 'JPY',
      },
    });
    console.log(`  Advertiser登録完了: ${adv.id}`);

    // OAuthToken登録
    const token = await prisma.oAuthToken.upsert({
      where: { advertiserId: SP3_ID },
      update: { accessToken: ACCESS_TOKEN },
      create: {
        advertiserId: SP3_ID,
        accessToken: ACCESS_TOKEN,
        refreshToken: '',
        expiresAt: new Date('2099-12-31'),
      },
    });
    console.log(`  OAuthToken登録完了: ${token.id}`);

    console.log('\n✅ セットアップ完了!');
  } else {
    console.log(`\n⚠ ピクセル(${pixelId || 'なし'})またはアイデンティティ(${identityId || 'なし'})が見つかりません。`);
    console.log('  手動で作成するか、TikTok管理画面で設定が必要です。');
  }

  await prisma.$disconnect();
}
main().catch(console.error);
