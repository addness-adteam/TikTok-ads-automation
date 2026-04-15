import { Controller, Post, Logger, Query } from '@nestjs/common';
import { SeminarAttendanceAlertUseCase } from './application/seminar-attendance-alert.usecase';

@Controller('jobs/seminar-attendance-alert')
export class SeminarAttendanceAlertController {
  private readonly logger = new Logger(SeminarAttendanceAlertController.name);

  constructor(private readonly useCase: SeminarAttendanceAlertUseCase) {}

  /**
   * POST /jobs/seminar-attendance-alert?dryRun=true
   * 着座LINE名は手動でスプシ(1HI8...0JM)のシート1に貼り付ける運用。
   */
  @Post()
  async run(@Query('dryRun') dryRun?: string) {
    this.logger.log(`seminar-attendance-alert 実行 (dryRun=${dryRun})`);
    try {
      const result = await this.useCase.run({ dryRun: dryRun === 'true' });
      return { success: true, result };
    } catch (e: any) {
      this.logger.error('UseCase失敗:', e.message, e.stack);
      return { success: false, error: e.message };
    }
  }
}
