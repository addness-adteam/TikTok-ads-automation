import { Module } from '@nestjs/common';
import { PixelsController } from './pixels.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { TiktokModule } from '../tiktok/tiktok.module';

@Module({
  imports: [PrismaModule, TiktokModule],
  controllers: [PixelsController],
})
export class PixelsModule {}
