/**
 * ワンストップ出稿コントローラー
 */
import { Controller, Get, Post, Body, Query, Logger } from '@nestjs/common';
import { StreamlinedCreatorService } from './streamlined-creator.service';
import { CreateSingleInput, PreviewInput } from './types';

@Controller('api/streamlined-creator')
export class StreamlinedCreatorController {
  private readonly logger = new Logger(StreamlinedCreatorController.name);

  constructor(private service: StreamlinedCreatorService) {}

  /**
   * カスタムオーディエンス一覧取得
   * GET /api/streamlined-creator/custom-audiences?advertiserId=xxx
   */
  @Get('custom-audiences')
  async getCustomAudiences(@Query('advertiserId') advertiserId: string) {
    this.logger.log(`カスタムオーディエンス取得: ${advertiserId}`);
    return this.service.getCustomAudiences(advertiserId);
  }

  /**
   * ギガファイル便プレビュー（ファイル名取得）
   * POST /api/streamlined-creator/preview
   */
  @Post('preview')
  async preview(@Body() input: PreviewInput) {
    this.logger.log(`プレビュー: ${input.gigafileUrls.length}件`);
    return this.service.preview(input);
  }

  /**
   * 1動画分の出稿実行
   * POST /api/streamlined-creator/create-single
   */
  @Post('create-single')
  async createSingle(@Body() input: CreateSingleInput) {
    this.logger.log(`ワンストップ出稿: ${input.gigafileUrl} → ${input.advertiserId}`);
    return this.service.createSingle(input);
  }
}
