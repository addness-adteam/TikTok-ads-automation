import { Module } from '@nestjs/common';
import { BudgetOptimizationV2Controller } from './budget-optimization-v2.controller';
import { BudgetOptimizationV2Service } from './budget-optimization-v2.service';
import { TiktokModule } from '../tiktok/tiktok.module';
import { GoogleSheetsModule } from '../google-sheets/google-sheets.module';
import { AppealModule } from '../appeal/appeal.module';
import { AdPerformanceModule } from '../ad-performance/ad-performance.module';

@Module({
  imports: [
    TiktokModule,
    GoogleSheetsModule,
    AppealModule,
    AdPerformanceModule,
  ],
  controllers: [BudgetOptimizationV2Controller],
  providers: [BudgetOptimizationV2Service],
  exports: [BudgetOptimizationV2Service],
})
export class BudgetOptimizationV2Module {}
