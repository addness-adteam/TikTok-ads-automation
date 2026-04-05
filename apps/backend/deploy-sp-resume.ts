/**
 * リジュームスクリプト: カバー画像アップロード → Smart+広告作成のみ
 * 動画アップロード・UTAGE経路は前回実行済み
 */

import { PrismaClient } from '@prisma/client';

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api';
const ACCESS_TOKEN = '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const DAILY_BUDGET = 5000;
const AD_TEXT = 'スキルで独立するなら学んでおきたい本質のスキル活用術特商法（https://skill.addness.co.jp/tokushoho）';

// ===== 前回の実行結果（ハードコード） =====

// SP1のソース動画ID
const SP1_VIDEO_IDS = [
  'v10033g50000d53oaavog65ubhl50sdg','v10033g50000d5pcpqfog65im07g3uhg','v10033g50000d5m847fog65j19ous5ig',
  'v10033g50000d3oatbvog65o47fni300','v10033g50000d5i9eqnog65gre3a7a10','v10033g50000d4a7uo7og65lc7nq1t60',
  'v10033g50000d5uuc17og65rh1umbkag','v10033g50000d5r2d07og65mjr9hrqug','v10033g50000d3qq2ofog65vhp9ja2q0',
  'v10033g50000d5uutlfog65o2279nu30','v10033g50000d5ms5e7og65pd3hoh9s0','v10033g50000d4a0cknog65n6u4ng0g0',
  'v10033g50000d5i978fog65o0nku13j0','v10033g50000d4408vfog65qlrnp8cu0','v10033g50000d42t977og65g2f5j52j0',
  'v10033g50000d41jflnog65hh7u38fkg','v10033g50000d41jegfog65rsmg53vb0','v10033g50000d41jdtnog65ksg5nggug',
  'v10033g50000d41jdb7og65tr2tdfhpg','v10033g50000d3sgb0nog65komg77jd0','v10033g50000d3qq617og65ivolehqgg',
  'v10033g50000d3q83afog65pi7bskqlg','v10033g50000d4408vfog65ke17vvii0','v10033g50000d4408vfog65tdj0bs7kg',
  'v10033g50000d4417r7og65g8isc7phg','v10033g50000d44c6lfog65mh2mi3280','v10033g50000d44hl5nog65nu13dvpo0',
  'v10033g50000d44nmlfog65qratfa620','v10033g50000d44tbdvog65jq6qlbq90','v10033g50000d4539tnog65kub70tgo0',
  'v10033g50000d3pqv67og65kbm6kce40','v10033g50000d3jjhd7og65kjmr77ht0','v10033g50000d447k27og65g2f75d2m0',
  'v10033g50000d3pqv5nog65ob4jbvmv0','v10033g50000d3jjho7og65tpkd1alq0','v10033g50000d3qq2ofog65tfetphdeg',
  'v10033g50000d3pqv5nog65gcn9r8fb0','v10033g50000d4889anog65rdkd85j90','v10033g50000d3qq61fog65mr67vuq40',
  'v10033g50000d488gfvog65s7qu281mg','v10033g50000d41unvnog65vo6v5u1u0','v10033g50000d488gfnog65itedcejlg',
  'v10033g50000d488gfnog65ge10l1gd0','v10033g50000d3pqv5nog65p0ctfu9u0','v10033g50000d3pqv5nog65uu0heud60',
  'v10033g50000d3pqv5vog65lcmufjm70','v10033g50000d488gfnog65qu8hc4feg','v10033g50000d3pqv5nog65gkctctb90',
  'v10033g50000d48idavog65r60okcft0','v10033g50000d48h9ffog65voa8gf4pg',
];

