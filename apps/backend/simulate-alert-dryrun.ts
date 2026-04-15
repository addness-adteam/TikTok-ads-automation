/**
 * セミナー着座CPOアラートの dry-run シミュレーション
 * Lステップなしで、着座メアドを空Setと仮定して実行し、どの広告が alert 候補か確認
 */
import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(__dirname, '.env') });
config({ path: path.resolve(process.cwd(), '.env') });
import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';
import { SheetsAllowableCpoResolver } from './src/seminar-attendance-alert/infrastructure/allowable-cpo-resolver';
import { SheetsOptLatestPathReader } from './src/seminar-attendance-alert/infrastructure/opt-latest-path-reader';
import { SheetsReservationSurveyReader } from './src/seminar-attendance-alert/infrastructure/reservation-survey-reader';
import { AttendanceCountService } from './src/seminar-attendance-alert/domain/services/attendance-count-service';
import { AlertRuleEvaluator } from './src/seminar-attendance-alert/domain/services/alert-rule-evaluator';
import { AdUnderEvaluation } from './src/seminar-attendance-alert/domain/entities/ad-under-evaluation';
import { JPY } from './src/seminar-attendance-alert/domain/value-objects/jpy';
import { DeliveryPeriod } from './src/seminar-attendance-alert/domain/value-objects/delivery-period';
import { YearMonth } from './src/seminar-attendance-alert/domain/value-objects/allowable-seminar-seat-cpo';

const SP_ADVERTISERS: Record<string, string> = {
  '7474920444831875080': 'SP1',
  '7592868952431362066': 'SP2',
  '7616545514662051858': 'SP3',
};

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS ?? '{}');
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const googleSheets = google.sheets({ version: 'v4', auth: await auth.getClient() as any });
  const fakeSheetsService: any = {
    sheets: googleSheets,
    getValues: async (id: string, range: string) => {
      const r = await googleSheets.spreadsheets.values.get({ spreadsheetId: id, range });
      return r.data.values ?? [];
    },
  };

  const prisma = new PrismaClient();
  const now = new Date();
  const ym = YearMonth.fromDate(now);

  // 1) 許容CPO
  const allowableResolver = new SheetsAllowableCpoResolver(fakeSheetsService);
  const allowable = await allowableResolver.resolve(ym);
  if (!allowable) {
    console.error('許容CPO取得失敗');
    await prisma.$disconnect();
    return;
  }
  console.log(`✅ 許容セミナー着座CPO (${ym.toString()}) = ¥${allowable.amount.amount.toLocaleString()}`);

  // 2) データソース
  const optReader = new SheetsOptLatestPathReader(fakeSheetsService);
  const surveyReader = new SheetsReservationSurveyReader(fakeSheetsService);

  const [optMap, reservations] = await Promise.all([optReader.load(), surveyReader.load()]);
  const attended = new Set<string>(); // Lステップなしで空Set
  console.log(`✅ opt=${optMap.size}件 / 予約=${reservations.length}件 / 着座=${attended.size}件 (シミュレーション)`);

  // 3) LP-CR×件数
  const counter = new AttendanceCountService();
  const counts = counter.countByLpCr(optMap, reservations, attended);
  console.log(`✅ LP-CR単位集計: ${counts.size}種`);

  // 4) 広告取得
  const ads = await prisma.ad.findMany({
    where: {
      adGroup: { campaign: { advertiser: { tiktokAdvertiserId: { in: Object.keys(SP_ADVERTISERS) } } } },
    },
    include: { adGroup: { include: { campaign: { include: { advertiser: true } } } } },
  });
  const adIds = ads.map(a => a.id);
  const metrics = await prisma.metric.findMany({
    where: { entityType: 'AD', adId: { in: adIds } },
    select: { adId: true, spend: true },
  });
  const spendByAd = new Map<string, number>();
  for (const m of metrics) {
    if (!m.adId) continue;
    spendByAd.set(m.adId, (spendByAd.get(m.adId) ?? 0) + m.spend);
  }
  console.log(`✅ SP広告: ${ads.length}件`);

  // 5) 評価
  const evaluator = new AlertRuleEvaluator();
  const alertCandidates: any[] = [];
  let evaluated = 0;
  const skipReasons = { noLpCr: 0, noStart: 0, notLongEnough: 0, underThreshold: 0 };

  for (const ad of ads) {
    const m = ad.name.match(/LP\d+-CR\d+/i);
    if (!m) { skipReasons.noLpCr++; continue; }
    const lpCr = m[0].toUpperCase();

    // 配信開始日
    const sched = (ad.adGroup as any)?.schedule;
    let startDate: Date | null = null;
    if (sched?.startTime) {
      const d = new Date(sched.startTime);
      if (!isNaN(d.getTime())) startDate = d;
    }
    if (!startDate && ad.createdAt) startDate = ad.createdAt;
    if (!startDate) { skipReasons.noStart++; continue; }

    const period = DeliveryPeriod.between(startDate, now);
    if (!period.isLongEnough()) { skipReasons.notLongEnough++; continue; }

    const spend = JPY.of(spendByAd.get(ad.id) ?? 0);
    const c = counts.get(lpCr) ?? { reservationCount: 0, attendanceCount: 0 };
    const advId = ad.adGroup?.campaign?.advertiser?.tiktokAdvertiserId ?? '';
    const advName = SP_ADVERTISERS[advId] ?? advId;

    let eval_: AdUnderEvaluation;
    try {
      eval_ = AdUnderEvaluation.create({
        adTiktokId: ad.tiktokId, adName: ad.name, advertiserName: advName,
        lpCrCode: lpCr, deliveryPeriod: period, totalSpend: spend,
        reservationCount: c.reservationCount, attendanceCount: c.attendanceCount,
      });
    } catch { continue; }

    evaluated++;
    const d = evaluator.evaluate(eval_, allowable, false);
    if (d.shouldAlert) {
      alertCandidates.push({
        account: advName, name: ad.name, days: period.elapsedDays,
        spend: spend.amount, res: c.reservationCount, att: c.attendanceCount,
        cpo: eval_.seminarSeatCpo?.amount ?? null, reason: d.reason,
      });
    } else {
      skipReasons.underThreshold++;
    }
  }

  console.log(`\n✅ 評価対象: ${evaluated}件 / スキップ: LP-CR不明${skipReasons.noLpCr} 開始日不明${skipReasons.noStart} 配信5日未満${skipReasons.notLongEnough} 閾値内${skipReasons.underThreshold}`);
  console.log(`\n🚨 アラート候補: ${alertCandidates.length}件\n`);
  alertCandidates.sort((a, b) => b.spend - a.spend);
  console.log('acc  | 日 | spend     | 予約 | 着座 | CPO       | reason                      | name');
  for (const c of alertCandidates.slice(0, 30)) {
    console.log(`${c.account} | ${String(c.days).padStart(2)} | ¥${String(c.spend).padStart(8)} | ${String(c.res).padStart(3)}  | ${String(c.att).padStart(3)}  | ${c.cpo != null ? '¥' + c.cpo.toLocaleString().padStart(8) : '   ---   '} | ${c.reason!.padEnd(28)} | ${c.name}`);
  }
  if (alertCandidates.length > 30) console.log(`  ... 他${alertCandidates.length - 30}件`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
