import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function main() {
  const token = await prisma.oAuthToken.findUnique({
    where: { advertiserId: '7468288053866561553' }
  });

  if (!token) {
    console.error('Token not found');
    return;
  }

  const baseUrl = 'https://business-api.tiktok.com/open_api';

  // ad/get API でCR00679/CR00680の詳細を取得
  console.log('=== ad/get API でCR00679/CR00680の詳細を確認 ===\n');

  const targetAdIds = ['1850472050889730', '1850472050886754'];

  const adGetResponse = await axios.get(`${baseUrl}/v1.3/ad/get/`, {
    headers: { 'Access-Token': token.accessToken },
    params: {
      advertiser_id: token.advertiserId,
      filtering: JSON.stringify({
        ad_ids: targetAdIds
      }),
      fields: JSON.stringify([
        'ad_id', 'ad_name', 'smart_plus_ad_id', 'adgroup_id', 'campaign_id',
        'operation_status', 'video_id', 'image_ids', 'create_time', 'modify_time'
      ])
    }
  });

  console.log('ad/get response:');
  const adGetData = adGetResponse.data.data?.list || [];
  adGetData.forEach((ad: any) => {
    console.log(`\nad_id: ${ad.ad_id}`);
    console.log(`ad_name: ${ad.ad_name}`);
    console.log(`smart_plus_ad_id: ${ad.smart_plus_ad_id || 'NULL/undefined'}`);
    console.log(`create_time: ${ad.create_time}`);
    console.log(`modify_time: ${ad.modify_time}`);
    console.log(`video_id: ${ad.video_id}`);
  });

  // smart_plus/ad/get API でも確認
  console.log('\n\n=== smart_plus/ad/get API でCR00679/CR00680の詳細を確認 ===\n');

  const targetSmartPlusIds = ['1850472306618481', '1850472803071026'];

  const smartPlusResponse = await axios.get(`${baseUrl}/v1.3/smart_plus/ad/get/`, {
    headers: { 'Access-Token': token.accessToken },
    params: {
      advertiser_id: token.advertiserId,
      filtering: JSON.stringify({
        smart_plus_ad_ids: targetSmartPlusIds
      })
    }
  });

  console.log('smart_plus/ad/get response:');
  const smartPlusData = smartPlusResponse.data.data?.list || [];
  smartPlusData.forEach((ad: any) => {
    console.log(`\nsmart_plus_ad_id: ${ad.smart_plus_ad_id}`);
    console.log(`ad_name: ${ad.ad_name}`);
    console.log(`operation_status: ${ad.operation_status}`);
    console.log(`create_time: ${ad.create_time}`);
    console.log(`modify_time: ${ad.modify_time}`);
    console.log(`creative_list length: ${ad.creative_list?.length || 0}`);
    if (ad.creative_list && ad.creative_list.length > 0) {
      const firstCreative = ad.creative_list[0];
      console.log(`first creative status: ${firstCreative.material_operation_status}`);
      console.log(`first creative video_id: ${firstCreative.creative_info?.video_info?.video_id}`);
    }
  });

  // CR00675-CR00678も確認（正しく同期されたもの）
  console.log('\n\n=== 比較: CR00675-CR00678 (正しく同期されたもの) ===\n');

  const workingAdIds = ['1850259613343777', '1850259613341697'];  // CR00675, CR00676

  const workingAdsResponse = await axios.get(`${baseUrl}/v1.3/ad/get/`, {
    headers: { 'Access-Token': token.accessToken },
    params: {
      advertiser_id: token.advertiserId,
      filtering: JSON.stringify({
        ad_ids: workingAdIds
      }),
      fields: JSON.stringify([
        'ad_id', 'ad_name', 'smart_plus_ad_id', 'adgroup_id', 'create_time'
      ])
    }
  });

  const workingData = workingAdsResponse.data.data?.list || [];
  workingData.forEach((ad: any) => {
    console.log(`ad_id: ${ad.ad_id}`);
    console.log(`ad_name: ${ad.ad_name}`);
    console.log(`smart_plus_ad_id: ${ad.smart_plus_ad_id || 'NULL'}`);
    console.log(`create_time: ${ad.create_time}`);
    console.log('');
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
