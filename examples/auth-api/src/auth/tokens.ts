import { createToken } from '@avijs/core';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { User } from './users.js';

export const AUTH_SECRET = createToken<string>('AUTH_SECRET');

interface Payload {
  user: User;
  /** Expiry, in seconds since the epoch. */
  exp: number;
}

/**
 * Signed, expiring tokens: base64url(payload).base64url(hmac). Enough for a demo; use a JWT
 * library or sessions in production.
 */
export class TokenService {
  static inject = [AUTH_SECRET] as const;

  constructor(private readonly secret: string) {}

  sign(user: User, ttlSeconds = 3600): string {
    const payload: Payload = { user, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.#mac(body)}`;
  }

  verify(token: string): User | undefined {
    const [body, mac] = token.split('.');
    if (!body || !mac) return undefined;
    const expected = Buffer.from(this.#mac(body));
    const given = Buffer.from(mac);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Payload;
    return payload.exp > Date.now() / 1000 ? payload.user : undefined;
  }

  #mac(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }
}
