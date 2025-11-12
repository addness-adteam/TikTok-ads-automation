import { Module } from '@nestjs/common';
import { AdTextTemplateController } from './ad-text-template.controller';
import { AdTextTemplateService } from './ad-text-template.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AdTextTemplateController],
  providers: [AdTextTemplateService],
  exports: [AdTextTemplateService],
})
export class AdTextTemplateModule {}
