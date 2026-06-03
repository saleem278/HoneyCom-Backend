# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

NestJS 11 + MongoDB (Mongoose 7) backend for the HoneyCom e-commerce platform. Serves both the Next.js web frontend ([../frontend/](../frontend/)) and the React Native mobile app ([../HoneyHive/](../HoneyHive/)). Single API surface, role-driven (`customer` / `seller` / `admin` / `contentEditor`), with a mobile-specific module for device/notification concerns.

## Pre-PR checklist (MANDATORY)

Before opening or pushing to any PR, run both of these and confirm they pass:

```bash
npx tsc --noEmit   # type check (ignore pre-existing env errors about @types/node / @types/jest)
npm run build      # Nest CLI compile → dist/
```

CI will fail if the build is broken. The `npm run lint` command currently errors on this repo due to an ESLint config format mismatch (pre-existing, not introduced by our changes) — use `npx tsc --noEmit` + `npm run build` instead.

## Status

Web / mobile / backend **feature parity is complete** as of June 2026. The current focus is bug resolution. Do not add new features until the bug backlog is cleared.

## Common commands

| Task | Command |
|---|---|
| Install | `npm install` |
| Dev (watch) | `npm run start:dev` |
| Debug (watch + inspector) | `npm run start:debug` |
| Build (Nest CLI → `dist/`) | `npm run build` |
| Production start | `npm run start:prod` |
| Lint (autofix) | `npm run lint` |
| Format | `npm run format` |
| Unit tests | `npm test` |
| Single test | `npx jest path/to/file.spec.ts` or `npx jest -t "describe or it name"` |
| Coverage | `npm run test:cov` |
| E2E | `npm run test:e2e` (config in `test/jest-e2e.json`) |
| Seed DB | `npm run seed` (runs `src/seed.ts` against `MONGODB_URI`) |

Default dev port is `5000` (`process.env.PORT`). Mongo URI defaults to `mongodb://localhost:27017/honey-ecommerce`.

## Two entrypoints — pick the right one

There are **two bootstrap files** that both build the same `AppModule` but for different deploy targets. Changes to global middleware/CORS/Swagger usually need to be mirrored in both:

- [src/main.ts](src/main.ts) — long-lived Node server (used by `start`, `start:prod`, `ecosystem.config.js` PM2 cluster, the `Dockerfile`, and `render.yaml`). Serves `/uploads` static files and uses dynamic `FRONTEND_URL` (comma-separated origins) for CORS.
- [api/index.ts](api/index.ts) — Vercel serverless handler (`vercel.json` routes `/(.*)` to it). Caches the Express app between cold starts via `cachedServer`. Uses `FRONTEND_URL || '*'` for CORS and does **not** serve static uploads.

When adding a new global pipe, guard, or interceptor, add it to both files — or pull the bootstrap setup into a shared helper. There is no shared bootstrap module today.

## Architecture

### Module layout

[src/app.module.ts](src/app.module.ts) wires all feature modules. Each `src/modules/<domain>/` follows the standard Nest shape: `*.module.ts`, `*.controller.ts`, `*.service.ts`, plus `dto/`, `guards/`, `strategies/`, `decorators/` as needed. Mongoose schemas live separately under [src/models/](src/models/) and are imported via `MongooseModule.forFeature(...)` in each consumer module — there is no per-module schema folder.

Feature modules: `auth`, `users`, `products`, `cart`, `orders`, `categories`, `reviews`, `seller`, `admin`, `payments`, `cms`, `mobile`, `disputes`, `brands`, `banners`, `stores`, `settings`, `coupons`, `seed`, `health`, `trading` (no module file — bare folder, check before importing).

### Global behaviors set in `main.ts`

