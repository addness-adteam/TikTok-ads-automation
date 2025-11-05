import { Module } from '@nestjs/common';
import { AdvertiserController } from './advertiser.controller';
import { AdvertiserService } from './advertiser.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AdvertiserController],
  providers: [AdvertiserService],
  exports: [AdvertiserService],
})
export class AdvertiserModule {}
