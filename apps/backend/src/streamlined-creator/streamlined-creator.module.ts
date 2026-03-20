import { Module } from '@nestjs/common';
import { StreamlinedCreatorService } from './streamlined-creator.service';
import { StreamlinedCreatorController } from './streamlined-creator.controller';
import { GigafileService } from './gigafile.service';
import { TiktokModule } from '../tiktok/tiktok.module';
import { UtageModule } from '../utage/utage.module';

@Module({
  imports: [TiktokModule, UtageModule],
  controllers: [StreamlinedCreatorController],
  providers: [StreamlinedCreatorService, GigafileService],
  exports: [StreamlinedCreatorService],
})
export class StreamlinedCreatorModule {}
