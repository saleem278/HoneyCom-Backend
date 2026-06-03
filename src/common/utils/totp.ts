import * as crypto from 'crypto';

/**
 * RFC 6238 TOTP implementation. Built directly on Node's `crypto` so we
 * don't pull in `speakeasy` or `otplib` — the algorithm is small and
 * stable, and the deps each carry their own audit surface for what
 * amounts to ~50 lines of HMAC + base32.
 *
 * Defaults:
 *   - 30s step (industry standard, matches Google Authenticator / Authy)
 *   - 6-digit codes
 *   - HMAC-SHA1 (RFC 6238 default; SHA-256 is supported by some apps but
 *     not universally, so SHA-1 maximises compatibility)
 *
 * Verification accepts the previous and next steps as well, giving the
 * user a 90s window to type the code without rejecting them for clock
 * skew. Authy's reference implementation does the same.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const ALGO = 'sha1';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Encode raw bytes as RFC 4648 base32 (no padding). */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

/** Decode RFC 4648 base32 back to bytes. Tolerant of padding and case. */
function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Generate a fresh 20-byte random secret, returned as base32. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secret: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  // High 4 bytes are zero for any sane counter (well past year 5000).
  counterBuf.writeUInt32BE(0, 0);
  counterBuf.writeUInt32BE(counter, 4);

  const hmac = crypto.createHmac(ALGO, secret).update(counterBuf).digest();
  // Dynamic truncation per RFC 4226 §5.3.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (code % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

/**
 * Verify a 6-digit code against the secret. Accepts current ± window
 * steps to absorb clock skew (default ±1 step = ±30s).
 */
export function verifyTotp(secret: string, code: string, window = 1): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const secretBuf = base32Decode(secret);
  const now = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  for (let drift = -window; drift <= window; drift++) {
    if (hotp(secretBuf, now + drift) === code) return true;
  }
  return false;
}

/**
 * Build the otpauth:// URL the authenticator app expects to encode in a
 * QR code. The client side (web/mobile) just needs to render this as a
 * QR — they don't need to parse it.
 */
export function buildOtpauthUrl({
  secret,
  accountName,
  issuer,
}: {
  secret: string;
  accountName: string;
  issuer: string;
}): string {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: ALGO.toUpperCase(),
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  // The label format `Issuer:account` is the Google Authenticator
  // convention — apps render the issuer above the code list.
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Generate N recovery codes — printable, hyphenated for legibility.
 * Format: 4 groups of 4 alphanumerics, e.g. `7K3M-9XQR-4PWV-2NBC`.
 * The bcrypt hashes (not these strings) are what's stored in the DB.
 */
export function generateRecoveryCodes(count = 8): string[] {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Crockford-ish, no 0/O/1/I
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const groups: string[] = [];
    for (let g = 0; g < 4; g++) {
      let group = '';
      const bytes = crypto.randomBytes(4);
      for (let j = 0; j < 4; j++) {
        group += alphabet[bytes[j] % alphabet.length];
      }
      groups.push(group);
    }
    codes.push(groups.join('-'));
  }
  return codes;
}
