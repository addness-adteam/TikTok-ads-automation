import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UtageService } from './utage.service';

@Module({
  imports: [ConfigModule],
  providers: [UtageService],
  exports: [UtageService],
})
export class UtageModule {}