// SP2にアップロード済みの動画ID（前回実行で取得）
const SP2_VIDEO_IDS = [
  'v10033g50000d77187nog65kv5tceaf0','v10033g50000d7718afog65ti04qbo90','v10033g50000d7718cvog65sucac5pl0',
  'v10033g50000d7718ifog65mljph4hfg','v10033g50000d7718pvog65ktn8icif0','v10033g50000d7718sfog65vmlhb8ma0',
  'v10033g50000d7718tfog65jmun6bp30','v10033g50000d7718uvog65pmrjf4jrg','v10033g50000d771927og65jagdu6gk0',
  'v10033g50000d77196fog65sq8bml7vg','v10033g50000d7719gfog65thdtkuf8g','v10033g50000d7719jfog65rihjcod00',
  'v10033g50000d7719lvog65j1l7nlm20','v10033g50000d7719ofog65kv8gdjh80','v10033g50000d7719s7og65hi8j3q2og',
  'v10033g50000d7719tfog65vbotimtg0','v10033g50000d771a0fog65nl4drrv70','v10033g50000d771a3nog65o79r9tlkg',
  'v10033g50000d771a6fog65ictn5u5hg','v10033g50000d771a9fog65gvge3kbk0','v10033g50000d771aefog65s8khmu9bg',
  'v10033g50000d771aifog65qcb65dvfg','v10033g50000d771akvog65j315601i0','v10033g50000d771anvog65hsmjin2jg',
  'v10033g50000d771aqnog65s0g2qn600','v10033g50000d771asfog65kv5tci8d0','v10033g50000d771atnog65reqkea8eg',
  'v10033g50000d771auvog65q2b2ct2dg','v10033g50000d771b0fog65lo6igqbf0','v10033g50000d771b1nog65o7q7eegb0',
  'v10033g50000d771b3vog65vo59ajbc0','v10033g50000d771b6fog65jd16bcqa0','v10033g50000d771b8vog65kff3hp3tg',
  'v10033g50000d771bafog65r8ifiek8g','v10033g50000d771bd7og65v6st0ssa0','v10033g50000d771bfvog65ssjup7oog',
  'v10033g50000d771bjnog65ukeu9gd6g','v10033g50000d771blvog65t26u7a9ng','v10033g50000d771bofog65g4it8njn0',
  'v10033g50000d771bsnog65vosjtlp7g','v10033g50000d771bvvog65he2fkk71g','v10033g50000d771c2fog65mrl4oht0g',
  'v10033g50000d771c5fog65vosjtm5s0','v10033g50000d771c8fog65v7qcp9iug','v10033g50000d771cavog65uck1lrla0',
  'v10033g50000d771cd7og65sf1tqoufg','v10033g50000d771cfnog65sdb585h4g','v10033g50000d771ci7og65s0f1g7hrg',
  'v10033g50000d771ckvog65jbnp7v270','v10033g50000d771cmvog65ho2uo623g',
];

// SP3にアップロード済みの動画ID
const SP3_VIDEO_IDS = [
  'v10033g50000d771897og65sjr29q7rg','v10033g50000d7718bfog65sucac5nfg','v10033g50000d7718enog65qpe7u3dg0',
  'v10033g50000d7718mnog65omqm79ajg','v10033g50000d7718r7og65rubtl1tt0','v10033g50000d7718svog65kqf2fdu30',
  'v10033g50000d7718tnog65v77icjq4g','v10033g50000d77190fog65t26u769qg','v10033g50000d77193nog65knb9ot6j0',
  'v10033g50000d7719bnog65kgl9r04p0','v10033g50000d7719hnog65satqbi7tg','v10033g50000d7719knog65he2fkg3i0',
  'v10033g50000d7719mvog65t2odcpa60','v10033g50000d7719qfog65kfloli8g0','v10033g50000d7719snog65ipkrpca0g',
  'v10033g50000d7719uvog65ragfh0epg','v10033g50000d771a27og65ui4ln18k0','v10033g50000d771a4nog65vhirmu6hg',
  'v10033g50000d771a7nog65uhd6mlsi0','v10033g50000d771abvog65ti0b5cccg','v10033g50000d771agfog65r1p79bgr0',
  'v10033g50000d771ajfog65lsg9dral0','v10033g50000d771am7og65gn5o0em60','v10033g50000d771ap7og65gq93387l0',
  'v10033g50000d771ar7og65n8phq6sd0','v10033g50000d771asvog65t2odcr4o0','v10033g50000d771au7og65j31560hh0',
  'v10033g50000d771avfog65p0255egfg','v10033g50000d771b0vog65n1nha3mq0','v10033g50000d771b2fog65s8imh81pg',
  'v10033g50000d771b4vog65s8khmvadg','v10033g50000d771b7fog65jcnrfsio0','v10033g50000d771b9fog65pllu3b4f0',
  'v10033g50000d771bbfog65l7sju2el0','v10033g50000d771bdvog65sdb584030','v10033g50000d771bhnog65jcnrft2dg',
  'v10033g50000d771bknog65ltpbh95vg','v10033g50000d771bmvog65kqf2fjjpg','v10033g50000d771bpvog65ns9lnggm0',
  'v10033g50000d771btnog65k0ft2b3og','v10033g50000d771c0nog65h38as4it0','v10033g50000d771c3vog65i9bg2jjb0',
  'v10033g50000d771c6nog65mp28nha30','v10033g50000d771c9fog65nq9dk96vg','v10033g50000d771cbvog65s9m6njge0',
  'v10033g50000d771ce7og65g0h307hl0','v10033g50000d771cgvog65infs0qtq0','v10033g50000d771cj7og65gml01933g',
  'v10033g50000d771clnog65lbb72t330','v10033g50000d771cnfog65ictn61t4g',
];

