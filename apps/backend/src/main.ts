import { config } from 'dotenv';
config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

const logger = new Logger('Bootstrap');

// グレースフルシャットダウン用のフラグ
let isShuttingDown = false;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS設定
  app.enableCors({
    origin: (origin, callback) => {
      const allowedOrigins = process.env.CORS_ORIGINS?.split(',') || [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:3002',
      ];

      // 本番環境のドメイン
      const productionDomains = [
        'https://adsp-database.com',
        'https://www.adsp-database.com',
      ];

      // Vercelのプレビューデプロイメントも許可
      const isVercelDeploy = origin && origin.includes('.vercel.app');
      const isAllowed = !origin || allowedOrigins.includes(origin) || productionDomains.includes(origin) || isVercelDeploy;

      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  });

  // グレースフルシャットダウンを有効化
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  logger.log(`Application is running on: http://localhost:${port}`);
  logger.log(`CORS enabled for: adsp-database.com and *.vercel.app`);

  // シグナルハンドラーを設定（グレースフルシャットダウン）
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) {
      logger.warn(`[Graceful Shutdown] Already shutting down, ignoring ${signal}`);
      return;
    }
    isShuttingDown = true;

    logger.log(`[Graceful Shutdown] Received ${signal}, starting graceful shutdown...`);

    // シャットダウンタイムアウト（30秒）
    const shutdownTimeout = setTimeout(() => {
      logger.error('[Graceful Shutdown] Timeout reached, forcing shutdown');
      process.exit(1);
    }, 30000);

    try {
      // NestJSアプリケーションを停止
      await app.close();
      logger.log('[Graceful Shutdown] Application closed successfully');
      clearTimeout(shutdownTimeout);
      process.exit(0);
    } catch (error) {
      logger.error(`[Graceful Shutdown] Error during shutdown: ${error.message}`);
      clearTimeout(shutdownTimeout);
      process.exit(1);
    }
  };

  // シグナルハンドラーを登録
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // 未処理の例外をキャッチ
  process.on('uncaughtException', (error) => {
    logger.error(`[Uncaught Exception] ${error.message}`, error.stack);
    gracefulShutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error(`[Unhandled Rejection] at: ${promise}, reason: ${reason}`);
  });
}
bootstrap();
