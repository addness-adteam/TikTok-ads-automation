/**
 * 直近1ヶ月のSmart+キャンペーンで1日70CV以上の日を洗い出し、条件を分析
 * npx tsx apps/backend/analyze-70cv.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';

const ACCOUNTS = [
  { id: '7468288053866561553', name: 'AI_1', appeal: 'AI' },
  { id: '7523128243466551303', name: 'AI_2', appeal: 'AI' },
  { id: '7543540647266074641', name: 'AI_3', appeal: 'AI' },
  { id: '7580666710525493255', name: 'AI_4', appeal: 'AI' },
  { id: '7247073333517238273', name: 'SNS1', appeal: 'SNS' },
  { id: '7543540100849156112', name: 'SNS2', appeal: 'SNS' },
  { id: '7543540381615800337', name: 'SNS3', appeal: 'SNS' },
  { id: '7474920444831875080', name: 'SP1', appeal: 'スキルプラス' },
  { id: '7592868952431362066', name: 'SP2', appeal: 'スキルプラス' },
  { id: '7616545514662051858', name: 'SP3', appeal: 'スキルプラス' },
];

function jstDateStr(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')}`;
}

async function get(ep: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const r = await fetch(`${BASE}${ep}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return r.json();
}

interface DayRecord {
  date: string;
  accountName: string;
  appeal: string;
  campaignId: string;
  campaignName: string;
  cv: number;
  spend: number;
  cpa: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
}

async function main() {
  const now = new Date();
  const endDate = jstDateStr(now);
  const startDate = jstDateStr(new Date(now.getTime() - 30 * 86400000));

  console.log(`=== 直近1ヶ月（${startDate} 〜 ${endDate}）70CV/日以上のキャンペーン分析 ===\n`);

  const allRecords: DayRecord[] = [];

  for (const acc of ACCOUNTS) {
    console.log(`${acc.name}...`);

    // キャンペーン日別レポート取得
    let page = 1;
    while (true) {
      const resp = await get('/v1.3/report/integrated/get/', {
        advertiser_id: acc.id,
        report_type: 'BASIC',
        data_level: 'AUCTION_CAMPAIGN',
        dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
        metrics: JSON.stringify(['spend', 'conversion', 'impressions', 'clicks', 'cpc', 'ctr', 'cost_per_conversion']),
        start_date: startDate,
        end_date: endDate,
        page_size: '1000',
        page: String(page),
      });

      if (resp.code !== 0) { console.log(`  エラー: ${resp.message}`); break; }
      const list = resp.data?.list || [];

      for (const row of list) {
        const cv = parseInt(row.metrics?.conversion || '0');
        if (cv >= 30) {
          allRecords.push({
            date: row.dimensions?.stat_time_day?.split(' ')[0] || '',
            accountName: acc.name,
            appeal: acc.appeal,
            campaignId: row.dimensions?.campaign_id || '',
            campaignName: '', // 後で取得
            cv,
            spend: parseFloat(row.metrics?.spend || '0'),
            cpa: parseFloat(row.metrics?.cost_per_conversion || '0'),
            impressions: parseInt(row.metrics?.impressions || '0'),
            clicks: parseInt(row.metrics?.clicks || '0'),
            ctr: parseFloat(row.metrics?.ctr || '0'),
            cpc: parseFloat(row.metrics?.cpc || '0'),
          });
        }
      }

      if (list.length < 1000) break;
      page++;
    }
  }

  console.log(`\n70CV/日以上: ${allRecords.length}件\n`);

  if (allRecords.length === 0) {
    console.log('該当なし。閾値を下げて再検索...');
    // 50CVで再検索
    return;
  }

  // キャンペーン名を取得
  const campaignIds = [...new Set(allRecords.map(r => r.campaignId))];
  const campaignNames = new Map<string, string>();
  const campaignDetails = new Map<string, any>();

  for (const acc of ACCOUNTS) {
    const accCampIds = campaignIds.filter(id =>
      allRecords.some(r => r.campaignId === id && r.accountName === acc.name)
    );
    if (accCampIds.length === 0) continue;

    // キャンペーン詳細
    for (let i = 0; i < accCampIds.length; i += 100) {
      const batch = accCampIds.slice(i, i + 100);

      // 通常キャンペーンAPI
      const cResp = await get('/v1.3/campaign/get/', {
        advertiser_id: acc.id,
        filtering: JSON.stringify({ campaign_ids: batch }),
        fields: JSON.stringify(['campaign_id', 'campaign_name', 'objective_type', 'budget', 'budget_mode']),
        page_size: '100',
      });
      for (const c of cResp.data?.list || []) {
        campaignNames.set(c.campaign_id, c.campaign_name);
        campaignDetails.set(c.campaign_id, { ...c, account: acc.name, appeal: acc.appeal });
      }
    }

    // Smart+広告グループ情報も取得（DF設定、ターゲティング）
    // キャンペーンに紐づく広告グループを探す
    let agPage = 1;
    while (true) {
      const agResp = await get('/v1.3/smart_plus/adgroup/get/', {
        advertiser_id: acc.id,
        page_size: '100',
        page: String(agPage),
      });
      if (agResp.code !== 0) break;
      const agList = agResp.data?.list || [];
      for (const ag of agList) {
        if (accCampIds.includes(ag.campaign_id)) {
          const existing = campaignDetails.get(ag.campaign_id);
          if (existing) {
            existing.adgroup = {
              targeting_mode: ag.targeting_optimization_mode,
              age_groups: ag.targeting_spec?.age_groups,
              excluded_audiences: ag.targeting_spec?.excluded_audience_ids?.length || 0,
              deep_funnel_toggle: ag.deep_funnel_toggle,
              deep_funnel_event: ag.deep_funnel_optimization_event,
              budget: ag.budget,
              placements: ag.placements,
            };
          }
        }
      }
      if (agList.length < 100) break;
      agPage++;
    }

    // Smart+広告情報（クリエイティブ数）
    let adPage = 1;
    while (true) {
      const adResp = await get('/v1.3/smart_plus/ad/get/', {
        advertiser_id: acc.id,
        fields: JSON.stringify(['smart_plus_ad_id', 'ad_name', 'campaign_id', 'creative_list']),
        page_size: '100',
        page: String(adPage),
      });
      if (adResp.code !== 0) break;
      const adList = adResp.data?.list || [];
      for (const ad of adList) {
        if (accCampIds.includes(ad.campaign_id)) {
          const existing = campaignDetails.get(ad.campaign_id);
          if (existing) {
            const count = existing.creative_count || 0;
            existing.creative_count = count + (ad.creative_list?.length || 0);
            existing.is_smartplus = true;
          }
        }
      }
      if (adList.length < 100) break;
      adPage++;
    }

    // 通常広告も確認（Smart+でないもの）
    let normalAdPage = 1;
    while (true) {
      const adResp = await get('/v1.3/ad/get/', {
        advertiser_id: acc.id,
        page_size: '100',
        page: String(normalAdPage),
        fields: JSON.stringify(['ad_id', 'ad_name', 'campaign_id']),
      });
      if (adResp.code !== 0) break;
      const adList = adResp.data?.list || [];
      for (const ad of adList) {
        if (accCampIds.includes(ad.campaign_id)) {
          const existing = campaignDetails.get(ad.campaign_id);
          if (existing && !existing.is_smartplus) {
            existing.is_normal = true;
            existing.normal_ad_count = (existing.normal_ad_count || 0) + 1;
          }
        }
      }
      if (adList.length < 100) break;
      normalAdPage++;
    }
  }

  // レコードにキャンペーン名を付与
  for (const r of allRecords) {
    r.campaignName = campaignNames.get(r.campaignId) || r.campaignId;
  }

  // ソート（CV多い順）
  allRecords.sort((a, b) => b.cv - a.cv);

  // 結果表示
  console.log('========================================');
  console.log('70CV/日以上のキャンペーン × 日 一覧');
  console.log('========================================\n');

  for (const r of allRecords) {
    const detail = campaignDetails.get(r.campaignId);
    const ag = detail?.adgroup;
    const type = detail?.is_smartplus ? 'Smart+' : (detail?.is_normal ? '通常' : '不明');
    const crCount = detail?.creative_count || detail?.normal_ad_count || '?';
    const df = ag?.deep_funnel_toggle === 'ON' ? 'DF:ON' : 'DF:OFF';
    const tgt = ag?.targeting_mode === 'MANUAL' ? `手動(${ag?.age_groups?.map((g: string) => g.replace('AGE_', '').replace('_', '-')).join(',')})` : (ag?.targeting_mode || 'ノンタゲ');

    console.log(`${r.date} | ${r.accountName} | ${r.cv}CV | CPA ¥${Math.round(r.cpa).toLocaleString()} | ¥${Math.round(r.spend).toLocaleString()} | ${type} | CR${crCount}本 | ${df} | ${tgt}`);
    console.log(`  ${r.campaignName}`);
    console.log('');
  }

  // パターン分析
  console.log('========================================');
  console.log('パターン分析');
  console.log('========================================\n');

  // 導線別
  const byAppeal = new Map<string, DayRecord[]>();
  for (const r of allRecords) {
    if (!byAppeal.has(r.appeal)) byAppeal.set(r.appeal, []);
    byAppeal.get(r.appeal)!.push(r);
  }
  console.log('【導線別】');
  for (const [appeal, records] of byAppeal) {
    const avgCv = records.reduce((s, r) => s + r.cv, 0) / records.length;
    const avgCpa = records.reduce((s, r) => s + r.cpa, 0) / records.length;
    console.log(`  ${appeal}: ${records.length}回 (平均${Math.round(avgCv)}CV, 平均CPA ¥${Math.round(avgCpa).toLocaleString()})`);
  }

  // アカウント別
  const byAccount = new Map<string, DayRecord[]>();
  for (const r of allRecords) {
    if (!byAccount.has(r.accountName)) byAccount.set(r.accountName, []);
    byAccount.get(r.accountName)!.push(r);
  }
  console.log('\n【アカウント別】');
  for (const [acc, records] of [...byAccount.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${acc}: ${records.length}回`);
  }

  // Smart+ vs 通常
  let smartCount = 0, normalCount = 0;
  for (const r of allRecords) {
    const d = campaignDetails.get(r.campaignId);
    if (d?.is_smartplus) smartCount++; else normalCount++;
  }
  console.log(`\n【配信タイプ】`);
  console.log(`  Smart+: ${smartCount}回`);
  console.log(`  通常: ${normalCount}回`);

  // DF有無
  let dfOn = 0, dfOff = 0;
  for (const r of allRecords) {
    const d = campaignDetails.get(r.campaignId);
    if (d?.adgroup?.deep_funnel_toggle === 'ON') dfOn++; else dfOff++;
  }
  console.log(`\n【ディープファネル】`);
  console.log(`  ON: ${dfOn}回`);
  console.log(`  OFF: ${dfOff}回`);

  // ターゲティング
  const byTargeting = new Map<string, number>();
  for (const r of allRecords) {
    const d = campaignDetails.get(r.campaignId);
    const tgt = d?.adgroup?.targeting_mode || '不明';
    byTargeting.set(tgt, (byTargeting.get(tgt) || 0) + 1);
  }
  console.log(`\n【ターゲティング】`);
  for (const [t, c] of byTargeting) console.log(`  ${t}: ${c}回`);

  // クリエイティブ数
  console.log(`\n【クリエイティブ数】`);
  const crCounts: number[] = [];
  for (const r of allRecords) {
    const d = campaignDetails.get(r.campaignId);
    const c = d?.creative_count || d?.normal_ad_count || 0;
    if (c > 0) crCounts.push(c);
  }
  if (crCounts.length > 0) {
    console.log(`  平均: ${(crCounts.reduce((a, b) => a + b, 0) / crCounts.length).toFixed(1)}本`);
    console.log(`  最小: ${Math.min(...crCounts)}本, 最大: ${Math.max(...crCounts)}本`);
  }

  // CPA分布
  console.log(`\n【CPA分布】`);
  const cpaBuckets = [0, 1000, 2000, 3000, 4000, 5000, 10000, Infinity];
  for (let i = 0; i < cpaBuckets.length - 1; i++) {
    const count = allRecords.filter(r => r.cpa >= cpaBuckets[i] && r.cpa < cpaBuckets[i + 1]).length;
    if (count > 0) {
      const label = cpaBuckets[i + 1] === Infinity ? `¥${cpaBuckets[i].toLocaleString()}〜` : `¥${cpaBuckets[i].toLocaleString()}〜¥${cpaBuckets[i + 1].toLocaleString()}`;
      console.log(`  ${label}: ${count}回`);
    }
  }

  // 曜日分析
  console.log(`\n【曜日別】`);
  const byDow = new Map<string, number>();
  const dowNames = ['日', '月', '火', '水', '木', '金', '土'];
  for (const r of allRecords) {
    const d = new Date(r.date);
    const dow = dowNames[d.getDay()];
    byDow.set(dow, (byDow.get(dow) || 0) + 1);
  }
  for (const dow of dowNames) {
    const c = byDow.get(dow) || 0;
    if (c > 0) console.log(`  ${dow}: ${c}回`);
  }

  console.log(`\n合計: ${allRecords.length}件（${[...new Set(allRecords.map(r => r.campaignId))].length}キャンペーン）`);
}

main().catch(console.error);
