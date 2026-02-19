import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdBudgetCapService {
  private readonly logger = new Logger(AdBudgetCapService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * tiktokAdvertiserIdから内部Advertiser IDを解決
   * フロントエンドはtiktokAdvertiserIdを送信するため、内部IDへの変換が必要
   */
  private async resolveAdvertiserId(advertiserId: string): Promise<string> {
    // UUID形式ならそのまま返す
    if (advertiserId.includes('-')) {
      return advertiserId;
    }
    // tiktokAdvertiserIdとして検索
    const advertiser = await this.prisma.advertiser.findUnique({
      where: { tiktokAdvertiserId: advertiserId },
      select: { id: true },
    });
    if (!advertiser) {
      throw new NotFoundException(`Advertiser not found: ${advertiserId}`);
    }
    return advertiser.id;
  }

  /**
   * 上限日予算を設定
   */
  async createBudgetCap(data: {
    adId: string;
    advertiserId: string;
    maxDailyBudget: number;
    enabled?: boolean;
    startDate?: Date;
    endDate?: Date;
  }): Promise<any> {
    const internalAdvertiserId = await this.resolveAdvertiserId(data.advertiserId);

    return this.prisma.adBudgetCap.upsert({
      where: { adId: data.adId },
      create: {
        adId: data.adId,
        advertiserId: internalAdvertiserId,
        maxDailyBudget: data.maxDailyBudget,
        enabled: data.enabled ?? true,
        startDate: data.startDate,
        endDate: data.endDate,
      },
      update: {
        maxDailyBudget: data.maxDailyBudget,
        enabled: data.enabled ?? true,
        startDate: data.startDate,
        endDate: data.endDate,
      },
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
  }

  /**
   * 上限日予算を更新
   */
  async updateBudgetCap(
    id: string,
    data: {
      maxDailyBudget?: number;
      enabled?: boolean;
      startDate?: Date | null;
      endDate?: Date | null;
    },
  ): Promise<any> {
    return this.prisma.adBudgetCap.update({
      where: { id },
      data,
    });
  }

  /**
   * 上限日予算を削除
   */
  async deleteBudgetCap(id: string): Promise<void> {
    await this.prisma.adBudgetCap.delete({
      where: { id },
    });
  }

  /**
   * 広告主の上限日予算一覧を取得
   */
  async getBudgetCaps(
    advertiserId: string,
    options?: { enabled?: boolean },
  ): Promise<any[]> {
    const internalAdvertiserId = await this.resolveAdvertiserId(advertiserId);
    const where: any = { advertiserId: internalAdvertiserId };

    if (options?.enabled !== undefined) {
      where.enabled = options.enabled;
    }

    return this.prisma.adBudgetCap.findMany({
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
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 広告IDから上限日予算を取得
   */
  async getBudgetCapByAdId(adId: string): Promise<any | null> {
    return this.prisma.adBudgetCap.findUnique({
      where: { adId },
    });
  }

  /**
   * 広告セット内の有効な上限日予算を取得
   * 予算増額時に呼び出され、最小の上限を返す
   */
  async getEffectiveBudgetCapForAdGroup(adgroupId: string): Promise<{
    maxBudget: number | null;
    limitingAd: { adId: string; adName: string; maxDailyBudget: number } | null;
  }> {
    const today = new Date();

    // 広告セット内の全広告の上限日予算を取得
    const budgetCaps = await this.prisma.adBudgetCap.findMany({
      where: {
        ad: {
          adgroupId,
        },
        enabled: true,
        OR: [
          { startDate: null },
          { startDate: { lte: today } },
        ],
        AND: [
          {
            OR: [
              { endDate: null },
              { endDate: { gte: today } },
            ],
          },
        ],
      },
      include: {
        ad: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { maxDailyBudget: 'asc' },
    });

    if (budgetCaps.length === 0) {
      return { maxBudget: null, limitingAd: null };
    }

    // 最小の上限を返す
    const minCap = budgetCaps[0];
    return {
      maxBudget: minCap.maxDailyBudget,
      limitingAd: {
        adId: minCap.ad.id,
        adName: minCap.ad.name,
        maxDailyBudget: minCap.maxDailyBudget,
      },
    };
  }

  /**
   * キャンペーン内の有効な上限日予算を取得（キャンペーン予算の場合）
   */
  async getEffectiveBudgetCapForCampaign(campaignId: string): Promise<{
    maxBudget: number | null;
    limitingAd: { adId: string; adName: string; maxDailyBudget: number } | null;
  }> {
    const today = new Date();

    // キャンペーン内の全広告の上限日予算を取得
    const budgetCaps = await this.prisma.adBudgetCap.findMany({
      where: {
        ad: {
          adGroup: {
            campaignId,
          },
        },
        enabled: true,
        OR: [
          { startDate: null },
          { startDate: { lte: today } },
        ],
        AND: [
          {
            OR: [
              { endDate: null },
              { endDate: { gte: today } },
            ],
          },
        ],
      },
      include: {
        ad: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { maxDailyBudget: 'asc' },
    });

    if (budgetCaps.length === 0) {
      return { maxBudget: null, limitingAd: null };
    }

    // 最小の上限を返す
    const minCap = budgetCaps[0];
    return {
      maxBudget: minCap.maxDailyBudget,
      limitingAd: {
        adId: minCap.ad.id,
        adName: minCap.ad.name,
        maxDailyBudget: minCap.maxDailyBudget,
      },
    };
  }
}
