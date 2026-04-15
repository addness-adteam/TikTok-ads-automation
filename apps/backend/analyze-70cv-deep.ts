/**
 * 70CV/日以上キャンペーンの深掘り分析
 *
 * 1. CR数 vs CV数の相関（全スマプラ比較）
 * 2. 高CV日のキャンペーン内広告別予算配分（偏り分析）
 * 3. 時間帯別CV分布（高CV日 vs 通常日）
 * 4. 曜日パターン
 * 5. 高CVキャンペーンの前日・翌日比較（一過性 or 継続?）
 * 6. 低CVスマプラとの比較（何が違う?）
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

function jstDate(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3600000);
  return `${j.getUTCFullYear()}-${String(j.getUTCMonth() + 1).padStart(2, '0')}-${String(j.getUTCDate()).padStart(2, '0')}`;
}

async function get(ep: string, params: Record<string, any>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const r = await fetch(`${BASE}${ep}?${qs}`, { headers: { 'Access-Token': ACCESS_TOKEN } });
  return r.json();
}

async function main() {
  const now = new Date();
  const endDate = jstDate(now);
  const startDate = jstDate(new Date(now.getTime() - 30 * 86400000));

  console.log(`=== 深掘り分析: ${startDate} 〜 ${endDate} ===\n`);

  // ========================================
  // STEP 1: 全キャンペーンの日別データ収集
  // ========================================
  console.log('STEP 1: 全キャンペーン日別データ収集...');

  interface CampDay {
    date: string; accountName: string; appeal: string;
    campaignId: string; cv: number; spend: number; impressions: number; clicks: number;
    cpa: number; cpc: number; ctr: number;
  }

  const allDays: CampDay[] = [];
  const accountCampaigns = new Map<string, Set<string>>();

  for (const acc of ACCOUNTS) {
    process.stdout.write(`  ${acc.name}...`);
    let page = 1;
    let count = 0;
    while (true) {
      const resp = await get('/v1.3/report/integrated/get/', {
        advertiser_id: acc.id, report_type: 'BASIC', data_level: 'AUCTION_CAMPAIGN',
        dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
        metrics: JSON.stringify(['spend', 'conversion', 'impressions', 'clicks', 'cpc', 'ctr', 'cost_per_conversion']),
        start_date: startDate, end_date: endDate, page_size: '1000', page: String(page),
      });
      if (resp.code !== 0) break;
      const list = resp.data?.list || [];
      for (const row of list) {
        const cv = parseInt(row.metrics?.conversion || '0');
        const spend = parseFloat(row.metrics?.spend || '0');
        if (spend < 1) continue;
        const campId = row.dimensions?.campaign_id;
        allDays.push({
          date: row.dimensions?.stat_time_day?.split(' ')[0] || '',
          accountName: acc.name, appeal: acc.appeal, campaignId: campId,
          cv, spend, impressions: parseInt(row.metrics?.impressions || '0'),
          clicks: parseInt(row.metrics?.clicks || '0'),
          cpa: parseFloat(row.metrics?.cost_per_conversion || '0'),
          cpc: parseFloat(row.metrics?.cpc || '0'),
          ctr: parseFloat(row.metrics?.ctr || '0'),
        });
        if (!accountCampaigns.has(acc.name)) accountCampaigns.set(acc.name, new Set());
        accountCampaigns.get(acc.name)!.add(campId);
        count++;
      }
      if (list.length < 1000) break;
      page++;
    }
    console.log(` ${count}行`);
  }

  // ========================================
  // STEP 2: Smart+キャンペーン情報収集（CR数、ターゲ、DF）
  // ========================================
  console.log('\nSTEP 2: キャンペーン詳細取得...');

  interface CampInfo {
    name: string; account: string; appeal: string;
    creativeCount: number; isSmart: boolean;
    targeting: string; ageGroups: string[]; dfToggle: string;
    budget: number;
  }

  const campInfo = new Map<string, CampInfo>();

  for (const acc of ACCOUNTS) {
    const campIds = accountCampaigns.get(acc.name);
    if (!campIds || campIds.size === 0) continue;
    process.stdout.write(`  ${acc.name}...`);

    // キャンペーン名
    const ids = [...campIds];
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const cr = await get('/v1.3/campaign/get/', {
        advertiser_id: acc.id, filtering: JSON.stringify({ campaign_ids: batch }),
        fields: JSON.stringify(['campaign_id', 'campaign_name']), page_size: '100',
      });
      for (const c of cr.data?.list || []) {
        campInfo.set(c.campaign_id, {
          name: c.campaign_name, account: acc.name, appeal: acc.appeal,
          creativeCount: 0, isSmart: false, targeting: '不明', ageGroups: [], dfToggle: 'OFF', budget: 0,
        });
      }
    }

    // Smart+広告グループ
    let agPage = 1;
    while (true) {
      const agR = await get('/v1.3/smart_plus/adgroup/get/', { advertiser_id: acc.id, page_size: '100', page: String(agPage) });
      if (agR.code !== 0) break;
      for (const ag of agR.data?.list || []) {
        const ci = campInfo.get(ag.campaign_id);
        if (ci) {
          ci.targeting = ag.targeting_optimization_mode || 'AUTOMATIC';
          ci.ageGroups = ag.targeting_spec?.age_groups || [];
          ci.dfToggle = ag.deep_funnel_toggle || 'OFF';
          ci.budget = ag.budget || 0;
        }
      }
      if ((agR.data?.list || []).length < 100) break;
      agPage++;
    }

    // Smart+広告（CR数）
    let adPage = 1;
    while (true) {
      const adR = await get('/v1.3/smart_plus/ad/get/', {
        advertiser_id: acc.id, fields: JSON.stringify(['smart_plus_ad_id', 'campaign_id', 'creative_list']),
        page_size: '100', page: String(adPage),
      });
      if (adR.code !== 0) break;
      for (const ad of adR.data?.list || []) {
        const ci = campInfo.get(ad.campaign_id);
        if (ci) { ci.creativeCount += (ad.creative_list?.length || 0); ci.isSmart = true; }
      }
      if ((adR.data?.list || []).length < 100) break;
      adPage++;
    }
    console.log(' OK');
  }

  // ========================================
  // STEP 3: ターゲット3キャンペーンの広告レベル日別データ
  // ========================================
  const targetCamps = [
    { campId: '1861073957168386', accId: '7523128243466551303', accName: 'AI_2', date: '2026-03-31', name: 'CR01132' },
    { campId: '1860803930046657', accId: '7468288053866561553', accName: 'AI_1', date: '2026-03-27', name: 'CR01105' },
    { campId: '1861474109215858', accId: '7523128243466551303', accName: 'AI_2', date: '2026-04-05', name: 'CR01150' },
  ];

  // キャンペーンIDを確認（名前からの推測なので、実データから特定）
  // 上のallDaysから30CV以上の実キャンペーンIDを取得
  const highCvDays = allDays.filter(d => d.cv >= 30).sort((a, b) => b.cv - a.cv);
  const actualTargets = highCvDays.map(d => ({ campId: d.campaignId, accId: ACCOUNTS.find(a => a.name === d.accountName)!.id, accName: d.accountName, date: d.date, cv: d.cv }));

  console.log('\nSTEP 3: 高CVキャンペーン内の広告別予算配分...');

  for (const t of actualTargets) {
    console.log(`\n--- ${t.accName} ${t.date} ${t.cv}CV (campaign: ${t.campId}) ---`);
    const ci = campInfo.get(t.campId);
    console.log(`キャンペーン名: ${ci?.name || '?'}`);

    // 広告レベル日別
    const adResp = await get('/v1.3/report/integrated/get/', {
      advertiser_id: t.accId, report_type: 'BASIC', data_level: 'AUCTION_AD',
      dimensions: JSON.stringify(['ad_id', 'stat_time_day']),
      metrics: JSON.stringify(['spend', 'conversion', 'impressions', 'clicks', 'cpc', 'ctr', 'cost_per_conversion']),
      start_date: t.date, end_date: t.date,
      filtering: JSON.stringify([{ field_name: 'campaign_ids', filter_type: 'IN', filter_value: JSON.stringify([t.campId]) }]),
      page_size: '200',
    });

    const adRows = (adResp.data?.list || []).sort((a: any, b: any) =>
      parseFloat(b.metrics?.spend || '0') - parseFloat(a.metrics?.spend || '0')
    );

    let totalSpend = 0, totalCV = 0;
    const adData: { adId: string; spend: number; cv: number; cpa: number; impressions: number }[] = [];
    for (const row of adRows) {
      const spend = parseFloat(row.metrics?.spend || '0');
      const cv = parseInt(row.metrics?.conversion || '0');
      totalSpend += spend;
      totalCV += cv;
      adData.push({ adId: row.dimensions?.ad_id, spend, cv, cpa: parseFloat(row.metrics?.cost_per_conversion || '0'), impressions: parseInt(row.metrics?.impressions || '0') });
    }

    console.log(`広告数: ${adData.length}, 合計CV: ${totalCV}, 合計費用: ¥${Math.round(totalSpend).toLocaleString()}`);
    console.log('広告別内訳（費用順）:');
    let cumSpend = 0;
    for (const ad of adData) {
      cumSpend += ad.spend;
      const pct = (ad.spend / totalSpend * 100).toFixed(1);
      const cumPct = (cumSpend / totalSpend * 100).toFixed(1);
      console.log(`  ad:${ad.adId} | ¥${Math.round(ad.spend).toLocaleString()} (${pct}%, 累積${cumPct}%) | ${ad.cv}CV | CPA ¥${ad.cv > 0 ? Math.round(ad.cpa).toLocaleString() : '-'}`);
    }

    // 偏り指標: 上位N広告のシェア
    if (adData.length >= 2) {
      const top1Share = (adData[0].spend / totalSpend * 100).toFixed(1);
      const top2Share = ((adData[0].spend + (adData[1]?.spend || 0)) / totalSpend * 100).toFixed(1);
      console.log(`→ 上位1広告: ${top1Share}%, 上位2広告: ${top2Share}%`);
    }
  }

  // ========================================
  // STEP 4: 高CVキャンペーンの前後日比較
  // ========================================
  console.log('\n\nSTEP 4: 高CVキャンペーンの前後日推移...');

  for (const t of actualTargets) {
    const ci = campInfo.get(t.campId);
    console.log(`\n--- ${ci?.name || t.campId} (${t.accName}) ---`);

    // 前後3日のデータ
    const daysRange = allDays.filter(d => d.campaignId === t.campId)
      .sort((a, b) => a.date.localeCompare(b.date));

    for (const d of daysRange) {
      const marker = d.date === t.date ? ' ★' : '';
      console.log(`  ${d.date}: ${d.cv}CV | ¥${Math.round(d.spend).toLocaleString()} | CPA ¥${d.cv > 0 ? Math.round(d.cpa).toLocaleString() : '-'}${marker}`);
    }
  }

  // ========================================
  // STEP 5: 時間帯別CV（高CV日）
  // ========================================
  console.log('\n\nSTEP 5: 高CV日の時間帯別CV分布...');

  for (const t of actualTargets) {
    const ci = campInfo.get(t.campId);
    console.log(`\n--- ${t.date} ${t.accName} ${ci?.name || ''} (${t.cv}CV) ---`);

    const hourResp = await get('/v1.3/report/integrated/get/', {
      advertiser_id: t.accId, report_type: 'BASIC', data_level: 'AUCTION_CAMPAIGN',
      dimensions: JSON.stringify(['campaign_id', 'stat_time_hour']),
      metrics: JSON.stringify(['spend', 'conversion', 'impressions', 'clicks']),
      start_date: t.date, end_date: t.date,
      filtering: JSON.stringify([{ field_name: 'campaign_ids', filter_type: 'IN', filter_value: JSON.stringify([t.campId]) }]),
      page_size: '48',
    });

    const hours = (hourResp.data?.list || []).sort((a: any, b: any) =>
      (a.dimensions?.stat_time_hour || '').localeCompare(b.dimensions?.stat_time_hour || '')
    );

    if (hours.length === 0) {
      console.log('  時間帯データなし');
      continue;
    }

    let peakHour = '', peakCv = 0;
    for (const h of hours) {
      const cv = parseInt(h.metrics?.conversion || '0');
      const spend = parseFloat(h.metrics?.spend || '0');
      const hourStr = (h.dimensions?.stat_time_hour || '').split(' ')[1]?.substring(0, 5) || '??';
      // JSTに変換（+9h）
      const utcHour = parseInt(hourStr.split(':')[0]);
      const jstHour = (utcHour + 9) % 24;
      const jstStr = String(jstHour).padStart(2, '0') + ':00';
      if (cv > 0) {
        const bar = '█'.repeat(Math.min(cv, 40));
        console.log(`  ${jstStr} | ${String(cv).padStart(3)}CV | ¥${Math.round(spend).toLocaleString().padStart(7)} | ${bar}`);
      }
      if (cv > peakCv) { peakCv = cv; peakHour = jstStr; }
    }
    console.log(`  → ピーク: ${peakHour} (${peakCv}CV)`);
  }

  // ========================================
  // STEP 6: CR数 vs 日別最高CV（全スマプラ比較）
  // ========================================
  console.log('\n\nSTEP 6: CR数 vs 最高日CV（全Smart+キャンペーン比較）...');

  // キャンペーンごとの最高日CVを算出
  const campMaxCv = new Map<string, { maxCv: number; maxDate: string; avgCv: number; days: number; totalSpend: number }>();
  for (const d of allDays) {
    const ci = campInfo.get(d.campaignId);
    if (!ci?.isSmart) continue;
    const existing = campMaxCv.get(d.campaignId);
    if (!existing) {
      campMaxCv.set(d.campaignId, { maxCv: d.cv, maxDate: d.date, avgCv: d.cv, days: 1, totalSpend: d.spend });
    } else {
      if (d.cv > existing.maxCv) { existing.maxCv = d.cv; existing.maxDate = d.date; }
      existing.avgCv = (existing.avgCv * existing.days + d.cv) / (existing.days + 1);
      existing.days++;
      existing.totalSpend += d.spend;
    }
  }

  // CR数でグルーピング
  const crGroups = new Map<string, { count: number; maxCvs: number[]; avgCvs: number[] }>();
  for (const [campId, stats] of campMaxCv) {
    const ci = campInfo.get(campId);
    if (!ci) continue;
    const crBucket = ci.creativeCount <= 1 ? '1' : ci.creativeCount <= 3 ? '2-3' : ci.creativeCount <= 6 ? '4-6' : ci.creativeCount <= 10 ? '7-10' : ci.creativeCount <= 20 ? '11-20' : '21+';
    if (!crGroups.has(crBucket)) crGroups.set(crBucket, { count: 0, maxCvs: [], avgCvs: [] });
    const g = crGroups.get(crBucket)!;
    g.count++;
    g.maxCvs.push(stats.maxCv);
    g.avgCvs.push(stats.avgCv);
  }

  console.log('CR数バケット | キャンペーン数 | 最高日CV(平均) | 最高日CV(最大) | 日平均CV');
  for (const bucket of ['1', '2-3', '4-6', '7-10', '11-20', '21+']) {
    const g = crGroups.get(bucket);
    if (!g || g.count === 0) continue;
    const avgMax = (g.maxCvs.reduce((a, b) => a + b, 0) / g.count).toFixed(1);
    const maxMax = Math.max(...g.maxCvs);
    const avgAvg = (g.avgCvs.reduce((a, b) => a + b, 0) / g.count).toFixed(1);
    console.log(`  ${bucket.padEnd(6)} | ${String(g.count).padStart(3)}件 | ${avgMax.padStart(6)} | ${String(maxMax).padStart(6)} | ${avgAvg.padStart(6)}`);
  }

  // 個別キャンペーン（上位20）
  console.log('\nSmart+キャンペーン 最高日CV TOP20:');
  const sorted = [...campMaxCv.entries()]
    .filter(([id]) => campInfo.get(id)?.isSmart)
    .sort((a, b) => b[1].maxCv - a[1].maxCv)
    .slice(0, 20);

  for (const [campId, stats] of sorted) {
    const ci = campInfo.get(campId)!;
    const tgt = ci.targeting === 'MANUAL' ? `手動(${ci.ageGroups.map(g => g.replace('AGE_', '').replace('_', '-')).join(',')})` : 'ノンタゲ';
    console.log(`  ${stats.maxCv}CV(${stats.maxDate}) | ${ci.account} | CR${ci.creativeCount}本 | ${tgt} | DF:${ci.dfToggle} | 日予算¥${ci.budget.toLocaleString()} | 平均${stats.avgCv.toFixed(1)}CV/日 | ${ci.name}`);
  }

  // ========================================
  // STEP 7: ノンタゲ vs 手動の比較
  // ========================================
  console.log('\n\nSTEP 7: ノンタゲ vs 手動ターゲティング（Smart+のみ）...');

  const tgtGroups = new Map<string, { camps: number; totalCv: number; totalSpend: number; maxCvs: number[] }>();
  for (const [campId, stats] of campMaxCv) {
    const ci = campInfo.get(campId);
    if (!ci?.isSmart) continue;
    const tgt = ci.targeting === 'MANUAL' ? '手動' : 'ノンタゲ';
    if (!tgtGroups.has(tgt)) tgtGroups.set(tgt, { camps: 0, totalCv: 0, totalSpend: 0, maxCvs: [] });
    const g = tgtGroups.get(tgt)!;
    g.camps++;
    g.totalCv += stats.avgCv * stats.days;
    g.totalSpend += stats.totalSpend;
    g.maxCvs.push(stats.maxCv);
  }

  for (const [tgt, g] of tgtGroups) {
    const avgMaxCv = (g.maxCvs.reduce((a, b) => a + b, 0) / g.camps).toFixed(1);
    const topMax = Math.max(...g.maxCvs);
    const avgCpa = g.totalCv > 0 ? Math.round(g.totalSpend / g.totalCv) : 0;
    console.log(`  ${tgt}: ${g.camps}件 | 最高日CV平均${avgMaxCv} | 最高日CV最大${topMax} | 平均CPA ¥${avgCpa.toLocaleString()}`);
  }

  console.log('\n=== 分析完了 ===');
}

main().catch(console.error);
