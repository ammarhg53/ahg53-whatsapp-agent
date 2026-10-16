import 'server-only';
import { sheet } from './sheets';
import { log } from './log';

// In-memory fixed-window limiter, per server instance. Used on the webhook, where a
// Sheet round trip per request would be too slow; good enough to blunt floods.
const hits = new Map<string, { window: number; count: number }>();

export function rateLimitLocal(key: string, windowSeconds: number, max: number): boolean {
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const entry = hits.get(key);
  if (!entry || entry.window !== window) {
    hits.set(key, { window, count: 1 });
    if (hits.size > 5000) for (const [k, v] of hits) if (v.window !== window) hits.delete(k);
    return true;
  }
  entry.count++;
  return entry.count <= max;
}

/** Shared limiter (Apps Script cache) for low-volume, security-sensitive endpoints such as login. */
/** Returns `onError` when the limiter can't be reached, so callers can tell "blocked" from "unavailable". */
export async function rateLimitShared<T extends boolean | null = boolean>(key: string, windowSeconds: number, max: number, onError: T): Promise<boolean | T> {
  try {
    return await sheet.call<boolean>('rate_limit', { key, window: windowSeconds, max });
  } catch (err) {
    log.warn('shared rate limit unavailable', { bucket: key.split(':')[0], error: (err as Error).message });
    return onError;
  }
}

export function clientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown';
}
