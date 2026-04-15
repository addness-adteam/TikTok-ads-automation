import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AttendanceCountService } from '../domain/services/attendance-count-service';
import { AlertRuleEvaluator } from '../domain/services/alert-rule-evaluator';
import { AdUnderEvaluation } from '../domain/entities/ad-under-evaluation';
import { JPY } from '../domain/value-objects/jpy';
import { DeliveryPeriod } from '../domain/value-objects/delivery-period';
import { YearMonth } from '../domain/value-objects/allowable-seminar-seat-cpo';
import { SheetsAllowableCpoResolver } from '../infrastructure/allowable-cpo-resolver';
import { SheetsOptLatestPathReader } from '../infrastructure/opt-latest-path-reader';
import { SheetsReservationSurveyReader } from '../infrastructure/reservation-survey-reader';
import { SheetsAttendanceLineNameReader } from '../infrastructure/attendance-line-name-reader';
import { PrismaAlertHistoryRepository } from '../infrastructure/alert-history-repository';
import { AiSecretaryLineNotifier } from '../infrastructure/line-notifier';

/** スキルプラス導線のアカウント */
const SP_ADVERTISER_IDS: Record<string, string> = {
  '7474920444831875080': 'SP1',
  '7592868952431362066': 'SP2',
  '7616545514662051858': 'SP3',
};

export interface AlertRunResult {
  evaluated: number;
  triggered: number;
  skipped: {
    alreadyAlerted: number;
    notEnoughDays: number;
    underThreshold: number;
  };
  allowableCpo: number | null;
  attendanceCount: number;
  errors: string[];
}

@Injectable()
export class SeminarAttendanceAlertUseCase {
  private readonly logger = new Logger(SeminarAttendanceAlertUseCase.name);
  private readonly counter = new AttendanceCountService();
  private readonly evaluator = new AlertRuleEvaluator();

  constructor(
    private readonly prisma: PrismaService,
    private readonly allowableResolver: SheetsAllowableCpoResolver,
    private readonly optReader: SheetsOptLatestPathReader,
    private readonly surveyReader: SheetsReservationSurveyReader,
    private readonly attendanceReader: SheetsAttendanceLineNameReader,
    private readonly historyRepo: PrismaAlertHistoryRepository,
    private readonly notifier: AiSecretaryLineNotifier,
  ) {}