- Global prefix `api/` — **but** `api-docs`, `api-docs-json`, and `health` are excluded. Don't double-prefix when designing routes; controllers use bare paths and the prefix is applied globally.
- `ValidationPipe` is global with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true` — DTOs must declare every accepted field with class-validator decorators or requests will 400.
- `rawBody: true` is enabled on the Nest app — required for Stripe webhook signature verification. Don't disable it.
- Swagger UI at `/api-docs` (JSON at `/api-docs-json`). Swagger assets are loaded from a CDN — Helmet CSP allowlists `cdnjs.cloudflare.com` for that reason. JWT auth is registered as `'JWT-auth'`; controllers should annotate with `@ApiBearerAuth('JWT-auth')`.
- Throttler is global via `ThrottlerModule.forRoot` — defaults `RATE_LIMIT_WINDOW_MS=900000` (15min), `RATE_LIMIT_MAX_REQUESTS=100`.

### Auth

[src/modules/auth/](src/modules/auth/) registers JWT, Google OAuth, and Facebook OAuth strategies. JWT secret comes from `JWT_SECRET` (falls back to a literal placeholder — set this in production), `JWT_EXPIRE` defaults to `30d`. The mobile app and the web frontend hit the **same** `/auth/*` endpoints; role-routing is the client's job.

User roles in [src/models/User.model.ts](src/models/User.model.ts) are `'customer' | 'seller' | 'admin'` plus a separate `ContentEditor` model. Note the mismatch with what some clients send: web/mobile use the string `'contentEditor'` for the CMS role — keep that exact casing when adding role checks.

`emailVerified` / `phoneVerified` flags, OTP fields, and `socialLogin.{provider,providerId}` all live on `User`. `sellerInfo.approvalStatus` (`pending|approved|rejected`) gates seller account activation.

### Currency handling

Custom `@Currency()` param decorator at [src/common/decorators/currency.decorator.ts](src/common/decorators/currency.decorator.ts) reads currency from (in order): `X-Currency` header, `currency` header, `?currency=` query, `process.env.BASE_CURRENCY`, then literal `'INR'`. CORS is configured to allow `X-Currency`, `x-currency`, and `currency` headers — keep that allowlist in sync if you add casings. Both web and mobile clients send `X-Currency` on every request.

The decorator runs **before** DI, so it reads `process.env` directly rather than `ConfigService`. Don't try to inject anything into it.

### File uploads & external services

[src/services/](src/services/) holds non-feature integrations: `email.service.ts` + `email-templates.service.ts` (Nodemailer), `sms.service.ts` (Twilio), `pdf.service.ts` (PDFKit), `fileUpload.service.ts` (Cloudinary + multer), `exchange-rate.service.ts`. The dev server serves `dist/../uploads` at `/uploads`; the Vercel build does **not**, so anything that depends on local disk uploads will break under Vercel.

### TypeScript config gotcha

[tsconfig.json](tsconfig.json) sets `strictNullChecks: false` and `noImplicitAny: false`. Don't assume strict-mode safety when reading existing code — narrow types yourself in new code rather than trusting inference.

## Deploy targets

- **Render** ([render.yaml](render.yaml)): `npm install && npm run build`, runs `npm run start:prod`, port `10000`. Set Mongo/JWT/Cloudinary env vars in the Render dashboard.
- **Vercel** ([vercel.json](vercel.json)): builds `api/index.ts` with `@vercel/node`, all routes funnel into the serverless handler. Cold-start cached via `cachedServer`.
- **PM2** ([ecosystem.config.js](ecosystem.config.js)): cluster mode, `dist/main.js`, port `5000`, max 1G per worker.
- **Docker** ([Dockerfile](Dockerfile)).

## Conventions

- Controllers use the `api/` prefix implicitly — write `@Controller('products')` not `@Controller('api/products')`.
- DTOs live in `src/modules/<domain>/dto/`. Because of the global `ValidationPipe`, undeclared fields are rejected — adding a new field requires both DTO and (if persisted) schema changes.
- Mongoose schemas in [src/models/](src/models/) export both the schema and an interface (`IUser`, etc.). Use `@InjectModel('Name')` with the registered name from `MongooseModule.forFeature`, not the class.
- Webhook controllers must read the raw body (Stripe) — `rawBody: true` is on but the controller still needs to opt into it via `@Req()`.
