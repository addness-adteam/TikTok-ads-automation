import { Module } from '@nestjs/common';
import { BudgetMonitoringController } from './budget-monitoring.controller';
import { BudgetMonitoringService } from './budget-monitoring.service';
import { TiktokModule } from '../tiktok/tiktok.module';

@Module({
  imports: [TiktokModule],
  controllers: [BudgetMonitoringController],
  providers: [BudgetMonitoringService],
  exports: [BudgetMonitoringService],
})
export class BudgetMonitoringModule {}
