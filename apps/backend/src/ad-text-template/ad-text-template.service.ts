import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateAdTextTemplateDto {
  appealId: string;
  name: string;
  text: string;
}

export interface UpdateAdTextTemplateDto {
  name?: string;
  text?: string;
  isActive?: boolean;
}

@Injectable()
export class AdTextTemplateService {
  private readonly logger = new Logger(AdTextTemplateService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 広告文テンプレート作成
   */
  async create(dto: CreateAdTextTemplateDto) {
    this.logger.log(`Creating ad text template: ${dto.name} for appeal: ${dto.appealId}`);

    const template = await this.prisma.adTextTemplate.create({
      data: {
        appealId: dto.appealId,
        name: dto.name,
        text: dto.text,
      },
    });

    this.logger.log(`Created ad text template: ${template.id}`);
    return template;
  }

  /**
   * 訴求IDで広告文テンプレート一覧取得
   */
  async findByAppealId(appealId: string) {
    this.logger.log(`Finding ad text templates for appeal: ${appealId}`);

    const templates = await this.prisma.adTextTemplate.findMany({
      where: {
        appealId,
        isActive: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    this.logger.log(`Found ${templates.length} ad text templates`);
    return templates;
  }

  /**
   * IDで広告文テンプレート取得
   */
  async findOne(id: string) {
    const template = await this.prisma.adTextTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException(`Ad text template not found: ${id}`);
    }

    return template;
  }

  /**
   * 広告文テンプレート更新
   */
  async update(id: string, dto: UpdateAdTextTemplateDto) {
    this.logger.log(`Updating ad text template: ${id}`);

    // 存在確認
    await this.findOne(id);

    const template = await this.prisma.adTextTemplate.update({
      where: { id },
      data: dto,
    });

    this.logger.log(`Updated ad text template: ${id}`);
    return template;
  }

  /**
   * 広告文テンプレート削除
   */
  async delete(id: string) {
    this.logger.log(`Deleting ad text template: ${id}`);

    // 存在確認
    await this.findOne(id);

    await this.prisma.adTextTemplate.delete({
      where: { id },
    });

    this.logger.log(`Deleted ad text template: ${id}`);
    return { success: true };
  }
}
