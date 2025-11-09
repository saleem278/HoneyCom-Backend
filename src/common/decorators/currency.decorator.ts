import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Custom decorator to extract currency from request headers
 * Falls back to query parameter, then defaults to BASE_CURRENCY env var or INR
 * 
 * Note: For accessing ConfigService in decorators, we use process.env directly
 * as decorators are executed before dependency injection
 */
export const Currency = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    
    // Get default currency from environment variable
    // Using process.env directly since decorators execute before DI
    const defaultCurrency = (process.env.BASE_CURRENCY || 'INR').toUpperCase();
    
    // Priority: Header > Query > Env Default > INR
    const currency = 
      request.headers['x-currency'] || 
      request.headers['currency'] || 
      request.query?.currency || 
      defaultCurrency;
    
    const finalCurrency = (currency as string).toUpperCase();
    
    return finalCurrency;
  },
);

