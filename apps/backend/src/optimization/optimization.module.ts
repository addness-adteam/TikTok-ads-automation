import { Module } from '@nestjs/common';
import { OptimizationController } from './optimization.controller';
import { OptimizationService } from './optimization.service';
import { PrismaModule } from '../prisma/prisma.module';
import { TiktokModule } from '../tiktok/tiktok.module';
import { GoogleSheetsModule } from '../google-sheets/google-sheets.module';
import { AppealModule } from '../appeal/appeal.module';

@Module({
  imports: [PrismaModule, TiktokModule, GoogleSheetsModule, AppealModule],
  controllers: [OptimizationController],
  providers: [OptimizationService],
  exports: [OptimizationService],
})
export class OptimizationModule {}
