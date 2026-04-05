/**
 * メトリクス同期を手動実行
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './apps/backend/src/app.module.js';
import { SchedulerService } from './apps/backend/src/jobs/scheduler.service.js';

async function runMetricsSync() {
  console.log('========================================');
  console.log('メトリクス同期を手動実行');
  console.log('========================================\n');

  try {
    // NestJSアプリケーションを起動
    const app = await NestFactory.createApplicationContext(AppModule);

    // SchedulerServiceを取得
    const schedulerService = app.get(SchedulerService);

    console.log('✓ アプリケーションコンテキストを起動しました\n');
    console.log('メトリクス同期を開始します...\n');

    // メトリクス同期を実行
    await schedulerService.scheduleDailyReportFetch();

    console.log('\n✓ メトリクス同期が完了しました\n');

    // アプリケーションを終了
    await app.close();

    console.log('次のステップ:');
    console.log('1. AI1のSmart+広告のメトリクスを確認');
    console.log('2. 支出額が正しいことを確認（約¥98,818）');

  } catch (error) {
    console.error('❌ エラーが発生しました:', error);
    process.exit(1);
  }
}

runMetricsSync();
