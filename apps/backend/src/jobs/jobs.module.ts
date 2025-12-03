import { Module, forwardRef } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { JobsController } from './jobs.controller';
import { TiktokModule } from '../tiktok/tiktok.module';
import { AdPerformanceModule } from '../ad-performance/ad-performance.module';

@Module({
  imports: [TiktokModule, forwardRef(() => AdPerformanceModule)],
  controllers: [JobsController],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class JobsModule {}
