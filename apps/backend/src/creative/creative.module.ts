import { Module } from '@nestjs/common';
import { CreativeController } from './creative.controller';
import { CreativeService } from './creative.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CreativeController],
  providers: [CreativeService],
  exports: [CreativeService],
})
export class CreativeModule {}
