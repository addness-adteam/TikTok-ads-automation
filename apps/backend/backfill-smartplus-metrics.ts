/**
 * Smart+メトリクス過去日分 再取得バックフィル
 *
 * 1日窓で日毎に `/v1.3/smart_plus/material_report/overview/` を叩き、
 * smart_plus_ad_id単位で集計してMetric行を作り直す。
 *
 * デフォルトdry-run、`--execute` で実書き込み。
 * 期間: --from=YYYY-MM-DD --to=YYYY-MM-DD（default 3/25〜昨日）
 * 対象: AIアカウントのみ（拡張するなら ADVERTISER_IDS を編集）
 */
import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(process.cwd(), process.cwd().endsWith('backend') ? '../../.env' : '.env') });
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const EXECUTE = process.argv.includes('--execute');
function argValue(name: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`${name}=`));
  return a?.split('=')[1];
}
const FROM = argValue('--from') || '2026-03-25';
const TO = argValue('--to') || '2026-04-13';
const ADVERTISER_IDS = ['7468288053866561553','7523128243466551303','7543540647266074641','7580666710525493255'];
const BASE_URL = process.env.TIKTOK_API_BASE_URL || 'https://business-api.tiktok.com/open_api';

function dateList(from: string, to: string): string[] {
  const result: string[] = [];
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end) {
    result.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return result;
}

async function fetchSmartPlusDay(accessToken: string, advId: string, day: string) {
  const all: any[] = [];
  let page = 1;
  const pageSize = 100;
  while (true) {
    const params: any = {
      advertiser_id: advId,
      dimensions: JSON.stringify(['smart_plus_ad_id', 'main_material_id']),
      metrics: JSON.stringify([
        'impressions','clicks','spend','ctr','cpc','cpm',
        'conversion','cost_per_conversion','video_watched_2s','video_watched_6s',
      ]),
      start_date: day,
      end_date: day,
      page,
      page_size: pageSize,
    };
    const resp = await axios.get(`${BASE_URL}/v1.3/smart_plus/material_report/overview/`, {
      headers: { 'Access-Token': accessToken },
      params,
    });
    const list = resp.data?.data?.list ?? [];
    all.push(...list);
    const total = resp.data?.data?.page_info?.total_number ?? 0;
    if (page * pageSize >= total || list.length === 0) break;
    page++;
  }
  return all;
}

async function main() {
  console.log(`Mode: ${EXECUTE ? '⚠️ EXECUTE' : 'DRY-RUN'}`);
  console.log(`期間: ${FROM} 〜 ${TO}`);
  console.log(`対象Advertiser: ${ADVERTISER_IDS.length}`);

  const prisma = new PrismaClient();
  const tokens = await prisma.oAuthToken.findMany({
    where: { advertiserId: { in: ADVERTISER_IDS } },
  });
  console.log(`OAuthToken: ${tokens.length}`);

  const days = dateList(FROM, TO);
  console.log(`対象日数: ${days.length}`);

  let totalRecords = 0;
  let totalWritten = 0;
  let totalSkippedAdMissing = 0;

  for (const token of tokens) {
    for (const day of days) {
      try {
        const records = await fetchSmartPlusDay(token.accessToken, token.advertiserId, day);
        totalRecords += records.length;

        // smart_plus_ad_id単位で集計
        const byAd = new Map<string, { imp: number; clk: number; spend: number; cv: number; vv2: number; vv6: number }>();
        for (const rec of records) {
          const id = rec.dimensions?.smart_plus_ad_id;
          if (!id) continue;
          const m = rec.metrics || {};
          const cur = byAd.get(id) ?? { imp: 0, clk: 0, spend: 0, cv: 0, vv2: 0, vv6: 0 };
          cur.imp += parseInt(m.impressions || '0', 10);
          cur.clk += parseInt(m.clicks || '0', 10);
          cur.spend += parseFloat(m.spend || '0');
          cur.cv += parseInt(m.conversion || '0', 10);
          cur.vv2 += parseInt(m.video_watched_2s || '0', 10);
          cur.vv6 += parseInt(m.video_watched_6s || '0', 10);
          byAd.set(id, cur);
        }

        const statDate = new Date(day + 'T00:00:00Z');

        for (const [tiktokAdId, agg] of byAd) {
          const ad = await prisma.ad.findUnique({ where: { tiktokId: tiktokAdId } });
          if (!ad) { totalSkippedAdMissing++; continue; }
          if (agg.spend === 0 && agg.imp === 0 && agg.cv === 0) continue;

          const data = {
            entityType: 'AD',
            adId: ad.id,
            statDate,
            impressions: agg.imp,
            clicks: agg.clk,
            spend: agg.spend,
            conversions: agg.cv,
            ctr: agg.imp > 0 ? (agg.clk / agg.imp) * 100 : 0,
            cpc: agg.clk > 0 ? agg.spend / agg.clk : 0,
            cpm: agg.imp > 0 ? (agg.spend / agg.imp) * 1000 : 0,
            cpa: agg.cv > 0 ? agg.spend / agg.cv : 0,
            videoViews: 0,
            videoWatched2s: agg.vv2,
            videoWatched6s: agg.vv6,
          };

          if (EXECUTE) {
            await prisma.$transaction(async (tx) => {
              await tx.metric.deleteMany({
                where: { entityType: 'AD', adId: ad.id, statDate },
              });
              await tx.metric.create({ data });
            });
          }
          totalWritten++;
        }
        console.log(`  [${token.advertiserId}] ${day}: ${records.length}rec → ${byAd.size}ads`);
      } catch (e: any) {
        console.error(`  ERR [${token.advertiserId}] ${day}: ${e.message}`);
      }
    }
  }

  console.log('');
  console.log(`取得総レコード: ${totalRecords}`);
  console.log(`書き込み対象: ${totalWritten}件 (未マッチAd: ${totalSkippedAdMissing})`);
  if (!EXECUTE) console.log('\n--execute で実書き込みします');
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
