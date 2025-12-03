import { Module } from '@nestjs/common';
import { AdPerformanceService } from './ad-performance.service';
import { AdPerformanceController } from './ad-performance.controller';
import { AdBudgetCapService } from './ad-budget-cap.service';
import { AdBudgetCapController } from './ad-budget-cap.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { GoogleSheetsModule } from '../google-sheets/google-sheets.module';

@Module({
  imports: [PrismaModule, NotificationModule, GoogleSheetsModule],
  controllers: [AdPerformanceController, AdBudgetCapController],
  providers: [AdPerformanceService, AdBudgetCapService],
  exports: [AdPerformanceService, AdBudgetCapService],
})
export class AdPerformanceModule {}
