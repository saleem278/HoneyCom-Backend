import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import express from 'express';
import { json, urlencoded } from 'express';
import { assertRequiredEnv, configureApp } from '../src/bootstrap';

let cachedServer: express.Express;

async function createServer(): Promise<express.Express> {
  if (cachedServer) {
    return cachedServer;
  }

  assertRequiredEnv();

  const expressApp = express();
  const adapter = new ExpressAdapter(expressApp);

  const app = await NestFactory.create(AppModule, adapter, {
    logger: ['error', 'warn'],
    rawBody: true, // Required for Stripe webhook signature verification
  });

  // Match main.ts: cap JSON/urlencoded bodies at 5MB.
  app.use(json({ limit: '5mb' }));
  app.use(urlencoded({ extended: true, limit: '5mb' }));

  configureApp(app, { swaggerWithCdn: false });

  await app.init();
  cachedServer = expressApp;
  return expressApp;
}

export default async function handler(req: express.Request, res: express.Response) {
  const server = await createServer();
  return server(req, res);
}
