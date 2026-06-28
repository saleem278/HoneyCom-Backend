# Dayam — Backend API

NestJS 11 + MongoDB (Mongoose 7) backend serving the Dayam e-commerce platform. Single API surface for the Next.js web frontend and the React Native mobile app.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS 11 |
| Database | MongoDB via Mongoose 7 |
| Auth | JWT + Google OAuth + Facebook OAuth |
| File uploads | Cloudinary + Multer |
| Email | Nodemailer |
| SMS | Twilio |
| PDF | PDFKit |
| Payments | Stripe (webhook-ready, `rawBody: true`) |
| Validation | class-validator + class-transformer (global `ValidationPipe`) |

## Roles

`customer` · `seller` · `admin` · `contentEditor`

## API

- Global prefix: `api/` (except `health`, `api-docs`, `api-docs-json`)
- Swagger UI: `http://localhost:5000/api-docs`
- Rate limiting: 100 requests / 15 min (global throttler)
- Currency: `X-Currency` header → `?currency=` query → `BASE_CURRENCY` env → `INR`

## Modules

`auth` · `users` · `products` · `cart` · `orders` · `categories` · `reviews` · `seller` · `admin` · `payments` · `cms` · `mobile` · `disputes` · `brands` · `banners` · `stores` · `settings` · `coupons` · `flash-sales` · `payouts` · `alerts` · `seed` · `health`

## Getting Started

```bash
npm install
cp .env.example .env   # set MONGODB_URI, JWT_SECRET, etc.
npm run start:dev      # http://localhost:5000
```

## Key Commands

| Task | Command |
|---|---|
| Dev (watch) | `npm run start:dev` |
| Build | `npm run build` |
| Production | `npm run start:prod` |
| Type check | `npx tsc --noEmit` |
| Tests | `npm test` |
| Seed DB | `npm run seed` |

## Environment Variables

```
MONGODB_URI=mongodb://localhost:27017/honey-ecommerce
JWT_SECRET=your-secret
JWT_EXPIRE=30d
PORT=5000
FRONTEND_URL=http://localhost:3000
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
STRIPE_SECRET_KEY=
BASE_CURRENCY=INR
```

## Deploy Targets

| Target | Config |
|---|---|
| **Render** | `render.yaml` — `npm run build && npm run start:prod`, port 10000 |
| **Vercel** | `vercel.json` — serverless via `api/index.ts` |
| **PM2** | `ecosystem.config.js` — cluster mode, port 5000 |
| **Docker** | `Dockerfile` |

## Notes

- Two bootstrap files: `src/main.ts` (long-lived server) and `api/index.ts` (Vercel serverless) — global pipes/middleware must be added to both
- `strictNullChecks: false` in tsconfig — narrow types yourself in new code
- DTOs use `whitelist: true` — undeclared fields are rejected at the global `ValidationPipe`
- Stripe webhooks need raw body — `rawBody: true` is set on the Nest app
