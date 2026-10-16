import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env';

/** Verify Kapso's X-Webhook-Signature: hex HMAC-SHA256 of the raw body. */
export function verifyKapsoSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', env().KAPSO_WEBHOOK_SECRET).update(rawBody, 'utf8').digest('hex');
  const given = signature.trim().replace(/^sha256=/i, '').toLowerCase();
  if (given.length !== expected.length || !/^[0-9a-f]+$/.test(given)) return false;
  return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'));
}

/** Salted hash of a phone number for the suppression list. */
export function phoneHash(waId: string): string {
  return createHash('sha256').update(`${env().PHONE_HASH_SALT}:${waId}`).digest('hex');
}
