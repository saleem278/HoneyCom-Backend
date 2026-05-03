import type { Request } from 'express';

/**
 * The request object after JwtAuthGuard has attached the validated user.
 * The strategy's `validate()` returns `{ id, email, role }` (see jwt.strategy.ts),
 * so callers can safely read `req.user.id`.
 */
export interface AuthedRequest extends Request {
  user: {
    id: string;
    email?: string;
    role: 'customer' | 'seller' | 'admin' | 'contentEditor';
  };
}
