import { Module } from '@nestjs/common';
import { CampaignBuilderController } from './campaign-builder.controller';
import { CampaignBuilderService } from './campaign-builder.service';
import { PrismaModule } from '../prisma/prisma.module';
import { TiktokModule } from '../tiktok/tiktok.module';

@Module({
  imports: [PrismaModule, TiktokModule],
  controllers: [CampaignBuilderController],
  providers: [CampaignBuilderService],
  exports: [CampaignBuilderService],
})
export class CampaignBuilderModule {}
