import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TiktokService } from './tiktok.service';
import { TiktokController } from './tiktok.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [ConfigModule],
  controllers: [TiktokController],
  providers: [TiktokService, PrismaService],
  exports: [TiktokService],
})
export class TiktokModule {}
