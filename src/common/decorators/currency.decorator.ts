import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Custom decorator to extract currency from request headers
 * Falls back to query parameter, then defaults to BASE_CURRENCY env var or INR
 * 
 * Note: For accessing ConfigService in decorators, we use process.env directly
 * as decorators are executed before dependency injection
 */
// Supported currencies — must stay in sync with ExchangeRateService.
const VALID_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'JPY']);

export const Currency = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const defaultCurrency = (process.env.BASE_CURRENCY || 'INR').toUpperCase();

    // Priority: X-Currency header > currency header > query param > env default
    const raw =
      request.headers['x-currency'] ||
      request.headers['currency'] ||
      request.query?.currency ||
      defaultCurrency;

    // Validate: only accept short strings that are in the allowlist.
    // Rejects injection attempts, unknown currencies, and oversized values.
    const candidate = typeof raw === 'string' ? raw.trim().toUpperCase().slice(0, 10) : '';
    const finalCurrency = VALID_CURRENCIES.has(candidate) ? candidate : defaultCurrency;

    return finalCurrency;
  },
);

