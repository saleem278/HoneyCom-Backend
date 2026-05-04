import type { Request } from 'express';

/**
 * The request object after JwtAuthGuard has attached the validated user.
 * The strategy's `validate()` returns `{ id, email, role }` (see jwt.strategy.ts),
 * so callers can safely read `req.user.id`.
 *
 * `impersonator` is set when the request is from an admin impersonation
 * session — `id` points to the target user (whose data the admin is
 * viewing), `impersonator` points to the admin themselves. Audit code
 * should attribute actions to `impersonator` when present so the trail
 * shows the real actor, not the persona.
 */
export interface AuthedRequest extends Request {
  user: {
    id: string;
    email?: string;
    role: 'customer' | 'seller' | 'admin' | 'contentEditor';
    impersonator?: string;
  };
}