// UTAGE経路（前回作成済み）
const UTAGE_RESULTS = [
  { crNumber: 568, destinationUrl: 'https://school.addness.co.jp/p/doc7hffUAVTv?ftid=VS5s9tOWRyhe' },
  { crNumber: 569, destinationUrl: 'https://school.addness.co.jp/p/doc7hffUAVTv?ftid=OTmOtTOhKntM' },
  { crNumber: 570, destinationUrl: 'https://school.addness.co.jp/p/doc7hffUAVTv?ftid=ymg4ihm4a4lN' },
];

// SP1は前回キャンペーン/Adgroup作成済み
const SP1_EXISTING = { campaignId: '1861341763438801', adgroupId: '1861341763441857' };

const ACCOUNTS = [
  { advertiserId: '7474920444831875080', name: 'スキルプラス1', videoIds: SP1_VIDEO_IDS, existing: SP1_EXISTING },
  { advertiserId: '7592868952431362066', name: 'スキルプラス2', videoIds: SP2_VIDEO_IDS, existing: null },
  { advertiserId: '7616545514662051858', name: 'スキルプラス3', videoIds: SP3_VIDEO_IDS, existing: null },
];

// ===== API helpers =====
async function tiktokApi(endpoint: string, body: any): Promise<any> {
  console.log(`  API: ${endpoint}`);
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Access-Token': ACCESS_TOKEN },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`TikTok API エラー: ${data.message} (code: ${data.code})\n${JSON.stringify(data, null, 2)}`);
  return data;
}

async function tiktokGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const resp = await fetch(`${TIKTOK_API_BASE}${endpoint}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`TikTok API エラー: ${data.message} (code: ${data.code})`);
  return data;
}

function getJstNow(): Date { return new Date(Date.now() + 9 * 60 * 60 * 1000); }
function isAfter15Jst(): boolean { return getJstNow().getUTCHours() >= 15; }
function getDeliveryDate(): Date { const jst = getJstNow(); if (isAfter15Jst()) jst.setUTCDate(jst.getUTCDate() + 1); return jst; }
function getJstDateStr(): string { const d = getDeliveryDate(); return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`; }
function getJstScheduleTime(): string {
  if (isAfter15Jst()) {
    const d = getDeliveryDate(); d.setUTCDate(d.getUTCDate() - 1);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} 15:00:00`;
  } else {
    const t = new Date(Date.now() + 5 * 60 * 1000);
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}:${String(t.getUTCSeconds()).padStart(2, '0')}`;
  }
}

