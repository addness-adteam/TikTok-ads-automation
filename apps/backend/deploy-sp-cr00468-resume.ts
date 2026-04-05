/**
 * SP CR00468 横展開 再開
 * 動画UL・UTAGE完了済み → Smart+キャンペーン/広告グループ/広告を作成
 */
import axios from 'axios';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

const TIKTOK_API = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';

const adText = '【大好評！】スキル習得セミナー AIは教えてくれない、会社に依存しない生き方';

const deploys = [
  {
    name: 'SP2',
    advertiserId: '7592868952431362066',
    pixelId: '7606956193143210002',
    identityId: '55fc7dd2-572d-5945-8363-0b45f294473c',
    ctaId: '7617402087177014280',
    campaignId: '1860115581112322',
    adgroupId: '1860115962392738', // 作成済み
    adName: '260320/清水絢吾/スマプラ/CVポイント検証/LP2-CR00511',
    utageRegistrationPath: 'TikTok広告-スキルプラス-LP2-CR00511',
    utageDestinationUrl: 'https://school.addness.co.jp/p/doc7hffUAVTv?ftid=wsVKbapBWRds',
    crNumber: 511,
    videoIds: [
      'v10033g50000d6u3ennog65jhbniiupg','v10033g50000d6u3fanog65qb0atfkdg','v10033g50000d6u3ftnog65tuu8opnng',
      'v10033g50000d6u3ghnog65gqgjnp3q0','v10033g50000d6u3hafog65safn29ssg','v10033g50000d6u3hvfog65l8q6u4mjg',
      'v10033g50000d6u3igvog65n1l13bmi0','v10033g50000d6u3iuvog65gj2jaavd0','v10033g50000d6u3jbvog65h6hgrvvig',
      'v10033g50000d6u3k0nog65nbpg8r90g','v10033g50000d6u3k67og65m8du47lsg','v10033g50000d6u3klnog65puer21vc0',
      'v10033g50000d6u3l77og65me5j9vt5g','v10033g50000d6u3lpfog65jqi1crmag','v10033g50000d6u3mm7og65h6hgs64hg',
      'v10033g50000d6u3msvog65slsl065jg','v10033g50000d6u3n2fog65nbpg90s70','v10033g50000d6u3n6fog65geh2ptlkg',
      'v10033g50000d6u3n9fog65hkeiu92d0','v10033g50000d6u3ndnog65nbpg91h10','v10033g50000d6u3nqvog65h6hgs89o0',
    ],
  },
  {
    name: 'SP3',
    advertiserId: '7616545514662051858',
    pixelId: '7617659343252586503',
    identityId: '6fac7e18-0297-5ad3-9849-1de69197cd95',
    ctaId: '7618606408161954834',
    campaignId: '1860115581112338',
    adgroupId: '1860115992763394', // 作成済み
    adName: '260320/清水絢吾/スマプラ/CVポイント検証/LP2-CR00512',
    utageRegistrationPath: 'TikTok広告-スキルプラス-LP2-CR00512',
    utageDestinationUrl: 'https://school.addness.co.jp/p/doc7hffUAVTv?ftid=A9kxd4sxrpcE',
    crNumber: 512,
    videoIds: [
      'v10033g50000d6u3obfog65qporeh5r0','v10033g50000d6u3onfog65peoe6lreg','v10033g50000d6u3p0nog65qb0au01l0',
      'v10033g50000d6u3pbnog65n25c1te30','v10033g50000d6u3pm7og65huc61t4mg','v10033g50000d6u3q0fog65vcc4f44a0',
      'v10033g50000d6u3q97og65igulkkvr0','v10033g50000d6u3qh7og65h6hgsd930','v10033g50000d6u3qp7og65kpqlbgfa0',
      'v10033g50000d6u3r57og65ls3g4hojg','v10033g50000d6u3r97og65o8lmtgvog','v10033g50000d6u3rjnog65tale1uoq0',
      'v10033g50000d6u3rv7og65o8lmtieig','v10033g50000d6u3sa7og65ucgkjlm0g','v10033g50000d6u3smfog65h6hgshaeg',
      'v10033g50000d6u3sr7og65voa41o7u0','v10033g50000d6u3sv7og65rel4uph5g','v10033g50000d6u3t27og65k6vvv7ip0',
      'v10033g50000d6u3t4vog65ja1p4929g','v10033g50000d6u3t7vog65hj44susfg',
    ], // 21本目はundefinedだったので20本
  },
];

