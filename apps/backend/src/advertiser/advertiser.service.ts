import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdvertiserService {
  private readonly logger = new Logger(AdvertiserService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 全Advertiser取得
   */
  async findAll() {
    this.logger.log('Finding all advertisers');
    return this.prisma.advertiser.findMany({
      include: {
        appeal: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  /**
   * Advertiser取得
   */
  async findOne(id: string) {
    this.logger.log(`Finding advertiser: ${id}`);
    const advertiser = await this.prisma.advertiser.findUnique({
      where: { id },
      include: {
        appeal: true,
      },
    });

    if (!advertiser) {
      throw new NotFoundException(`Advertiser with ID ${id} not found`);
    }

    return advertiser;
  }

  /**
   * 広告アカウントに紐づく広告一覧を取得
   * tiktokAdvertiserId から Campaign → AdGroup → Ad のリレーションを辿る
   */
  async findAdsByAdvertiserId(tiktokAdvertiserId: string) {
    this.logger.log(`Finding ads for advertiser: ${tiktokAdvertiserId}`);

    // tiktokAdvertiserIdでAdvertiserを検索
    const advertiser = await this.prisma.advertiser.findUnique({
      where: { tiktokAdvertiserId },
    });

    if (!advertiser) {
      throw new NotFoundException(
        `Advertiser with TikTok ID ${tiktokAdvertiserId} not found`,
      );
    }

    // Campaign → AdGroup → Ad のリレーションを辿って広告を取得
    const ads = await this.prisma.ad.findMany({
      where: {
        adGroup: {
          campaign: {
            advertiserId: advertiser.id,
          },
        },
      },
      select: {
        id: true,
        tiktokId: true,
        name: true,
        status: true,
        adGroup: {
          select: {
            id: true,
            name: true,
            campaign: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });

    return ads;
  }

  /**
   * Advertiserに訴求を紐付け
   */
  async assignAppeal(advertiserId: string, appealId: string | null) {
    this.logger.log(`Assigning appeal ${appealId} to advertiser ${advertiserId}`);

    // Advertiserが存在するか確認
    const advertiser = await this.prisma.advertiser.findUnique({
      where: { id: advertiserId },
    });

    if (!advertiser) {
      throw new NotFoundException(`Advertiser with ID ${advertiserId} not found`);
    }

    // appealIdがnullでない場合、Appealが存在するか確認
    if (appealId) {
      const appeal = await this.prisma.appeal.findUnique({
        where: { id: appealId },
      });

      if (!appeal) {
        throw new NotFoundException(`Appeal with ID ${appealId} not found`);
      }
    }

    // 紐付けを更新
    return this.prisma.advertiser.update({
      where: { id: advertiserId },
      data: {
        appealId,
      },
      include: {
        appeal: true,
      },
    });
  }
}
