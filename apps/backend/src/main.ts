import { config } from 'dotenv';
config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

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

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`CORS enabled for: adsp-database.com and *.vercel.app`);
}
bootstrap();
