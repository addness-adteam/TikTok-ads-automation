import { config } from 'dotenv';
config();

import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import * as express from 'express';

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
      origin: process.env.CORS_ORIGINS?.split(',') || '*',
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
