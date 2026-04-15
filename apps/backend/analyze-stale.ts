/**
 * 同一動画の出稿順（1回目/2回目/3回目...）とCV成績の関係
 * → 後に出すほど成績が落ちる（枯れ）のか検証
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const BASE = 'https://business-api.tiktok.com/open_api';

const ACCOUNTS = [
  { id: '7468288053866561553', name: 'AI_1' },
  { id: '7523128243466551303', name: 'AI_2' },
  { id: '7543540647266074641', name: 'AI_3' },
  { id: '7580666710525493255', name: 'AI_4' },
  { id: '7247073333517238273', name: 'SNS1' },
  { id: '7543540100849156112', name: 'SNS2' },
  { id: '7543540381615800337', name: 'SNS3' },
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

const now = new Date();
const endDate = jstDate(now);
const startDate = jstDate(new Date(now.getTime() - 60 * 86400000)); // 2ヶ月

async function main() {
  console.log(`=== 枯れ検証: 出稿順 vs CV成績 (${startDate}〜${endDate}) ===\n`);

  // 全アカウントの広告を取得（video_id, campaign_id, create_time）
  interface AdEntry {
    adId: string; adName: string; videoId: string; campaignId: string;
    accName: string; accId: string; createTime: string;
  }
  const allAds: AdEntry[] = [];

  for (const acc of ACCOUNTS) {
    process.stdout.write(`${acc.name}...`);
    let page = 1;
    let count = 0;
    while (true) {
      const resp = await get('/v1.3/ad/get/', {
        advertiser_id: acc.id, page_size: '100', page: String(page),
        fields: JSON.stringify(['ad_id', 'ad_name', 'video_id', 'campaign_id', 'create_time']),
      });
      if (resp.code !== 0) break;
      for (const ad of resp.data?.list || []) {
        if (!ad.video_id) continue;
        allAds.push({
          adId: ad.ad_id, adName: ad.ad_name, videoId: ad.video_id,
          campaignId: ad.campaign_id, accName: acc.name, accId: acc.id,
          createTime: ad.create_time || '',
        });
        count++;
      }
      if ((resp.data?.list || []).length < 100) break;
      page++;
    }
    console.log(` ${count}`);
  }

  // video_id×アカウントでグルーピング、create_time順にソート
  const grouped = new Map<string, AdEntry[]>();
  for (const ad of allAds) {
    const key = `${ad.accId}:${ad.videoId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(ad);
  }

  // 2回以上出稿されたものだけ抽出
  const multiDeploy = [...grouped.entries()]
    .filter(([_, entries]) => {
      const uniqueCamps = new Set(entries.map(e => e.campaignId));
      return uniqueCamps.size >= 2;
    })
    .map(([key, entries]) => ({
      key,
      videoId: entries[0].videoId,
      accName: entries[0].accName,
      accId: entries[0].accId,
      entries: entries.sort((a, b) => a.createTime.localeCompare(b.createTime)),
    }));

  console.log(`\n2回以上出稿（同一アカウント・同一動画）: ${multiDeploy.length}件`);

  // 各キャンペーンの成績を取得
  // バッチで全キャンペーンのレポートを取得
  const campPerf = new Map<string, { totalCv: number; totalSpend: number; maxDayCv: number; firstDate: string }>();

  for (const acc of ACCOUNTS) {
    const accCampIds = new Set<string>();
    for (const md of multiDeploy) {
      if (md.accId !== acc.id) continue;
      for (const e of md.entries) accCampIds.add(e.campaignId);
    }
    if (accCampIds.size === 0) continue;

    process.stdout.write(`  ${acc.name} レポート...`);
    // 30日制限のため2分割
    const midDate = jstDate(new Date(now.getTime() - 30 * 86400000));
    const periods = [
      { start: startDate, end: midDate },
      { start: midDate, end: endDate },
    ];
    for (const period of periods) {
      let page = 1;
      while (true) {
        const resp = await get('/v1.3/report/integrated/get/', {
          advertiser_id: acc.id, report_type: 'BASIC', data_level: 'AUCTION_CAMPAIGN',
          dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
          metrics: JSON.stringify(['spend', 'conversion']),
          start_date: period.start, end_date: period.end,
          page_size: '1000', page: String(page),
        });
        if (resp.code !== 0) break;
        const list = resp.data?.list || [];
        for (const r of list) {
          const campId = r.dimensions?.campaign_id;
          if (!accCampIds.has(campId)) continue;
          const cv = parseInt(r.metrics?.conversion || '0');
          const spend = parseFloat(r.metrics?.spend || '0');
          const date = r.dimensions?.stat_time_day?.split(' ')[0] || '';
          const existing = campPerf.get(campId);
          if (!existing) {
            campPerf.set(campId, { totalCv: cv, totalSpend: spend, maxDayCv: cv, firstDate: date });
          } else {
            existing.totalCv += cv;
            existing.totalSpend += spend;
            if (cv > existing.maxDayCv) existing.maxDayCv = cv;
            if (date < existing.firstDate) existing.firstDate = date;
          }
        }
        if (list.length < 1000) break;
        page++;
      }
    }
    console.log(` ${campPerf.size}件`);
  }

  console.log(`\ncampPerf entries: ${campPerf.size}`);

  // デバッグ: multiDeployの最初の5件のcampIdがcampPerfにあるか
  let debugCount = 0;
  for (const md of multiDeploy.slice(0, 3)) {
    const uniqueCamps = [...new Set(md.entries.map(e => e.campaignId))];
    console.log(`DEBUG: ${md.accName} video:${md.videoId.slice(0, 20)} camps:${uniqueCamps.length}`);
    for (const cid of uniqueCamps.slice(0, 3)) {
      const perf = campPerf.get(cid);
      console.log(`  camp:${cid} → perf: ${perf ? `${perf.totalCv}CV` : 'NOT FOUND'}`);
    }
  }

  // 出稿順 vs 成績の分析
  console.log('\n' + '='.repeat(80));
  console.log('出稿順 vs CV成績（個別ケース、CV合計が多い順）');
  console.log('='.repeat(80));

  interface DeploySeq {
    videoId: string; accName: string;
    sequence: { order: number; campId: string; createTime: string; adName: string; totalCv: number; totalSpend: number; maxDayCv: number }[];
  }
  const sequences: DeploySeq[] = [];

  for (const md of multiDeploy) {
    // キャンペーン単位でユニーク化（同じキャンペーン内に同じ動画が複数ある場合を除外）
    const seen = new Set<string>();
    const uniqueEntries: AdEntry[] = [];
    for (const e of md.entries) {
      if (!seen.has(e.campaignId)) {
        seen.add(e.campaignId);
        uniqueEntries.push(e);
      }
    }
    if (uniqueEntries.length < 2) continue;

    const seq = uniqueEntries.map((e, i) => {
      const perf = campPerf.get(e.campaignId);
      return {
        order: i + 1,
        campId: e.campaignId,
        createTime: e.createTime,
        adName: e.adName,
        totalCv: perf?.totalCv || 0,
        totalSpend: perf?.totalSpend || 0,
        maxDayCv: perf?.maxDayCv || 0,
      };
    });

    const totalAllCv = seq.reduce((s, e) => s + e.totalCv, 0);
    if (totalAllCv >= 1) {
      sequences.push({ videoId: md.videoId, accName: md.accName, sequence: seq });
    }
  }

  sequences.sort((a, b) => {
    const totalA = a.sequence.reduce((s, e) => s + e.totalCv, 0);
    const totalB = b.sequence.reduce((s, e) => s + e.totalCv, 0);
    return totalB - totalA;
  });

  for (const s of sequences.slice(0, 15)) {
    console.log(`\n--- ${s.accName} | video: ${s.videoId} ---`);
    for (const e of s.sequence) {
      const cpa = e.totalCv > 0 ? `¥${Math.round(e.totalSpend / e.totalCv).toLocaleString()}` : '-';
      const bar = '█'.repeat(Math.min(e.totalCv, 40));
      const stale = e.order >= 2 && e.totalCv === 0 ? ' ← 枯れ?' : '';
      console.log(`  ${e.order}回目 (${e.createTime.split('T')[0] || '?'}) | ${String(e.totalCv).padStart(3)}CV | 最高${String(e.maxDayCv).padStart(2)}CV/日 | CPA ${cpa.padStart(7)} | ${bar}${stale}`);
    }
  }

  // 全体集計: N回目の出稿の平均CV
  console.log('\n' + '='.repeat(80));
  console.log('全体集計: 出稿N回目の平均CV（枯れ検証）');
  console.log('='.repeat(80));

  const byOrder = new Map<number, { cvs: number[]; spends: number[]; count: number }>();
  for (const s of sequences) {
    for (const e of s.sequence) {
      if (!byOrder.has(e.order)) byOrder.set(e.order, { cvs: [], spends: [], count: 0 });
      const g = byOrder.get(e.order)!;
      g.cvs.push(e.totalCv);
      g.spends.push(e.totalSpend);
      g.count++;
    }
  }

  console.log('\n出稿順 | サンプル | 平均CV | 中央CV | CV>0率 | 平均CPA');
  for (const order of [...byOrder.keys()].sort()) {
    const g = byOrder.get(order)!;
    const avgCv = (g.cvs.reduce((a, b) => a + b, 0) / g.count).toFixed(1);
    const sorted = [...g.cvs].sort((a, b) => a - b);
    const medianCv = sorted[Math.floor(sorted.length / 2)];
    const cvRate = ((g.cvs.filter(c => c > 0).length / g.count) * 100).toFixed(0);
    const totalCv = g.cvs.reduce((a, b) => a + b, 0);
    const totalSpend = g.spends.reduce((a, b) => a + b, 0);
    const avgCpa = totalCv > 0 ? `¥${Math.round(totalSpend / totalCv).toLocaleString()}` : '-';
    console.log(`  ${String(order).padStart(2)}回目 | ${String(g.count).padStart(4)}件 | ${avgCv.padStart(6)} | ${String(medianCv).padStart(4)} | ${cvRate.padStart(4)}% | ${avgCpa}`);
  }

  // 1回目 vs 2回目以降の直接比較
  console.log('\n' + '='.repeat(80));
  console.log('1回目 vs 2回目以降の直接比較');
  console.log('='.repeat(80));

  let firstBetter = 0, laterBetter = 0, tie = 0;
  const firstCvs: number[] = [];
  const laterCvs: number[] = [];

  for (const s of sequences) {
    const first = s.sequence[0];
    firstCvs.push(first.totalCv);
    for (let i = 1; i < s.sequence.length; i++) {
      const later = s.sequence[i];
      laterCvs.push(later.totalCv);
      if (first.totalCv > later.totalCv) firstBetter++;
      else if (later.totalCv > first.totalCv) laterBetter++;
      else tie++;
    }
  }

  console.log(`\n1回目の方がCV多い: ${firstBetter}組`);
  console.log(`2回目以降の方がCV多い: ${laterBetter}組`);
  console.log(`同じ: ${tie}組`);
  console.log(`→ 1回目勝率: ${(firstBetter / (firstBetter + laterBetter + tie) * 100).toFixed(0)}%`);

  const avgFirst = firstCvs.reduce((a, b) => a + b, 0) / firstCvs.length;
  const avgLater = laterCvs.reduce((a, b) => a + b, 0) / laterCvs.length;
  console.log(`\n1回目の平均CV: ${avgFirst.toFixed(1)}`);
  console.log(`2回目以降の平均CV: ${avgLater.toFixed(1)}`);
  console.log(`低下率: ${((1 - avgLater / avgFirst) * 100).toFixed(0)}%`);
}

main().catch(console.error);
