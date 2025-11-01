import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { TiktokModule } from '../tiktok/tiktok.module';

@Module({
  imports: [TiktokModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
