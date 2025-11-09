import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import * as express from 'express';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';

let cachedServer: express.Express;

async function createServer(): Promise<express.Express> {
  if (cachedServer) {
    return cachedServer;
  }

  const expressApp = express();
  const adapter = new ExpressAdapter(expressApp);
  
  const app = await NestFactory.create(AppModule, adapter, {
    logger: ['error', 'warn'],
  });

  // Security
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://cdnjs.cloudflare.com'],
          imgSrc: ["'self'", 'data:', 'https:'],
          fontSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
        },
      },
    })
  );
  app.use(compression());

  // CORS
  app.enableCors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  );

  // Global prefix
  app.setGlobalPrefix('api', {
    exclude: ['api-docs', 'api-docs-json'],
  });

  // Swagger Documentation
  const config = new DocumentBuilder()
    .setTitle('Honey E-Commerce Platform API')
    .setDescription('Comprehensive API documentation for Honey E-Commerce Platform')
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth'
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);

  await app.init();
  cachedServer = expressApp;
  return expressApp;
}

export default async function handler(req: express.Request, res: express.Response) {
  const server = await createServer();
  return server(req, res);
}

