import { Module, forwardRef } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { JobsController } from './jobs.controller';
import { TiktokModule } from '../tiktok/tiktok.module';
import { AdPerformanceModule } from '../ad-performance/ad-performance.module';
import { IntradayOptimizationModule } from '../intraday-optimization/intraday-optimization.module';
import { AdCountRecordingModule } from '../ad-count-recording/ad-count-recording.module';

@Module({
  imports: [
    TiktokModule,
    forwardRef(() => AdPerformanceModule),
    IntradayOptimizationModule,
    AdCountRecordingModule,
  ],
  controllers: [JobsController],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class JobsModule {}
