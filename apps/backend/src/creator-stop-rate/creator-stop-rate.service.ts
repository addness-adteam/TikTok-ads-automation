import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { validateAdNameFormat } from '../common/utils/optimization-error.util';
import { detectChannelType } from '../budget-optimization-v2/types';

interface CreatorAd {
  adName: string;
  adTiktokId: string;
  status: string;
  isPaused: boolean;
  pauseDate: string | null;
}

interface CreatorCR {
  crName: string;
  ads: CreatorAd[];
  isFullyPaused: boolean;
}

interface CreatorStopRate {
  creatorName: string;
  crCount: number;
  pauseCount: number;
  stopRate: number;
  isAlert: boolean;
  crs: CreatorCR[];
  /** @deprecated Use crCount instead */
  adCount: number;
  /** @deprecated Use crs instead */
  ads: CreatorAd[];
}

export interface CreatorStopRateResponse {
  success: boolean;
  data: {
    summary: {
      totalCreators: number;
      totalCRs: number;
      totalPaused: number;
      overallStopRate: number;
      alertCount: number;
      totalAds: number;
    };
    creators: CreatorStopRate[];
    period: {
      from: string;
      to: string;
      days: number;
    };
    advertiserIds: string[];
  };
}

@Injectable()
export class CreatorStopRateService {
  private readonly logger = new Logger(CreatorStopRateService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getCreatorStopRates(options?: {
    advertiserIds?: string[];
    days?: number;
  }): Promise<CreatorStopRateResponse> {
    const days = options?.days || 30;

    // Step 1: 対象アカウント取得
    const advertiserIds = await this.getTargetAdvertiserIds(
      options?.advertiserIds,
    );

    if (advertiserIds.length === 0) {
      return this.emptyResponse(days);
    }

    // Step 2: 直近N日のYYMMDD範囲を算出（JST）
    const now = new Date();
    const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const jstFrom = new Date(jstNow);
    jstFrom.setDate(jstFrom.getDate() - days);

    const toDateStr = this.formatDateYYMMDD(jstNow);
    const fromDateStr = this.formatDateYYMMDD(jstFrom);

    this.logger.log(
      `集計期間: ${fromDateStr} ~ ${toDateStr} (${days}日間), 対象アカウント: ${advertiserIds.length}件`,
    );

    // Step 3: 対象アカウントの全広告を取得
    const ads = await this.prisma.ad.findMany({
      where: {
        adGroup: {
          campaign: {
            advertiserId: { in: advertiserIds },
          },
        },
      },
      select: {
        id: true,
        tiktokId: true,
        name: true,
        status: true,
      },
    });

    // 広告名をパースし、日付が範囲内のもののみ抽出
    const targetAds: {
      id: string;
      tiktokId: string;
      name: string;
      status: string;
      creator: string;
      date: string;
    }[] = [];

    for (const ad of ads) {
      const result = validateAdNameFormat(ad.name);
      if (!result.isValid || !result.parsed) continue;

      const adDate = result.parsed.date;
      if (adDate >= fromDateStr && adDate <= toDateStr) {
        targetAds.push({
          id: ad.id,
          tiktokId: ad.tiktokId,
          name: ad.name,
          status: ad.status,
          creator: result.parsed.creator,
          date: adDate,
        });
      }
    }

    this.logger.log(
      `対象広告数: ${targetAds.length} / 全広告数: ${ads.length}`,
    );

    if (targetAds.length === 0) {
      return this.emptyResponse(days, advertiserIds, fromDateStr, toDateStr);
    }

    // Step 4: 停止記録を取得
    const tiktokIds = targetAds.map((a) => a.tiktokId);
    const changeLogs = await this.prisma.changeLog.findMany({
      where: {
        entityType: 'AD',
        entityId: { in: tiktokIds },
        action: 'PAUSE',
        source: { in: ['OPTIMIZATION', 'BUDGET_OPTIMIZATION_V2'] },
      },
      select: {
        entityId: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // 停止済みadのtiktokIdセット（重複排除）+ 最初の停止日時
    const pausedAdMap = new Map<string, Date>();
    for (const log of changeLogs) {
      if (!pausedAdMap.has(log.entityId)) {
        pausedAdMap.set(log.entityId, log.createdAt);
      }
    }

    this.logger.log(`停止記録のある広告数: ${pausedAdMap.size}`);

    // Step 5: 制作者 × CR名 でグループ化
    // 同じCR名で複数出稿されている場合、全て停止された場合のみ「停止」とカウント
    const creatorCRMap = new Map<
      string,
      Map<string, CreatorAd[]>
    >();

    for (const ad of targetAds) {
      if (!creatorCRMap.has(ad.creator)) {
        creatorCRMap.set(ad.creator, new Map());
      }

      const crMap = creatorCRMap.get(ad.creator)!;
      const result = validateAdNameFormat(ad.name);
      const crName = result.parsed?.creativeName || ad.name;

      if (!crMap.has(crName)) {
        crMap.set(crName, []);
      }

      const isPaused = pausedAdMap.has(ad.tiktokId);
      const pauseDate = isPaused ? pausedAdMap.get(ad.tiktokId)! : null;

      crMap.get(crName)!.push({
        adName: ad.name,
        adTiktokId: ad.tiktokId,
        status: ad.status,
        isPaused,
        pauseDate: pauseDate ? pauseDate.toISOString() : null,
      });
    }

    // Step 6: レスポンス構築（CR単位で停止判定）
    const creators: CreatorStopRate[] = [];
    let totalPaused = 0;
    let totalCRs = 0;

    for (const [creatorName, crMap] of creatorCRMap) {
      const crs: CreatorCR[] = [];
      let creatorPauseCount = 0;
      const allAds: CreatorAd[] = [];

      for (const [crName, ads] of crMap) {
        const isFullyPaused = ads.length > 0 && ads.every((a) => a.isPaused);
        crs.push({ crName, ads, isFullyPaused });
        allAds.push(...ads);
        if (isFullyPaused) {
          creatorPauseCount++;
        }
      }

      const crCount = crs.length;
      const stopRate =
        crCount > 0 ? Math.round((creatorPauseCount / crCount) * 1000) / 10 : 0;

      creators.push({
        creatorName,
        crCount,
        pauseCount: creatorPauseCount,
        stopRate,
        isAlert: stopRate > 90,
        crs,
        adCount: allAds.length,
        ads: allAds,
      });

      totalPaused += creatorPauseCount;
      totalCRs += crCount;
    }

    // 停止率の降順でソート
    creators.sort((a, b) => b.stopRate - a.stopRate);

    const totalAds = targetAds.length;
    const overallStopRate =
      totalCRs > 0 ? Math.round((totalPaused / totalCRs) * 1000) / 10 : 0;
    const alertCount = creators.filter((c) => c.isAlert).length;

    return {
      success: true,
      data: {
        summary: {
          totalCreators: creators.length,
          totalCRs,
          totalPaused,
          overallStopRate,
          alertCount,
          totalAds,
        },
        creators,
        period: {
          from: this.toISODate(fromDateStr),
          to: this.toISODate(toDateStr),
          days,
        },
        advertiserIds,
      },
    };
  }

  private async getTargetAdvertiserIds(
    requestedIds?: string[],
  ): Promise<string[]> {
    if (requestedIds && requestedIds.length > 0) {
      return requestedIds;
    }

    // Appeal付きのAdvertiserを取得し、AI or SEMINAR のみフィルタ
    const advertisers = await this.prisma.advertiser.findMany({
      where: {
        appeal: { isNot: null },
      },
      select: {
        id: true,
        appeal: { select: { name: true } },
      },
    });

    return advertisers
      .filter((adv) => {
        if (!adv.appeal) return false;
        const channelType = detectChannelType(adv.appeal.name);
        return channelType === 'AI' || channelType === 'SEMINAR';
      })
      .map((adv) => adv.id);
  }

  /** YYMMDD形式に変換 */
  private formatDateYYMMDD(date: Date): string {
    const yy = String(date.getFullYear()).slice(-2);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yy}${mm}${dd}`;
  }

  /** YYMMDD → YYYY-MM-DD */
  private toISODate(yymmdd: string): string {
    const yy = yymmdd.slice(0, 2);
    const mm = yymmdd.slice(2, 4);
    const dd = yymmdd.slice(4, 6);
    return `20${yy}-${mm}-${dd}`;
  }

  private emptyResponse(
    days: number,
    advertiserIds: string[] = [],
    from?: string,
    to?: string,
  ): CreatorStopRateResponse {
    const now = new Date();
    const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const jstFrom = new Date(jstNow);
    jstFrom.setDate(jstFrom.getDate() - days);

    return {
      success: true,
      data: {
        summary: {
          totalCreators: 0,
          totalCRs: 0,
          totalPaused: 0,
          overallStopRate: 0,
          alertCount: 0,
          totalAds: 0,
        },
        creators: [],
        period: {
          from: from
            ? this.toISODate(from)
            : this.toISODate(this.formatDateYYMMDD(jstFrom)),
          to: to
            ? this.toISODate(to)
            : this.toISODate(this.formatDateYYMMDD(jstNow)),
          days,
        },
        advertiserIds,
      },
    };
  }
}
