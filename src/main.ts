import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import { join } from 'path';
import { assertRequiredEnv, configureApp } from './bootstrap';

async function bootstrap() {
  assertRequiredEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // Required for Stripe webhook signature verification
  });

  // Trust the first proxy hop so req.ip reflects the real client address,
  // not the load balancer IP. Without this, all users share one "IP" and
  // rate limiting + geo-blocking are bypassed behind Render/AWS/GCP.
  app.set('trust proxy', 1);

  // Cap request payloads at 1MB. JSON payloads for e-commerce are never
  // legitimately larger than a few KB. 5MB was unnecessarily permissive.
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));

  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads',
  });

  // Disable Swagger CDN (and unsafe-eval CSP) in production — the API
  // docs don't need to be public-facing and the CDN adds XSS surface.
  const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
  configureApp(app, { swaggerWithCdn: !isProd });

  const PORT = process.env.PORT || 5000;
  await app.listen(PORT);
}

bootstrap();
