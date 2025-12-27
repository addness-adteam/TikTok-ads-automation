import { Module } from '@nestjs/common';
import { IntradayOptimizationService } from './intraday-optimization.service';
import { PrismaModule } from '../prisma/prisma.module';
import { TiktokModule } from '../tiktok/tiktok.module';
import { GoogleSheetsModule } from '../google-sheets/google-sheets.module';
import { AppealModule } from '../appeal/appeal.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    PrismaModule,
    TiktokModule,
    GoogleSheetsModule,
    AppealModule,
    NotificationModule,
  ],
  providers: [IntradayOptimizationService],
  exports: [IntradayOptimizationService],
})
export class IntradayOptimizationModule {}
