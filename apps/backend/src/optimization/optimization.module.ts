import { Module } from '@nestjs/common';
import { OptimizationController } from './optimization.controller';
import { OptimizationService } from './optimization.service';
import { PrismaModule } from '../prisma/prisma.module';
import { TiktokModule } from '../tiktok/tiktok.module';
import { GoogleSheetsModule } from '../google-sheets/google-sheets.module';
import { AppealModule } from '../appeal/appeal.module';
import { AdPerformanceModule } from '../ad-performance/ad-performance.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    PrismaModule,
    TiktokModule,
    GoogleSheetsModule,
    AppealModule,
    AdPerformanceModule,
    NotificationModule,
  ],
  controllers: [OptimizationController],
  providers: [OptimizationService],
  exports: [OptimizationService],
})
export class OptimizationModule {}
