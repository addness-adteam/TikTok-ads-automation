// ============================================================================
// DatabaseWinningCreativeSource - AdPerformanceから勝ちCR取得
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WinningCreativeSource } from '../domain/ports';
import { ChannelType, WinningCreative } from '../domain/types';

// アカウントと導線の対応
const ACCOUNT_CHANNEL: Record<string, ChannelType> = {
  '7468288053866561553': 'AI',
  '7523128243466551303': 'AI',
  '7543540647266074641': 'AI',
  '7580666710525493255': 'AI',
  '7247073333517238273': 'SNS',
  '7543540100849156112': 'SNS',
  '7543540381615800337': 'SNS',
  '7474920444831875080': 'SKILL_PLUS',
  '7592868952431362066': 'SKILL_PLUS',
  '7616545514662051858': 'SKILL_PLUS',
};

@Injectable()
export class DatabaseWinningCreativeSource implements WinningCreativeSource {
  private readonly logger = new Logger(DatabaseWinningCreativeSource.name);

  constructor(private readonly prisma: PrismaService) {}

  async hasWinningCreatives(channelType: ChannelType): Promise<boolean> {
    const winners = await this.getWinningCreatives(channelType);
    return winners.length > 0;
  }

  async getWinningCreatives(channelType: ChannelType): Promise<WinningCreative[]> {
    // 対象チャネルのアカウントIDを取得
    const advertiserIds = Object.entries(ACCOUNT_CHANNEL)
      .filter(([, ch]) => ch === channelType)
      .map(([id]) => id);

    // 配信中の広告で、KPI達成しているもの（bestFrontCPOまたはbestCPAが設定済み）
    const ads = await this.prisma.ad.findMany({
      where: {
        adGroup: {
          campaign: {
            advertiser: {
              tiktokAdvertiserId: { in: advertiserIds },
            },
          },
        },
        status: 'ENABLE',
      },
      include: {
        adGroup: {
          include: {
            campaign: {
              include: { advertiser: true },
            },
          },
        },
      },
      take: 20,
    });

    // AdPerformanceテーブルからKPI達成を確認
    const winners: WinningCreative[] = [];
    for (const ad of ads) {
      const perf = await this.prisma.adPerformance.findUnique({
        where: { adId: ad.id },
      });

      if (!perf || !perf.impressionThresholdMet) continue;

      // 最低限のCV実績があるものを勝ちCRとする
      if (perf.totalConversions >= 3) {
        winners.push({
          adId: ad.tiktokId,
          adName: ad.name,
          advertiserId: ad.adGroup.campaign.advertiser.tiktokAdvertiserId,
          channelType,
        });
      }
    }

    return winners;
  }
}
