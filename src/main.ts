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

  // Cap request payloads at 5MB to limit DoS surface. Image/file uploads should
  // go through multer (which has its own limits) — anything routed via the JSON
  // body parser shouldn't be that large.
  app.use(json({ limit: '5mb' }));
  app.use(urlencoded({ extended: true, limit: '5mb' }));

  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads',
  });

  configureApp(app, { swaggerWithCdn: true });

  const PORT = process.env.PORT || 5000;
  await app.listen(PORT);
}

bootstrap();
