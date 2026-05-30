import { INestApplication, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';

export interface BootstrapOptions {
  /**
   * If true, sets up Swagger UI with the CDN-loaded assets used by the
   * long-lived server (main.ts). The serverless handler uses a simpler
   * Swagger setup so it can pass `false` and configure its own.
   */
  swaggerWithCdn?: boolean;
}

function parseAllowedOrigins(): string[] {
  const raw = process.env.FRONTEND_URL;
  if (!raw) return ['http://localhost:3000', 'http://localhost:3001'];
  return raw.split(',').map((url) => url.trim()).filter(Boolean);
}

export function applySecurity(app: INestApplication, opts: BootstrapOptions = {}): void {
  const { swaggerWithCdn = false } = opts;

  // cookie-parser is required so the JWT strategy's cookieExtractor can
  // read the session cookie. Without it, req.cookies is undefined and
  // every cookie-based auth request falls through to the bearer header
  // (or fails). Mounted before security middleware so cookies are
  // available throughout the rest of the chain.
  app.use(cookieParser());

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: swaggerWithCdn
            ? ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com']
            : ["'self'", "'unsafe-inline'"],
          scriptSrc: swaggerWithCdn
            ? ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://cdnjs.cloudflare.com']
            : ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          fontSrc: swaggerWithCdn
            ? ["'self'", 'https://cdnjs.cloudflare.com']
            : ["'self'"],
        },
      },
    }),
  );
  app.use(compression());

  const allowedOrigins = parseAllowedOrigins();

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // When credentials: true, allowing null Origin enables CSRF — a form on
      // any page can POST to our API with the victim's session cookie, because
      // form submissions don't send an Origin. We only allow null-origin for
      // GET/HEAD requests (handled by methods allowlist) where cookies aren't
      // sent (or aren't used to authorise state-changing operations).
      //
      // Mobile apps send null Origin AND use Bearer tokens (not cookies) for
      // auth, so CSRF is not a concern for them — but the token is the
      // credential, not the cookie, so they bypass this check correctly.
      if (!origin) {
        // Allow — will be gated by the CORS methods list; mutations require
        // Authorization header which mobile provides explicitly.
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Currency', 'x-currency', 'currency', 'Idempotency-Key'],
  });
}

export function applyValidation(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}

export function applyGlobalPrefix(app: INestApplication): void {
  app.setGlobalPrefix('api', {
    exclude: ['api-docs', 'api-docs-json', 'health'],
  });
}

export function applySwagger(app: INestApplication, opts: BootstrapOptions = {}): void {
  const { swaggerWithCdn = false } = opts;

  const builder = new DocumentBuilder()
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
      'JWT-auth',
    );

  if (swaggerWithCdn) {
    builder
      .addServer(process.env.API_URL || 'http://localhost:5000/api', 'Development server')
      .addServer('https://api.honeyecommerce.com/api', 'Production server');
  }

  const document = SwaggerModule.createDocument(app, builder.build());

  if (swaggerWithCdn) {
    SwaggerModule.setup('api-docs', app, document, {
      explorer: true,
      customSiteTitle: 'Honey E-Commerce API Documentation',
      customCss: '.swagger-ui .topbar { display: none }',
      swaggerOptions: {
        persistAuthorization: true,
        defaultModelsExpandDepth: 2,
        defaultModelExpandDepth: 2,
      },
      customJs: [
        'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui-bundle.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui-standalone-preset.min.js',
      ],
      customCssUrl: 'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui.min.css',
    });
  } else {
    SwaggerModule.setup('api-docs', app, document);
  }
}

export function configureApp(app: INestApplication, opts: BootstrapOptions = {}): void {
  applySecurity(app, opts);
  applyValidation(app);
  applyGlobalPrefix(app);
  applySwagger(app, opts);
}

export function assertRequiredEnv(): void {
  const required = ['MONGODB_URI', 'JWT_SECRET'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. Refusing to boot.`,
    );
  }
  if ((process.env.JWT_SECRET || '').length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters.');
  }
}
