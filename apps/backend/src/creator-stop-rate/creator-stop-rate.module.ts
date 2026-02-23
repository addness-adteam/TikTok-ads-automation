import { Module } from '@nestjs/common';
import { CreatorStopRateService } from './creator-stop-rate.service';
import { CreatorStopRateController } from './creator-stop-rate.controller';

@Module({
  controllers: [CreatorStopRateController],
  providers: [CreatorStopRateService],
  exports: [CreatorStopRateService],
})
export class CreatorStopRateModule {}
