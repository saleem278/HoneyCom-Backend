import type { CookieOptions } from 'express';

/**
 * Canonical cookie options for the auth session cookie. Centralised so
 * every callsite (login, register, social-login, phone-verify, 2FA-verify,
 * impersonation start/end, logout clearCookie) stays in lock-step — drift
 * between them caused the "logged in but cookie not sent on XHR" 401
 * loop after the cookie-only auth migration shipped.
 *
 * The critical bit: in production the frontend (Vercel) and backend
 * (Render) live on different sites. A cross-site XHR with
 * `SameSite=Lax` does NOT send cookies, only top-level navigations do.
 * That's why /auth/login set the cookie successfully but the very next
 * /admin/dashboard call came back unauthenticated. The cure is
 * `SameSite=None; Secure` in prod.
 *
 * Dev still uses `Lax` since same-origin localhost works fine with it
 * and `Secure: true` would block the cookie over plain http.
 *
 * `clearCookie` *must* mirror the same options or the browser keeps the
 * original cookie. Use `clearCookieOptions()` for that path.
 */

export function sessionCookieOptions(maxAgeMs: number): CookieOptions {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    // SameSite=None requires Secure=true (browser rule). In dev we keep
    // Lax + Secure=false so cookies work over plain http://localhost.
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: maxAgeMs,
    path: '/',
  };
}

export function clearSessionCookieOptions(): CookieOptions {
  // The browser only deletes a cookie when clearCookie's options match
  // those on Set-Cookie. Mirror sameSite/secure exactly.
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
  };
}

/**
 * Parse JWT_EXPIRE strings like "30d", "12h", "60m", "30s" into ms.
 * Falls back to 30 days for anything we can't parse so a misconfigured
 * env var doesn't yield a 0-second cookie.
 */
export function parseExpiryToMs(raw: string | undefined): number {
  const fallback = 30 * 24 * 60 * 60 * 1000;
  if (!raw) return fallback;
  const match = /^(\d+)\s*([dhms])$/.exec(raw.trim());
  if (!match) return fallback;
  const n = parseInt(match[1], 10);
  switch (match[2]) {
    case 'd': return n * 86_400_000;
    case 'h': return n * 3_600_000;
    case 'm': return n * 60_000;
    case 's': return n * 1000;
    default: return fallback;
  }
}
