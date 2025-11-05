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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
