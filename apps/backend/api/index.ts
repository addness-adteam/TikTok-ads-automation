import { config } from 'dotenv';
config();

import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import express from 'express';

const server = express();
let app;

async function createApp() {
  if (!app) {
    app = await NestFactory.create(
      AppModule,
      new ExpressAdapter(server),
    );

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

    await app.init();
  }
  return app;
}

export default async (req, res) => {
  await createApp();
  return server(req, res);
};
