import { Module } from '@nestjs/common';
import { GoogleSheetsModule } from '../google-sheets/google-sheets.module';
import { SeminarAttendanceAlertController } from './seminar-attendance-alert.controller';
import { SeminarAttendanceAlertUseCase } from './application/seminar-attendance-alert.usecase';
import { SheetsAllowableCpoResolver } from './infrastructure/allowable-cpo-resolver';
import { SheetsOptLatestPathReader } from './infrastructure/opt-latest-path-reader';
import { SheetsReservationSurveyReader } from './infrastructure/reservation-survey-reader';
import { PrismaAlertHistoryRepository } from './infrastructure/alert-history-repository';
import { AiSecretaryLineNotifier } from './infrastructure/line-notifier';
import { PlaywrightLstepScraper } from './infrastructure/lstep-scraper';

@Module({
  imports: [GoogleSheetsModule],
  controllers: [SeminarAttendanceAlertController],
  providers: [
    SeminarAttendanceAlertUseCase,
    SheetsAllowableCpoResolver,
    SheetsOptLatestPathReader,
    SheetsReservationSurveyReader,
    PrismaAlertHistoryRepository,
    AiSecretaryLineNotifier,
    PlaywrightLstepScraper,
  ],
})
export class SeminarAttendanceAlertModule {}
