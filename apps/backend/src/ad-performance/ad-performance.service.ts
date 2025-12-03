import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';

// インプレッション閾値（10万）
const IMPRESSION_THRESHOLD = 100000;

// 消化額トリガー閾値（10万円）
const SPEND_REVIEW_THRESHOLD = 100000;

// CPA乖離閾値（20%）
const CPA_DEVIATION_THRESHOLD = 0.20;

// CPA急激悪化閾値（50%）
const CRITICAL_CPA_DEVIATION_THRESHOLD = 0.50;

@Injectable()
export class AdPerformanceService {
  private readonly logger = new Logger(AdPerformanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly googleSheetsService: GoogleSheetsService,
  ) {}

  /**
   * 新規広告のAdPerformance初期化
   * 日次エンティティ同期後に呼び出される
   */
  async initializeNewAdPerformances(advertiserId: string): Promise<void> {
    try {
      // 広告主に属する全広告を取得
      const ads = await this.prisma.ad.findMany({
        where: {
          adGroup: {
            campaign: {
              advertiserId,
            },
          },
        },
        select: {
          id: true,
          name: true,
        },
      });

      // AdPerformanceがない広告を特定
      const existingPerformances = await this.prisma.adPerformance.findMany({
        where: {
          advertiserId,
        },
        select: {
          adId: true,
        },
      });

      const existingAdIds = new Set(existingPerformances.map((p) => p.adId));
      const newAds = ads.filter((ad) => !existingAdIds.has(ad.id));

      if (newAds.length === 0) {
        this.logger.log(`No new ads to initialize for advertiser ${advertiserId}`);
        return;
      }

      // 新規AdPerformanceを作成
      await this.prisma.adPerformance.createMany({
        data: newAds.map((ad) => ({
          adId: ad.id,
          advertiserId,
          totalSpend: 0,
          totalImpressions: 0,
          totalClicks: 0,
          totalConversions: 0,
          totalFrontSales: 0,
          spendAtLastReview: 0,
          reviewCount: 0,
          impressionThresholdMet: false,
        })),
        skipDuplicates: true,
      });

      this.logger.log(
        `Initialized ${newAds.length} new AdPerformance records for advertiser ${advertiserId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to initialize AdPerformances for advertiser ${advertiserId}: ${error.message}`,
        error,
      );
    }
  }

  /**
   * 全広告主の新規広告のAdPerformanceを初期化
   */
  async initializeAllNewAdPerformances(): Promise<void> {
    const advertisers = await this.prisma.advertiser.findMany({
      select: { id: true },
    });

    for (const advertiser of advertisers) {
      await this.initializeNewAdPerformances(advertiser.id);
    }
  }

  /**
   * 広告主の全AdPerformanceを更新
   * 日次レポート取得後に呼び出される
   */
  async updateAdPerformances(advertiserId: string): Promise<void> {
    try {
      this.logger.log(`Updating AdPerformances for advertiser ${advertiserId}`);

      // 広告主に属する全広告のメトリクスを集計
      const adMetrics = await this.prisma.metric.groupBy({
        by: ['adId'],
        where: {
          entityType: 'AD',
          ad: {
            adGroup: {
              campaign: {
                advertiserId,
              },
            },
          },
        },
        _sum: {
          spend: true,
          impressions: true,
          clicks: true,
          conversions: true,
        },
      });

      // AdPerformanceを更新
      for (const metric of adMetrics) {
        if (!metric.adId) continue;

        const totalSpend = metric._sum.spend || 0;
        const totalImpressions = metric._sum.impressions || 0;
        const totalClicks = metric._sum.clicks || 0;
        const totalConversions = metric._sum.conversions || 0;

        // インプレッション閾値達成チェック
        const impressionThresholdMet = totalImpressions >= IMPRESSION_THRESHOLD;

        await this.prisma.adPerformance.upsert({
          where: { adId: metric.adId },
          create: {
            adId: metric.adId,
            advertiserId,
            totalSpend,
            totalImpressions,
            totalClicks,
            totalConversions,
            impressionThresholdMet,
            impressionThresholdMetAt: impressionThresholdMet ? new Date() : null,
          },
          update: {
            totalSpend,
            totalImpressions,
            totalClicks,
            totalConversions,
            impressionThresholdMet,
            impressionThresholdMetAt: impressionThresholdMet
              ? { set: new Date() }
              : undefined,
          },
        });
      }

      this.logger.log(
        `Updated ${adMetrics.length} AdPerformance records for advertiser ${advertiserId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update AdPerformances for advertiser ${advertiserId}: ${error.message}`,
        error,
      );
    }
  }

  /**
   * 全広告主のAdPerformanceを更新
   */
  async updateAllAdPerformances(): Promise<void> {
    const advertisers = await this.prisma.advertiser.findMany({
      select: { id: true },
    });

    for (const advertiser of advertisers) {
      await this.updateAdPerformances(advertiser.id);
    }
  }

