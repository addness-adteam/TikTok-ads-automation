import { Module } from '@nestjs/common';
import { AdCountRecordingService } from './ad-count-recording.service';
import { GoogleSheetsModule } from '../google-sheets/google-sheets.module';

@Module({
  imports: [GoogleSheetsModule],
  providers: [AdCountRecordingService],
  exports: [AdCountRecordingService],
})
export class AdCountRecordingModule {}
