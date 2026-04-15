/**
 * 横展開コントローラー
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Logger,
} from '@nestjs/common';
import { CrossDeployService } from './cross-deploy.service';
import { CrossDeployInput } from './types';

@Controller('api/cross-deploy')
export class CrossDeployController {
  private readonly logger = new Logger(CrossDeployController.name);

  constructor(private crossDeployService: CrossDeployService) {}

  /**
   * 元広告のプレビュー
   * GET /api/cross-deploy/preview?sourceAdvertiserId=xxx&sourceAdId=yyy
   */
  @Get('preview')
  async preview(
    @Query('sourceAdvertiserId') sourceAdvertiserId: string,
    @Query('sourceAdId') sourceAdId: string,
  ) {
    this.logger.log(`Preview request: ${sourceAdvertiserId} / ${sourceAdId}`);
    return this.crossDeployService.preview(sourceAdvertiserId, sourceAdId);
  }

  /**
   * 横展開実行
   * POST /api/cross-deploy/deploy
   */
  @Post('deploy')
  async deploy(@Body() input: CrossDeployInput) {
    this.logger.log(
      `Deploy request: ${input.sourceAdId} → ${input.targetAdvertiserIds.join(', ')}`,
    );
    return this.crossDeployService.crossDeploy({ ...input, dryRun: false });
  }

  /**
   * ドライラン（動画アップロードまで実行、広告作成はスキップ）
   * POST /api/cross-deploy/dry-run
   */
  @Post('dry-run')
  async dryRun(@Body() input: CrossDeployInput) {
    this.logger.log(
      `Dry-run request: ${input.sourceAdId} → ${input.targetAdvertiserIds.join(', ')}`,
    );
    return this.crossDeployService.crossDeploy({ ...input, dryRun: true });
  }

  /**
   * 途中失敗からの再開
   * POST /api/cross-deploy/resume/:logId
   */
  @Post('resume/:logId')
  async resume(@Param('logId') logId: string) {
    this.logger.log(`Resume request: logId=${logId}`);
    return this.crossDeployService.resumeFailedDeploy(logId);
  }
}
