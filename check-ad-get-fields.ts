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

  // ad/get API をfieldsパラメータなしで呼び出し、デフォルトで何が返るか確認
  console.log('=== ad/get API のデフォルトレスポンスを確認 ===\n');

  const response = await axios.get(`${baseUrl}/v1.3/ad/get/`, {
    headers: { 'Access-Token': token.accessToken },
    params: {
      advertiser_id: token.advertiserId,
      filtering: JSON.stringify({
        ad_ids: ['1850472050889730']  // CR00679のad_id
      })
      // fieldsパラメータを指定しない
    }
  });

  console.log('Response without fields parameter:');
  const ad = response.data.data?.list?.[0];
  if (ad) {
    console.log('Keys in response:', Object.keys(ad).sort());
    console.log('\nad_id:', ad.ad_id);
    console.log('ad_name:', ad.ad_name);
    console.log('smart_plus_ad_id:', ad.smart_plus_ad_id);
    console.log('smart_plus_ad_id exists in response:', 'smart_plus_ad_id' in ad);
  }

  // fieldsにsmart_plus_ad_idを明示的に含めて呼び出し
  console.log('\n\n=== ad/get API にsmart_plus_ad_idを明示的に指定 ===\n');

  const response2 = await axios.get(`${baseUrl}/v1.3/ad/get/`, {
    headers: { 'Access-Token': token.accessToken },
    params: {
      advertiser_id: token.advertiserId,
      filtering: JSON.stringify({
        ad_ids: ['1850472050889730']
      }),
      fields: JSON.stringify(['ad_id', 'ad_name', 'smart_plus_ad_id', 'adgroup_id', 'campaign_id'])
    }
  });

  console.log('Response with explicit smart_plus_ad_id field:');
  const ad2 = response2.data.data?.list?.[0];
  if (ad2) {
    console.log('Keys in response:', Object.keys(ad2).sort());
    console.log('\nad_id:', ad2.ad_id);
    console.log('ad_name:', ad2.ad_name);
    console.log('smart_plus_ad_id:', ad2.smart_plus_ad_id);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
