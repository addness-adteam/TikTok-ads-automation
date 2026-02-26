import { Controller, Post, Get, Patch, Delete, Body, Param, Query, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { BudgetOptimizationV2Service } from './budget-optimization-v2.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Controller('api/budget-optimization-v2')
export class BudgetOptimizationV2Controller {
  private readonly logger = new Logger(BudgetOptimizationV2Controller.name);

  constructor(
    private readonly service: BudgetOptimizationV2Service,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private getAccessToken(providedToken?: string): string {
    const token = providedToken || this.configService.get<string>('TIKTOK_ACCESS_TOKEN');
    if (!token) throw new Error('Access token is required');
    return token;
  }

  /**
   * 特定Advertiserの毎時予算調整を実行
   * POST /api/budget-optimization-v2/execute/:advertiserId
   */
  @Post('execute/:advertiserId')
  async execute(
    @Param('advertiserId') advertiserId: string,
    @Body('accessToken') accessToken?: string,
    @Body('dryRun') dryRun?: boolean,
  ) {
    this.logger.log(`[V2] Execute requested for ${advertiserId} (dryRun: ${dryRun})`);
    try {
      const token = this.getAccessToken(accessToken);
      const result = await this.service.executeHourlyOptimization(advertiserId, token, dryRun === true);
      return { success: true, data: result };
    } catch (error) {
      this.logger.error(`[V2] Execute failed for ${advertiserId}:`, error);
      throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 全対象アカウントの毎時予算調整を実行
   * POST /api/budget-optimization-v2/execute-all
   */
  @Post('execute-all')
  async executeAll(
    @Body('accessToken') accessToken?: string,
    @Body('dryRun') dryRun?: boolean,
  ) {
    this.logger.log(`[V2] Execute-all requested (dryRun: ${dryRun})`);
    try {
      const token = this.getAccessToken(accessToken);
      const result = await this.service.executeAll(token, dryRun === true);
      return { success: true, data: result };
    } catch (error) {
      this.logger.error('[V2] Execute-all failed:', error);
      throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * ドライラン（実際のAPI呼び出しなし）
   * POST /api/budget-optimization-v2/dry-run/:advertiserId
   */
  @Post('dry-run/:advertiserId')
  async dryRun(
    @Param('advertiserId') advertiserId: string,
    @Body('accessToken') accessToken?: string,
  ) {
    this.logger.log(`[V2] Dry-run requested for ${advertiserId}`);
    try {
      const token = this.getAccessToken(accessToken);
      const result = await this.service.executeHourlyOptimization(advertiserId, token, true);
      return { success: true, dryRun: true, data: result };
    } catch (error) {
      this.logger.error(`[V2] Dry-run failed for ${advertiserId}:`, error);
      throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * スナップショット閲覧
   * GET /api/budget-optimization-v2/snapshots/:advertiserId?date=YYYY-MM-DD
   */
  @Get('snapshots/:advertiserId')
  async getSnapshots(
    @Param('advertiserId') advertiserId: string,
    @Query('date') date?: string,
  ) {
    try {
      const snapshots = await this.service.getSnapshots(advertiserId, date);
      return { success: true, data: snapshots };
    } catch (error) {
      this.logger.error(`[V2] Get snapshots failed:`, error);
      throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ============================================================================
  // 予算調整除外 CRUD
  // ============================================================================

  /**
   * 除外リスト取得
   * GET /api/budget-optimization-v2/exclusions
   */
  @Get('exclusions')
  async getExclusions(
    @Query('enabled') enabled?: string,
  ) {
    try {
      const where: any = {};
      if (enabled !== undefined) {
        where.enabled = enabled === 'true';
      }
      const exclusions = await this.prisma.budgetOptimizationExclusion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });
      return { success: true, data: exclusions };
    } catch (error) {
      this.logger.error('[V2] Get exclusions failed:', error);
      throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 除外追加
   * POST /api/budget-optimization-v2/exclusions
   */
  @Post('exclusions')
  async createExclusion(
    @Body() body: {
      creativeName: string;
      advertiserId?: string;
      reason?: string;
      expiresAt?: string;
    },
  ) {
    try {
      if (!body.creativeName) {
        throw new HttpException(
          { success: false, error: 'creativeName is required' },
          HttpStatus.BAD_REQUEST,
        );
      }
      const exclusion = await this.prisma.budgetOptimizationExclusion.create({
        data: {
          creativeName: body.creativeName,
          advertiserId: body.advertiserId || null,
          reason: body.reason || null,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        },
      });
      this.logger.log(`[V2] Created exclusion: ${exclusion.creativeName} (id: ${exclusion.id})`);
      return { success: true, data: exclusion };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('[V2] Create exclusion failed:', error);
      throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 除外更新
   * PATCH /api/budget-optimization-v2/exclusions/:id
   */
  @Patch('exclusions/:id')
  async updateExclusion(
    @Param('id') id: string,
    @Body() body: {
      creativeName?: string;
      advertiserId?: string;
      reason?: string;
      enabled?: boolean;
      expiresAt?: string | null;
    },
  ) {
    try {
      const data: any = {};
      if (body.creativeName !== undefined) data.creativeName = body.creativeName;
      if (body.advertiserId !== undefined) data.advertiserId = body.advertiserId || null;
      if (body.reason !== undefined) data.reason = body.reason;
      if (body.enabled !== undefined) data.enabled = body.enabled;
      if (body.expiresAt !== undefined) {
        data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
      }
      const exclusion = await this.prisma.budgetOptimizationExclusion.update({
        where: { id },
        data,
      });
      this.logger.log(`[V2] Updated exclusion: ${exclusion.id}`);
      return { success: true, data: exclusion };
    } catch (error) {
      this.logger.error(`[V2] Update exclusion failed:`, error);
      throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 除外削除
   * DELETE /api/budget-optimization-v2/exclusions/:id
   */
  @Delete('exclusions/:id')
  async deleteExclusion(
    @Param('id') id: string,
  ) {
    try {
      await this.prisma.budgetOptimizationExclusion.delete({
        where: { id },
      });
      this.logger.log(`[V2] Deleted exclusion: ${id}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`[V2] Delete exclusion failed:`, error);
      throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