  /**
   * CPA乖離と消化額トリガーをチェック
   * インプレッション10万達成済みの広告のみ対象
   */
  async checkDeviationsAndTriggers(advertiserId: string): Promise<void> {
    try {
      this.logger.log(`Checking deviations and triggers for advertiser ${advertiserId}`);

      // インプレッション閾値達成済みの広告を取得
      const performances = await this.prisma.adPerformance.findMany({
        where: {
          advertiserId,
          impressionThresholdMet: true,
        },
        include: {
          ad: {
            include: {
              adGroup: {
                include: {
                  campaign: {
                    include: {
                      advertiser: {
                        include: {
                          appeal: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      for (const performance of performances) {
        const ad = performance.ad;
        const appeal = ad.adGroup.campaign.advertiser.appeal;

        // Google SheetsからCV数を取得してCPAを計算
        let currentCPA: number | null = null;
        if (appeal?.cvSpreadsheetUrl && performance.totalSpend > 0) {
          try {
            // 広告名から登録経路を抽出（例: "TikTok広告-SNS-LP1-CR00572"）
            const registrationPath = this.extractRegistrationPath(ad.name);
            if (registrationPath) {
              const cvCount = await this.googleSheetsService.countRegistrationPath(
                appeal.cvSpreadsheetUrl,
                'TT_オプト', // シート名は固定
                registrationPath,
                new Date(0), // 全期間
                new Date(),
              );

              if (cvCount > 0) {
                currentCPA = performance.totalSpend / cvCount;
              }
            }
          } catch (error) {
            this.logger.warn(`Failed to get CV count from Google Sheets for ad ${ad.id}: ${error.message}`);
          }
        }

        // メトリクスベースのCPAをフォールバック
        if (currentCPA === null && performance.totalConversions > 0) {
          currentCPA = performance.totalSpend / performance.totalConversions;
        }

        // 過去最高CPA更新チェック
        if (currentCPA !== null) {
          const shouldUpdateBestCPA =
            performance.bestCPA === null || currentCPA < performance.bestCPA;

          if (shouldUpdateBestCPA) {
            await this.prisma.adPerformance.update({
              where: { id: performance.id },
              data: {
                bestCPA: currentCPA,
                bestCPADate: new Date(),
              },
            });
            this.logger.log(
              `Updated best CPA for ad ${ad.name}: ¥${currentCPA.toLocaleString()}`,
            );
          }

          // CPA乖離チェック（過去最高CPAがある場合）
          if (performance.bestCPA !== null && currentCPA > performance.bestCPA) {
            const deviationRate = (currentCPA - performance.bestCPA) / performance.bestCPA;

            if (deviationRate >= CPA_DEVIATION_THRESHOLD) {
              await this.notificationService.createCPADeviationNotification(
                advertiserId,
                ad.id,
                ad.name,
                performance.bestCPA,
                currentCPA,
                performance.totalSpend,
                performance.totalImpressions,
              );
            }
          }
        }

        // CTR計算と更新
        if (performance.totalImpressions > 0) {
          const currentCTR = (performance.totalClicks / performance.totalImpressions) * 100;
          const shouldUpdateBestCTR =
            performance.bestCTR === null || currentCTR > performance.bestCTR;

          if (shouldUpdateBestCTR) {
            await this.prisma.adPerformance.update({
              where: { id: performance.id },
              data: {
                bestCTR: currentCTR,
                bestCTRDate: new Date(),
              },
            });
          }
        }

        // 消化額トリガーチェック（10万円消化ごと）
        const spendSinceLastReview = performance.totalSpend - performance.spendAtLastReview;
        if (spendSinceLastReview >= SPEND_REVIEW_THRESHOLD) {
          // 直近7日間のパフォーマンスを取得
          const recentMetrics = await this.getRecentMetrics(ad.id, 7);

          await this.notificationService.createAdReviewNotification(
            advertiserId,
            ad.id,
            ad.name,
            spendSinceLastReview,
            performance.totalSpend,
            {
              bestCPA: performance.bestCPA ?? undefined,
              currentCPA: currentCPA ?? undefined,
              cpaDeviationRate: performance.bestCPA && currentCPA
                ? ((currentCPA - performance.bestCPA) / performance.bestCPA) * 100
                : undefined,
              bestCTR: performance.bestCTR ?? undefined,
              currentCTR: recentMetrics.ctr,
            },
          );

          // 見直し情報を更新
          await this.prisma.adPerformance.update({
            where: { id: performance.id },
            data: {
              spendAtLastReview: performance.totalSpend,
              lastReviewDate: new Date(),
              reviewCount: { increment: 1 },
            },
          });
        }
      }

      this.logger.log(
        `Completed deviation and trigger checks for advertiser ${advertiserId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to check deviations and triggers for advertiser ${advertiserId}: ${error.message}`,
        error,
      );
    }
  }

  /**
   * 全広告主のCPA乖離と消化額トリガーをチェック
   */
  async checkAllDeviationsAndTriggers(): Promise<void> {
    const advertisers = await this.prisma.advertiser.findMany({
      select: { id: true },
    });

    for (const advertiser of advertisers) {
      await this.checkDeviationsAndTriggers(advertiser.id);
    }
  }

  /**
   * 広告名から登録経路を抽出
   * 形式: 出稿日/制作者名/CR名/LP名-番号
   */
  private extractRegistrationPath(adName: string): string | null {
    // 広告名パターンから登録経路を生成
    // 例: "2024/01/15/山田/新春CR/TikTok広告-SNS-LP1" → "TikTok広告-SNS-LP1"
    const parts = adName.split('/');
    if (parts.length >= 4) {
      return parts[parts.length - 1]; // 最後のパート
    }
    return null;
  }

  /**
   * 直近N日間のメトリクスを取得
   */
  private async getRecentMetrics(
    adId: string,
    days: number,
  ): Promise<{
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    ctr: number;
    cpa: number;
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const metrics = await this.prisma.metric.aggregate({
      where: {
        adId,
        entityType: 'AD',
        statDate: {
          gte: startDate,
        },
      },
      _sum: {
        spend: true,
        impressions: true,
        clicks: true,
        conversions: true,
      },
    });

    const spend = metrics._sum.spend || 0;
    const impressions = metrics._sum.impressions || 0;
    const clicks = metrics._sum.clicks || 0;
    const conversions = metrics._sum.conversions || 0;

    return {
      spend,
      impressions,
      clicks,
      conversions,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpa: conversions > 0 ? spend / conversions : 0,
    };
  }

  /**
   * 広告パフォーマンス一覧取得
   */
  async getAdPerformances(
    advertiserId: string,
    options?: {
      impressionThresholdMet?: boolean;
      hasDeviation?: boolean;
    },
  ): Promise<{
    performances: any[];
    summary: {
      totalAds: number;
      adsWithDeviation: number;
      adsNeedingReview: number;
    };
  }> {
    const where: any = { advertiserId };

    if (options?.impressionThresholdMet !== undefined) {
      where.impressionThresholdMet = options.impressionThresholdMet;
    }

    const performances = await this.prisma.adPerformance.findMany({
      where,
      include: {
        ad: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
      },
      orderBy: { totalSpend: 'desc' },
    });

    // 乖離がある広告をフィルタ
    let filteredPerformances = performances;
    if (options?.hasDeviation) {
      filteredPerformances = performances.filter((p) => {
        if (p.bestCPA === null || p.totalConversions === 0) return false;
        const currentCPA = p.totalSpend / p.totalConversions;
        const deviationRate = (currentCPA - p.bestCPA) / p.bestCPA;
        return deviationRate >= CPA_DEVIATION_THRESHOLD;
      });
    }

    // サマリー計算
    const adsWithDeviation = performances.filter((p) => {
      if (p.bestCPA === null || p.totalConversions === 0) return false;
      const currentCPA = p.totalSpend / p.totalConversions;
      const deviationRate = (currentCPA - p.bestCPA) / p.bestCPA;
      return deviationRate >= CPA_DEVIATION_THRESHOLD;
    }).length;

    const adsNeedingReview = performances.filter((p) => {
      const spendSinceLastReview = p.totalSpend - p.spendAtLastReview;
      return spendSinceLastReview >= SPEND_REVIEW_THRESHOLD;
    }).length;

    return {
      performances: filteredPerformances,
      summary: {
        totalAds: performances.length,
        adsWithDeviation,
        adsNeedingReview,
      },
    };
  }

  /**
   * 広告パフォーマンス詳細取得
   */
  async getAdPerformanceDetail(adId: string): Promise<{
    performance: any;
    currentMetrics: any;
    deviationStatus: any;
    reviewStatus: any;
  } | null> {
    const performance = await this.prisma.adPerformance.findUnique({
      where: { adId },
      include: {
        ad: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
      },
    });

    if (!performance) {
      return null;
    }

    // 直近7日間のメトリクス
    const recentMetrics = await this.getRecentMetrics(adId, 7);

    // 現在のCPA
    const currentCPA = performance.totalConversions > 0
      ? performance.totalSpend / performance.totalConversions
      : null;

    // 乖離ステータス
    const cpaDeviation = performance.bestCPA !== null && currentCPA !== null
      ? ((currentCPA - performance.bestCPA) / performance.bestCPA) * 100
      : null;

    const ctrDeviation = performance.bestCTR !== null && recentMetrics.ctr > 0
      ? ((recentMetrics.ctr - performance.bestCTR) / performance.bestCTR) * 100
      : null;

    // 見直しステータス
    const spendSinceLastReview = performance.totalSpend - performance.spendAtLastReview;
    const daysSinceLastReview = performance.lastReviewDate
      ? Math.floor(
          (Date.now() - performance.lastReviewDate.getTime()) / (1000 * 60 * 60 * 24),
        )
      : null;

    return {
      performance,
      currentMetrics: {
        cpa: currentCPA,
        ctr: recentMetrics.ctr,
        spend: recentMetrics.spend,
        impressions: recentMetrics.impressions,
        clicks: recentMetrics.clicks,
        conversions: recentMetrics.conversions,
      },
      deviationStatus: {
        cpaDeviation,
        ctrDeviation,
      },
      reviewStatus: {
        needsReview: spendSinceLastReview >= SPEND_REVIEW_THRESHOLD,
        spendSinceLastReview,
        daysSinceLastReview,
      },
    };
  }
}
