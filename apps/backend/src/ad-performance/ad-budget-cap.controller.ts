import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Query,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AdBudgetCapService } from './ad-budget-cap.service';

@Controller('ad-budget-caps')
export class AdBudgetCapController {
  constructor(private readonly adBudgetCapService: AdBudgetCapService) {}

  /**
   * 上限日予算一覧取得
   * GET /api/ad-budget-caps?advertiserId=xxx&enabled=true
   */
  @Get()
  async getBudgetCaps(
    @Query('advertiserId') advertiserId: string,
    @Query('enabled') enabled?: string,
  ) {
    return this.adBudgetCapService.getBudgetCaps(advertiserId, {
      enabled: enabled !== undefined ? enabled === 'true' : undefined,
    });
  }

  /**
   * 上限日予算設定
   * POST /api/ad-budget-caps
   */
  @Post()
  async createBudgetCap(
    @Body()
    body: {
      adId: string;
      advertiserId: string;
      maxDailyBudget: number;
      enabled?: boolean;
      startDate?: string;
      endDate?: string;
    },
  ) {
    return this.adBudgetCapService.createBudgetCap({
      adId: body.adId,
      advertiserId: body.advertiserId,
      maxDailyBudget: body.maxDailyBudget,
      enabled: body.enabled,
      startDate: body.startDate ? new Date(body.startDate) : undefined,
      endDate: body.endDate ? new Date(body.endDate) : undefined,
    });
  }

  /**
   * 上限日予算更新
   * PATCH /api/ad-budget-caps/:id
   */
  @Patch(':id')
  async updateBudgetCap(
    @Param('id') id: string,
    @Body()
    body: {
      maxDailyBudget?: number;
      enabled?: boolean;
      startDate?: string | null;
      endDate?: string | null;
    },
  ) {
    return this.adBudgetCapService.updateBudgetCap(id, {
      maxDailyBudget: body.maxDailyBudget,
      enabled: body.enabled,
      startDate: body.startDate ? new Date(body.startDate) : body.startDate === null ? null : undefined,
      endDate: body.endDate ? new Date(body.endDate) : body.endDate === null ? null : undefined,
    });
  }

  /**
   * 上限日予算削除
   * DELETE /api/ad-budget-caps/:id
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteBudgetCap(@Param('id') id: string) {
    await this.adBudgetCapService.deleteBudgetCap(id);
    return { success: true };
  }
}