  async run(options: { dryRun?: boolean } = {}): Promise<AlertRunResult> {
    const result: AlertRunResult = {
      evaluated: 0,
      triggered: 0,
      skipped: { alreadyAlerted: 0, notEnoughDays: 0, underThreshold: 0 },
      allowableCpo: null,
      attendanceCount: 0,
      errors: [],
    };
    const now = new Date();

    // 1) 許容CPO取得
    const ym = YearMonth.fromDate(now);
    const allowable = await this.allowableResolver.resolve(ym);
    if (!allowable) {
      result.errors.push(`許容CPO未取得: ${ym.toString()}`);
      return result;
    }
    result.allowableCpo = allowable.amount.amount;
    this.logger.log(
      `許容セミナー着座CPO (${ym.toString()}) = ¥${result.allowableCpo}`,
    );

    // 2) 各データソースロード
    const [optMap, reservations, attendedLineNames] = await Promise.all([
      this.optReader.load(),
      this.surveyReader.load(),
      this.attendanceReader.load(),
    ]);
    result.attendanceCount = attendedLineNames.size;
    this.logger.log(
      `opt=${optMap.size} / 予約=${reservations.length} / 着座=${attendedLineNames.size}`,
    );

    // 3) LP-CR × {予約数, 着座数}
    const countsByLpCr = this.counter.countByLpCr(
      optMap,
      reservations,
      attendedLineNames,
    );

    // 4) SP配下のアクティブ広告を取得
    const ads = await this.prisma.ad.findMany({
      where: {
        status: 'ENABLE',
        adGroup: {
          campaign: {
            advertiser: {
              tiktokAdvertiserId: { in: Object.keys(SP_ADVERTISER_IDS) },
            },
          },
        },
      },
      include: {
        adGroup: { include: { campaign: { include: { advertiser: true } } } },
      },
    });
    const adIds = ads.map((a) => a.id);
    const metrics = await this.prisma.metric.findMany({
      where: { entityType: 'AD', adId: { in: adIds } },
      select: { adId: true, spend: true },
    });
    const spendByAd = new Map<string, number>();
    for (const m of metrics) {
      if (!m.adId) continue;
      spendByAd.set(m.adId, (spendByAd.get(m.adId) ?? 0) + m.spend);
    }

    // 5) 通知済みMapを事前取得
    const alreadyAlerted = await this.historyRepo.loadAllAlertedIds();

    // 6) 各広告を評価
    for (const ad of ads) {
      const advId = ad.adGroup?.campaign?.advertiser?.tiktokAdvertiserId ?? '';
      const advName = SP_ADVERTISER_IDS[advId] ?? advId;
      const lpcrMatch = ad.name.match(/LP\d+-CR\d+/i);
      if (!lpcrMatch) continue;
      const lpCr = lpcrMatch[0].toUpperCase();
      const startDate = this.resolveDeliveryStart(ad);
      if (!startDate) continue;

      const period = DeliveryPeriod.between(startDate, now);
      if (period.elapsedDays > 30) continue;
      const spend = JPY.of(spendByAd.get(ad.id) ?? 0);
      const counts = countsByLpCr.get(lpCr) ?? {
        reservationCount: 0,
        attendanceCount: 0,
      };

      let evaluation: AdUnderEvaluation;
      try {
        evaluation = AdUnderEvaluation.create({
          adTiktokId: ad.tiktokId,
          adName: ad.name,
          advertiserName: advName,
          lpCrCode: lpCr,
          deliveryPeriod: period,
          totalSpend: spend,
          reservationCount: counts.reservationCount,
          attendanceCount: counts.attendanceCount,
        });
      } catch (e: any) {
        result.errors.push(`${ad.name}: ${e.message}`);
        continue;
      }

      result.evaluated++;
      const decision = this.evaluator.evaluate(
        evaluation,
        allowable,
        alreadyAlerted.has(ad.tiktokId),
      );

      if (!decision.shouldAlert) {
        if (decision.detail.alreadyAlerted) result.skipped.alreadyAlerted++;
        else if (!period.isLongEnough()) result.skipped.notEnoughDays++;
        else result.skipped.underThreshold++;
        continue;
      }

      // 発火: 通知 + 履歴保存
      result.triggered++;
      if (options.dryRun) {
        this.logger.log(`[DRY-RUN] 発火: ${ad.name} (${decision.reason})`);
        continue;
      }

      try {
        await this.notifier.notify({
          adName: ad.name,
          advertiserName: advName,
          deliveryStartDate: startDate,
          deliveryDays: period.elapsedDays,
          totalSpend: spend.amount,
          reservationCount: counts.reservationCount,
          attendanceCount: counts.attendanceCount,
          actualCpo: evaluation.seminarSeatCpo?.amount ?? null,
          allowableCpo: allowable.amount.amount,
          reason: decision.reason!,
        });
        await this.historyRepo.record({
          adTiktokId: ad.tiktokId,
          adName: ad.name,
          advertiserName: advName,
          reason: decision.reason!,
          deliveryDays: period.elapsedDays,
          totalSpend: spend.amount,
          reservationCount: counts.reservationCount,
          attendanceCount: counts.attendanceCount,
          actualCpo: evaluation.seminarSeatCpo?.amount ?? null,
          allowableCpo: allowable.amount.amount,
          overageRate: decision.detail.overageRate,
        });
      } catch (e: any) {
        result.errors.push(`notify/record ${ad.name}: ${e.message}`);
      }
    }

    this.logger.log(
      `完了: evaluated=${result.evaluated} triggered=${result.triggered}`,
    );
    return result;
  }

  private resolveDeliveryStart(ad: any): Date | null {
    const sched = ad.adGroup?.schedule;
    if (sched && typeof sched === 'object' && sched.startTime) {
      const d = new Date(sched.startTime);
      if (!isNaN(d.getTime())) return d;
    }
    if (ad.createdAt instanceof Date) return ad.createdAt;
    return null;
  }
}
