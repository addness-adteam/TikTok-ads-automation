import { PrismaClient } from '@prisma/client';
import { TiktokService } from './src/tiktok/tiktok.service';
import * as dotenv from 'dotenv';
import * as path from 'path';
import axios from 'axios';
dotenv.config({ path: path.resolve(__dirname, '.env') });

const prisma = new PrismaClient();
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const ADVERTISER_ID = '7468288053866561553';

async function main() {
  // 1. Smart+ APIから広告を取得
  console.log('=== Smart+ API ===');
  try {
    const spResp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/smart_plus/ad/get/', {
      params: {
        advertiser_id: ADVERTISER_ID,
        filtering: JSON.stringify({ operation_status: 'ENABLE' }),
        page_size: 100,
      },
      headers: { 'Access-Token': ACCESS_TOKEN },
    });
    const spAds = spResp.data?.data?.list || [];
    console.log(`Smart+ ads: ${spAds.length}件`);

    // CR01190を探す
    const cr1190sp = spAds.filter((a: any) =>
      (a.ad_name || '').includes('CR01190')
    );
    console.log(`CR01190 in Smart+ API: ${cr1190sp.length}件`);
    for (const a of cr1190sp) {
      console.log(`  smart_plus_ad_id: ${a.smart_plus_ad_id}`);
      console.log(`  ad_id: ${a.ad_id}`);
      console.log(`  ad_name: ${a.ad_name}`);
      console.log(`  adgroup_id: ${a.adgroup_id}`);
    }

    // Smart+ ad_id一覧
    const spAdIds = new Set(spAds.map((a: any) => a.smart_plus_ad_id));
    console.log(`\nSmart+ ad IDs: ${[...spAdIds].join(', ')}`);

  } catch (e: any) {
    console.log(`Smart+ API error: ${e.response?.data?.message || e.message}`);
  }

  // 2. 通常 ad/get APIから広告を取得
  console.log('\n=== Regular ad/get API ===');
  try {
    const regResp = await axios.get('https://business-api.tiktok.com/open_api/v1.3/ad/get/', {
      params: {
        advertiser_id: ADVERTISER_ID,
        filtering: JSON.stringify({ operation_status: 'ENABLE' }),
        page_size: 100,
      },
      headers: { 'Access-Token': ACCESS_TOKEN },
    });
    const regAds = regResp.data?.data?.list || [];
    console.log(`Regular ads: ${regAds.length}件`);

    // CR01190を探す
    const cr1190reg = regAds.filter((a: any) =>
      (a.ad_name || '').includes('CR01190')
    );
    console.log(`CR01190 in Regular API: ${cr1190reg.length}件`);
    for (const a of cr1190reg) {
      console.log(`  ad_id: ${a.ad_id}`);
      console.log(`  smart_plus_ad_id: ${a.smart_plus_ad_id || 'none'}`);
      console.log(`  ad_name: ${a.ad_name}`);
      console.log(`  adgroup_id: ${a.adgroup_id}`);
    }

    // CR01190がsmart_plus_ad_idを持つか
    for (const a of cr1190reg) {
      if (a.smart_plus_ad_id) {
        console.log(`\n⚠️ CR01190 has smart_plus_ad_id in regular API: ${a.smart_plus_ad_id}`);
      }
    }
  } catch (e: any) {
    console.log(`Regular API error: ${e.response?.data?.message || e.message}`);
  }

  // 3. Snapshot全adIdで、同じadgroupを使ってるものを確認
  console.log('\n=== adgroup 1861895774239058 関連Snapshot ===');
  // adgroup IDからは直接検索できないので、ChangeLogで確認
  const cls = await prisma.changeLog.findMany({
    where: {
      entityId: '1861895774239058',
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  console.log(`ChangeLog for adgroup: ${cls.length}件`);
  for (const cl of cls) {
    const jst = new Date(cl.createdAt.getTime() + 9 * 60 * 60 * 1000);
    const bd = cl.beforeData as any;
    const ad = cl.afterData as any;
    console.log(`  ${jst.toISOString().slice(0, 16)} | ${cl.action} | ${cl.source} | ${bd?.budget}→${ad?.budget}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