// ===== カバー画像 =====
async function getVideoCoverUrl(advertiserId: string, videoId: string): Promise<string | null> {
  for (let i = 0; i < 3; i++) {
    try {
      const data = await tiktokGet('/v1.3/file/video/ad/info/', {
        advertiser_id: advertiserId, video_ids: JSON.stringify([videoId]),
      });
      const video = data.data?.list?.[0];
      if (video?.video_cover_url) return video.video_cover_url;
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

async function uploadCoverImageByUrl(advertiserId: string, imageUrl: string): Promise<string | null> {
  try {
    const data = await tiktokApi('/v1.3/file/image/ad/upload/', {
      advertiser_id: advertiserId, upload_type: 'UPLOAD_BY_URL', image_url: imageUrl,
    });
    return data.data?.web_uri || data.data?.image_id || null;
  } catch { return null; }
}

// ===== Smart+ 作成 =====
async function getCtaId(advertiserId: string): Promise<string> {
  const data = await tiktokGet('/v1.3/smart_plus/ad/get/', { advertiser_id: advertiserId, page_size: '5' });
  return data.data?.list?.[0]?.ad_configuration?.call_to_action_id || '';
}

async function createSmartPlusCampaign(advertiserId: string, campaignName: string): Promise<string> {
  const data = await tiktokApi('/v1.3/smart_plus/campaign/create/', {
    advertiser_id: advertiserId, campaign_name: campaignName,
    objective_type: 'LEAD_GENERATION', budget_mode: 'BUDGET_MODE_INFINITE', budget_optimize_on: false,
    request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
  });
  return String(data.data.campaign_id);
}

async function createSmartPlusAdGroup(advertiserId: string, campaignId: string, pixelId: string): Promise<string> {
  const ageGroups = ['AGE_25_34', 'AGE_35_44', 'AGE_45_54'];
  const data = await tiktokApi('/v1.3/smart_plus/adgroup/create/', {
    advertiser_id: advertiserId, campaign_id: campaignId,
    adgroup_name: `${getJstDateStr()} 25-34, 35-44, 45-54`,
    budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET', budget: DAILY_BUDGET,
    billing_event: 'OCPM', bid_type: 'BID_TYPE_NO_BID',
    optimization_goal: 'CONVERT', optimization_event: 'ON_WEB_REGISTER',
    pixel_id: pixelId, promotion_type: 'LEAD_GENERATION', promotion_target_type: 'EXTERNAL_WEBSITE',
    placement_type: 'PLACEMENT_TYPE_NORMAL', placements: ['PLACEMENT_TIKTOK'],
    comment_disabled: true, schedule_type: 'SCHEDULE_FROM_NOW', schedule_start_time: getJstScheduleTime(),
    targeting_spec: { location_ids: ['1861060'], age_groups: ageGroups },
    request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
  });
  const adgroupId = String(data.data.adgroup_id);

  console.log('   ターゲティング検証中（5秒待機）...');
  await new Promise(r => setTimeout(r, 5000));
  try {
    const v = await tiktokGet('/v1.3/smart_plus/adgroup/get/', { advertiser_id: advertiserId, adgroup_ids: JSON.stringify([adgroupId]) });
    const actual = v.data?.list?.[0]?.targeting_spec?.age_groups || [];
    if (!ageGroups.every(g => actual.includes(g)) || actual.length !== ageGroups.length) {
      console.log('   ⚠ ターゲティング修正...');
      await tiktokApi('/v1.3/smart_plus/adgroup/update/', {
        advertiser_id: advertiserId, adgroup_id: adgroupId,
        targeting_spec: { location_ids: ['1861060'], age_groups: ageGroups },
      });
      await new Promise(r => setTimeout(r, 3000));
    }
    console.log('   ✅ ターゲティングOK');
  } catch (e: any) { console.log(`   ⚠ 検証失敗: ${e.message}`); }
  return adgroupId;
}

// ===== メイン =====
async function main() {
  console.log('===== リジューム: カバー画像 + Smart+広告作成 =====');
  console.log(`広告名日付: ${getJstDateStr()}\n`);

  const prisma = new PrismaClient();
  try {
    // 1. SP1ソース動画からカバーURL一括取得
    console.log('--- 1. カバーURL取得（SP1ソース動画50本） ---');
    const sourceCoverUrls: (string | null)[] = [];
    for (let i = 0; i < SP1_VIDEO_IDS.length; i++) {
      const url = await getVideoCoverUrl('7474920444831875080', SP1_VIDEO_IDS[i]);
      sourceCoverUrls.push(url);
      if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${SP1_VIDEO_IDS.length}...`);
    }
    console.log(`  取得完了: ${sourceCoverUrls.filter(u => u).length}/${SP1_VIDEO_IDS.length}本\n`);

    // 2. 各アカウントにカバー画像アップロード → キャンペーン → 広告作成
    const results: any[] = [];

    for (let acctIdx = 0; acctIdx < ACCOUNTS.length; acctIdx++) {
      const account = ACCOUNTS[acctIdx];
      const utage = UTAGE_RESULTS[acctIdx];
      const crStr = String(utage.crNumber).padStart(5, '0');
      const adName = `${getJstDateStr()}/ROAS300%勝ちCR集/スキルプラス/LP2-CR${crStr}`;
      const landingPageUrl = `${utage.destinationUrl}&utm_source=tiktok&utm_id=__CAMPAIGN_ID__&utm_campaign=__CAMPAIGN_NAME__&utm_medium=paid`;

      console.log(`\n===== ${account.name} =====`);
      console.log(`広告名: ${adName}`);
      console.log(`動画数: ${account.videoIds.length}本`);

      // カバー画像アップロード
      console.log('カバー画像アップロード中...');
      const coverWebUris: (string | null)[] = [];
      for (let i = 0; i < sourceCoverUrls.length; i++) {
        const coverUrl = sourceCoverUrls[i];
        if (coverUrl) {
          const webUri = await uploadCoverImageByUrl(account.advertiserId, coverUrl);
          coverWebUris.push(webUri);
        } else {
          coverWebUris.push(null);
        }
        if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${sourceCoverUrls.length}...`);
      }
      console.log(`✅ カバー画像: ${coverWebUris.filter(c => c).length}/${coverWebUris.length}枚`);

      // DB情報取得
      const adv = await prisma.advertiser.findUnique({
        where: { tiktokAdvertiserId: account.advertiserId },
        select: { pixelId: true, identityId: true, identityAuthorizedBcId: true },
      });
      if (!adv?.pixelId || !adv?.identityId || !adv?.identityAuthorizedBcId) throw new Error('DB設定不足');

      // キャンペーン＆広告グループ
      let campaignId: string, adgroupId: string;
      if (account.existing) {
        campaignId = account.existing.campaignId;
        adgroupId = account.existing.adgroupId;
        console.log(`[リジューム] キャンペーン=${campaignId}, 広告グループ=${adgroupId}`);
      } else {
        campaignId = await createSmartPlusCampaign(account.advertiserId, adName);
        console.log(`キャンペーンID: ${campaignId}`);
        adgroupId = await createSmartPlusAdGroup(account.advertiserId, campaignId, adv.pixelId);
        console.log(`広告グループID: ${adgroupId}`);
      }

      // Smart+広告作成（カバー画像付き）
      const ctaId = await getCtaId(account.advertiserId);
      console.log(`CTA ID: ${ctaId}`);

      const creativeList = account.videoIds.map((videoId, idx) => {
        const ci: any = {
          ad_format: 'SINGLE_VIDEO',
          video_info: { video_id: videoId },
          identity_id: adv.identityId,
          identity_type: 'BC_AUTH_TT',
          identity_authorized_bc_id: adv.identityAuthorizedBcId,
        };
        if (coverWebUris[idx]) {
          ci.image_info = [{ web_uri: coverWebUris[idx] }];
        }
        return { creative_info: ci };
      });

      const adData = await tiktokApi('/v1.3/smart_plus/ad/create/', {
        advertiser_id: account.advertiserId, adgroup_id: adgroupId, ad_name: adName,
        creative_list: creativeList,
        ad_text_list: [{ ad_text: AD_TEXT }],
        landing_page_url_list: [{ landing_page_url: landingPageUrl }],
        ad_configuration: { call_to_action_id: ctaId },
        operation_status: 'ENABLE',
        request_id: String(Date.now()) + String(Math.floor(Math.random() * 100000)),
      });
      const adId = String(adData.data?.ad_id || adData.data?.smart_plus_ad_id);
      console.log(`✅ 広告ID: ${adId}`);

      results.push({ accountName: account.name, adName, crNumber: `CR${crStr}`, campaignId, adgroupId, adId });
    }

    // サマリー
    console.log('\n\n========================================');
    console.log('===== 出稿完了サマリー =====');
    console.log('========================================');
    for (const r of results) {
      console.log(`\n[${r.accountName}]`);
      console.log(`  広告名: ${r.adName}`);
      console.log(`  CR番号: ${r.crNumber}`);
      console.log(`  キャンペーンID: ${r.campaignId}`);
      console.log(`  広告グループID: ${r.adgroupId}`);
      console.log(`  広告ID: ${r.adId}`);
      console.log(`  日予算: ¥${DAILY_BUDGET}`);
      console.log(`  動画数: 50本`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => { console.error('\n===== エラー ====='); console.error(err); process.exit(1); });
