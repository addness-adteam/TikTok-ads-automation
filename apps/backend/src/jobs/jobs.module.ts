import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { JobsController } from './jobs.controller';
import { TiktokModule } from '../tiktok/tiktok.module';

@Module({
  imports: [TiktokModule],
  controllers: [JobsController],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class JobsModule {}
