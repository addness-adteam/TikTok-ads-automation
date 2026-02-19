import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateAppealDto {
  name: string;
  targetCPA?: number;
  allowableCPA?: number;
  targetFrontCPO?: number;
  allowableFrontCPO?: number;
  allowableIndividualReservationCPO?: number;
  cvSpreadsheetUrl?: string;
  frontSpreadsheetUrl?: string;
}

export interface UpdateAppealDto {
  name?: string;
  targetCPA?: number;
  allowableCPA?: number;
  targetFrontCPO?: number;
  allowableFrontCPO?: number;
  allowableIndividualReservationCPO?: number;
  cvSpreadsheetUrl?: string;
  frontSpreadsheetUrl?: string;
}

@Injectable()
export class AppealService {
  private readonly logger = new Logger(AppealService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  /**
   * 訴求名からスプレッドシートURLを自動生成
   */
  private getSpreadsheetUrlsForAppeal(appealName: string): {
    cvSpreadsheetUrl: string;
    frontSpreadsheetUrl: string;
  } {
    const normalizedName = appealName.toUpperCase();
    let cvSpreadsheetId: string | undefined;
    let frontSpreadsheetId: string | undefined;

    // 訴求名に応じてスプレッドシートIDを取得
    if (normalizedName.includes('SNS')) {
      cvSpreadsheetId = this.configService.get<string>('APPEAL_SNS_CV_SPREADSHEET_ID');
      frontSpreadsheetId = this.configService.get<string>('APPEAL_SNS_FRONT_SPREADSHEET_ID');
    } else if (normalizedName.includes('AI')) {
      cvSpreadsheetId = this.configService.get<string>('APPEAL_AI_CV_SPREADSHEET_ID');
      frontSpreadsheetId = this.configService.get<string>('APPEAL_AI_FRONT_SPREADSHEET_ID');
    } else if (normalizedName.includes('デザジュク') || normalizedName.includes('DESAJUKU')) {
      cvSpreadsheetId = this.configService.get<string>('APPEAL_DESAJUKU_CV_SPREADSHEET_ID');
      frontSpreadsheetId = this.configService.get<string>('APPEAL_DESAJUKU_FRONT_SPREADSHEET_ID');
    }

    // スプレッドシートIDが見つからない場合はエラー
    if (!cvSpreadsheetId || !frontSpreadsheetId) {
      throw new Error(
        `Spreadsheet configuration not found for appeal: ${appealName}. ` +
        `Please check your environment variables.`
      );
    }

    // URLを生成
    const cvSpreadsheetUrl = `https://docs.google.com/spreadsheets/d/${cvSpreadsheetId}/edit`;
    const frontSpreadsheetUrl = `https://docs.google.com/spreadsheets/d/${frontSpreadsheetId}/edit`;

    this.logger.log(`Generated spreadsheet URLs for ${appealName}: CV=${cvSpreadsheetUrl}, Front=${frontSpreadsheetUrl}`);

    return {
      cvSpreadsheetUrl,
      frontSpreadsheetUrl,
    };
  }

  /**
   * 訴求マスタ一覧取得
   */
  async findAll() {
    return this.prisma.appeal.findMany({
      include: {
        advertisers: {
          select: {
            id: true,
            tiktokAdvertiserId: true,
            name: true,
          },
        },
        adTextTemplates: {
          where: {
            isActive: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * 訴求マスタ取得（ID指定）
   */
  async findOne(id: string) {
    const appeal = await this.prisma.appeal.findUnique({
      where: { id },
      include: {
        advertisers: {
          select: {
            id: true,
            tiktokAdvertiserId: true,
            name: true,
          },
        },
        adTextTemplates: {
          where: {
            isActive: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!appeal) {
      throw new NotFoundException(`Appeal with ID ${id} not found`);
    }

    return appeal;
  }

  /**
   * 訴求マスタ取得（名前指定）
   */
  async findByName(name: string) {
    return this.prisma.appeal.findUnique({
      where: { name },
      include: {
        advertisers: {
          select: {
            id: true,
            tiktokAdvertiserId: true,
            name: true,
          },
        },
      },
    });
  }

  /**
   * 訴求マスタ作成
   */
  async create(data: CreateAppealDto) {
    this.logger.log(`Creating appeal: ${data.name}`);

    let cvSpreadsheetUrl = data.cvSpreadsheetUrl;
    let frontSpreadsheetUrl = data.frontSpreadsheetUrl;

    // URLが明示的に指定されていない場合のみ自動生成
    if (!cvSpreadsheetUrl || !frontSpreadsheetUrl) {
      const generated = this.getSpreadsheetUrlsForAppeal(data.name);
      cvSpreadsheetUrl = cvSpreadsheetUrl || generated.cvSpreadsheetUrl;
      frontSpreadsheetUrl = frontSpreadsheetUrl || generated.frontSpreadsheetUrl;
    }

    return this.prisma.appeal.create({
      data: {
        name: data.name,
        targetCPA: data.targetCPA,
        allowableCPA: data.allowableCPA,
        targetFrontCPO: data.targetFrontCPO,
        allowableFrontCPO: data.allowableFrontCPO,
        allowableIndividualReservationCPO: data.allowableIndividualReservationCPO,
        cvSpreadsheetUrl,
        frontSpreadsheetUrl,
      },
    });
  }

  /**
   * 訴求マスタ更新
   */
  async update(id: string, data: UpdateAppealDto) {
    this.logger.log(`Updating appeal: ${id}`);

    // 存在確認
    await this.findOne(id);

    return this.prisma.appeal.update({
      where: { id },
      data: {
        name: data.name,
        targetCPA: data.targetCPA,
        allowableCPA: data.allowableCPA,
        targetFrontCPO: data.targetFrontCPO,
        allowableFrontCPO: data.allowableFrontCPO,
        allowableIndividualReservationCPO: data.allowableIndividualReservationCPO,
        cvSpreadsheetUrl: data.cvSpreadsheetUrl,
        frontSpreadsheetUrl: data.frontSpreadsheetUrl,
      },
    });
  }

  /**
   * 訴求マスタ削除
   */
  async remove(id: string) {
    this.logger.log(`Deleting appeal: ${id}`);

    // 存在確認
    await this.findOne(id);

    return this.prisma.appeal.delete({
      where: { id },
    });
  }

  /**
   * Advertiserに訴求を紐付け
   */
  async assignToAdvertiser(appealId: string, advertiserId: string) {
    this.logger.log(`Assigning appeal ${appealId} to advertiser ${advertiserId}`);

    // 訴求とAdvertiserの存在確認
    await this.findOne(appealId);
    const advertiser = await this.prisma.advertiser.findUnique({
      where: { id: advertiserId },
    });

    if (!advertiser) {
      throw new NotFoundException(`Advertiser with ID ${advertiserId} not found`);
    }

    return this.prisma.advertiser.update({
      where: { id: advertiserId },
      data: {
        appealId,
      },
    });
  }
}
