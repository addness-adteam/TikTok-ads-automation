import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { TiktokModule } from './tiktok/tiktok.module';
import { JobsModule } from './jobs/jobs.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AppealModule } from './appeal/appeal.module';
import { AdvertiserModule } from './advertiser/advertiser.module';
import { GoogleSheetsModule } from './google-sheets/google-sheets.module';
import { OptimizationModule } from './optimization/optimization.module';
import { CreativeModule } from './creative/creative.module';
import { CampaignBuilderModule } from './campaign-builder/campaign-builder.module';
import { PixelsModule } from './pixels/pixels.module';
import { AdTextTemplateModule } from './ad-text-template/ad-text-template.module';
import { NotificationModule } from './notification/notification.module';
import { AdPerformanceModule } from './ad-performance/ad-performance.module';
import { IntradayOptimizationModule } from './intraday-optimization/intraday-optimization.module';
import { AdCountRecordingModule } from './ad-count-recording/ad-count-recording.module';
import { BudgetOptimizationV2Module } from './budget-optimization-v2/budget-optimization-v2.module';
import { CreatorStopRateModule } from './creator-stop-rate/creator-stop-rate.module';
import { UtageModule } from './utage/utage.module';
import { CrossDeployModule } from './cross-deploy/cross-deploy.module';
import { StreamlinedCreatorModule } from './streamlined-creator/streamlined-creator.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    TiktokModule,
    JobsModule,
    DashboardModule,
    AppealModule,
    AdvertiserModule,
    GoogleSheetsModule,
    OptimizationModule,
    CreativeModule,
    CampaignBuilderModule,
    PixelsModule,
    AdTextTemplateModule,
    NotificationModule,
    AdPerformanceModule,
    IntradayOptimizationModule,
    AdCountRecordingModule,
    BudgetOptimizationV2Module,
    CreatorStopRateModule,
    UtageModule,
    CrossDeployModule,
    StreamlinedCreatorModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
