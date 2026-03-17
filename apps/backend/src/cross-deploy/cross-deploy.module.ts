import { Module } from '@nestjs/common';
import { CrossDeployService } from './cross-deploy.service';
import { CrossDeployController } from './cross-deploy.controller';
import { TiktokModule } from '../tiktok/tiktok.module';
import { UtageModule } from '../utage/utage.module';

@Module({
  imports: [TiktokModule, UtageModule],
  controllers: [CrossDeployController],
  providers: [CrossDeployService],
  exports: [CrossDeployService],
})
export class CrossDeployModule {}
