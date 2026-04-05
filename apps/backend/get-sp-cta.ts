import axios from 'axios';
const T = 'https://business-api.tiktok.com/open_api';
const K = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
async function main() {
  for (const [name, id] of [['SP2', '7592868952431362066'], ['SP3', '7616545514662051858']]) {
    const r = await axios.get(`${T}/v1.3/smart_plus/ad/get/`, {
      headers: { 'Access-Token': K },
      params: { advertiser_id: id, page_size: 5 },
    });
    const ads = r.data?.data?.list || [];
    console.log(`${name}: ${ads.length} ads`);
    for (const ad of ads.slice(0, 3)) {
      const ctaId = ad.ad_configuration?.call_to_action_id;
      console.log(`  ${ad.ad_name?.substring(0, 40)} cta_id=${ctaId}`);
    }
    if (ads.length === 0) {
      console.log('  No ads found - need to create CTA manually');
    }
  }
}
main().catch(e => console.error(e.message));