async function tiktokPost(path: string, data: any) {
  const res = await axios.post(`${TIKTOK_API}${path}`, data, {
    headers: { 'Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' },
  });
  return res.data;
}

async function main() {
  for (const d of deploys) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 CR00468 → ${d.name} (${d.advertiserId})`);
    console.log(`  動画: ${d.videoIds.length}本, UTAGE: ${d.utageRegistrationPath}`);

    try {
      // キャンペーン・広告グループは作成済み
      const campaignId = d.campaignId;
      const adgroupId = d.adgroupId;
      console.log(`  キャンペーン: ${campaignId}, 広告グループ: ${adgroupId}`);

      // 3. 動画カバー画像をアップロード
      console.log('  3. 動画カバー画像アップロード...');
      const videoInfoResp = await axios.get(`${TIKTOK_API}/v1.3/file/video/ad/info/`, {
        headers: { 'Access-Token': ACCESS_TOKEN },
        params: { advertiser_id: d.advertiserId, video_ids: JSON.stringify(d.videoIds) },
      });
      const videoInfos = videoInfoResp.data?.data?.list || [];

      const creativeList = [];
      let imgCount = 0;
      let coverCount = 0;
      for (const vid of d.videoIds) {
        const info = videoInfos.find((v: any) => v.video_id === vid);
        const coverUrl = info?.video_cover_url || '';
        // URLからweb_uriを抽出: tos-alisg-p-XXXX/YYYYYYY
        const webUriMatch = coverUrl.match(/(tos-[^~?]+)/);
        const webUri = webUriMatch ? webUriMatch[1] : '';
        if (webUri) coverCount++;

        creativeList.push({
          creative_info: {
            ad_format: 'SINGLE_VIDEO',
            video_info: { video_id: vid },
            image_info: webUri ? [{ web_uri: webUri }] : [],
            identity_id: d.identityId,
            identity_type: 'BC_AUTH_TT',
            identity_authorized_bc_id: '7440019834009829392',
          },
        });
      }
      console.log(`    カバー画像: ${coverCount}/${d.videoIds.length}本`);

      // 4. Smart+広告作成
      console.log('  4. Smart+広告作成...');
      const lpUrl = `${d.utageDestinationUrl}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;
      const adResp = await tiktokPost('/v1.3/smart_plus/ad/create/', {
        advertiser_id: d.advertiserId,
        adgroup_id: adgroupId,
        ad_name: d.adName,
        creative_list: creativeList,
        ad_text_list: [{ ad_text: adText }],
        landing_page_url_list: [{ landing_page_url: lpUrl }],
        ad_configuration: {
          call_to_action_id: d.ctaId,
          creative_auto_add_toggle: true,
          dark_post_status: 'ON',
        },
        operation_status: 'ENABLE',
        request_id: String(Date.now()) + String(Math.floor(Math.random() * 10000)),
      });
      if (adResp.code !== 0) throw new Error(`Ad: ${JSON.stringify(adResp)}`);
      const adId = adResp.data?.ad_id || adResp.data?.ad_ids?.[0];

      console.log(`  ✅ 成功!`);
      console.log(`    Ad ID: ${adId}`);
      console.log(`    Ad Name: ${d.adName}`);
      console.log(`    UTAGE経路: ${d.utageRegistrationPath}`);
      console.log(`    動画: ${d.videoIds.length}本`);
      console.log(`    日予算: ¥5,000`);

    } catch (e: any) {
      console.log(`  ❌ エラー: ${e.message?.substring(0, 300)}`);
      if (e.response?.data) console.log(`    API: ${JSON.stringify(e.response.data).substring(0, 300)}`);
    }
  }
  console.log('\n=== 完了 ===');
}
main().catch(console.error);
