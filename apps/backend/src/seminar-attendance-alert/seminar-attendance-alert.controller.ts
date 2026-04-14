import { Controller, Post, Logger, Query, Body } from '@nestjs/common';
import { SeminarAttendanceAlertUseCase } from './application/seminar-attendance-alert.usecase';

interface RunBody {
  /** GitHub Actions側でPlaywright取得済みの着座メアド配列 */
  attendedEmails?: string[];
}

@Controller('jobs/seminar-attendance-alert')
export class SeminarAttendanceAlertController {
  private readonly logger = new Logger(SeminarAttendanceAlertController.name);

  constructor(private readonly useCase: SeminarAttendanceAlertUseCase) {}

  /**
   * POST /jobs/seminar-attendance-alert
   *   ?dryRun=true で通知・履歴保存をスキップ
   *   body.attendedEmails: GitHub Actions側で取得した着座者メアド配列（Vercelでは生のLステップ取得不可）
   */
  @Post()
  async run(@Query('dryRun') dryRun?: string, @Body() body?: RunBody) {
    this.logger.log(`seminar-attendance-alert 実行 (dryRun=${dryRun}, 着座メアド=${body?.attendedEmails?.length ?? 0}件)`);
    try {
      const attendedEmails = new Set((body?.attendedEmails ?? []).map((e) => e.trim().toLowerCase()));
      if (attendedEmails.size === 0) {
        return { success: false, error: '着座メアド未提供 (attendedEmails必須)' };
      }
      const result = await this.useCase.run({
        dryRun: dryRun === 'true',
        attendanceCsvFetcher: { fetchAttendedEmails: async () => attendedEmails },
      });
      return { success: true, result };
    } catch (e: any) {
      this.logger.error('UseCase失敗:', e.message, e.stack);
      return { success: false, error: e.message };
    }
  }
}
