/**
 * Optional access gate.
 *
 * Hearth on a home network needs no login — it is a fridge, not a bank. The
 * moment it is reachable from the internet that stops being true, so setting
 * HEARTH_PIN turns on a shared household passcode.
 *
 * The session secret is derived from the passcode itself, which means there is
 * no key file to persist, sessions survive restarts and redeploys, and changing
 * the passcode signs everybody out.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'hearth_session';

const DEFAULT_MAX_AGE_DAYS = 365;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;

export function createAuth({
  pin = process.env.HEARTH_PIN,
  pepper = process.env.HEARTH_SECRET || '',
  maxAgeDays = DEFAULT_MAX_AGE_DAYS,
  now = () => Date.now(),
} = {}) {
  const passcode = typeof pin === 'string' ? pin.trim() : '';

  if (!passcode) {
    // No passcode configured: every request is allowed through, and the
    // session endpoints report that there is nothing to log in to.
    return {
      enabled: false,
      isAuthenticated: () => true,
      attempt: () => ({ ok: true }),
      cookie: () => '',
      clearCookie: () => '',
    };
  }

  const secret = createHash('sha256').update(`hearth\u0000${passcode}\u0000${pepper}`).digest();
  const maxAgeMs = maxAgeDays * 86400000;
  const attempts = new Map();

  const sign = (issuedAt) => createHmac('sha256', secret).update(String(issuedAt)).digest('hex');

  return {
    enabled: true,

    isAuthenticated(req) {
      const token = readCookie(req.headers.cookie, SESSION_COOKIE);
      if (!token) return false;
      const [issuedAt, signature] = token.split('.');
      if (!issuedAt || !signature) return false;
      const age = now() - Number(issuedAt);
      if (!Number.isFinite(age) || age < -60000 || age > maxAgeMs) return false;
      return safeEqual(signature, sign(issuedAt));
    },

    /**
     * Checks a submitted passcode. Attempts are capped per client so a short
     * numeric PIN cannot simply be guessed by a script.
     */
    attempt(candidate, clientId = 'unknown') {
      const record = attempts.get(clientId);
      const at = now();
      if (record && at < record.resetAt && record.count >= MAX_ATTEMPTS) {
        return { ok: false, retryAfterSeconds: Math.ceil((record.resetAt - at) / 1000) };
      }

      const supplied = typeof candidate === 'string' ? candidate.trim() : '';
      if (supplied && safeEqual(hash(supplied), hash(passcode))) {
        attempts.delete(clientId);
        return { ok: true };
      }

      const next = record && at < record.resetAt
        ? { count: record.count + 1, resetAt: record.resetAt }
        : { count: 1, resetAt: at + ATTEMPT_WINDOW_MS };
      attempts.set(clientId, next);

      if (next.count >= MAX_ATTEMPTS) {
        return { ok: false, retryAfterSeconds: Math.ceil((next.resetAt - at) / 1000) };
      }
      return { ok: false };
    },

    cookie({ secure }) {
      const issuedAt = now();
      const value = `${issuedAt}.${sign(issuedAt)}`;
      return serializeCookie(value, { maxAge: Math.floor(maxAgeMs / 1000), secure });
    },

    clearCookie({ secure }) {
      return serializeCookie('', { maxAge: 0, secure });
    },
  };
}

function serializeCookie(value, { maxAge, secure }) {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

function hash(value) {
  return createHash('sha256').update(value).digest();
}

function safeEqual(a, b) {
  const left = Buffer.isBuffer(a) ? a : Buffer.from(String(a));
  const right = Buffer.isBuffer(b) ? b : Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Behind a platform proxy the socket address is the proxy, not the client. */
export function clientId(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/** True when the original request reached the proxy over TLS. */
export function isSecureRequest(req) {
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string' && proto) return proto.split(',')[0].trim() === 'https';
  return Boolean(req.socket?.encrypted);
}
