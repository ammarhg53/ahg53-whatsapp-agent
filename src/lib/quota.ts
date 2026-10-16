import 'server-only';
import { sheet } from './sheets';
import { getSettings } from './settings';
import { quotaMonth } from './hours.ts';

export type SendKind = 'service' | 'marketing' | 'utility' | 'ai' | 'manual' | 'alert';

/** Running count for one incoming message, so replies don't each wait for the Sheet. */
export type QuotaSnapshot = { used: number; limit: number };

async function limitFor(kind: SendKind): Promise<number> {
  const s = await getSettings();
  // Marketing may not dip into the reserve kept for customer replies.
  return kind === 'marketing' ? s.monthly_message_limit - s.service_reserve : s.monthly_message_limit;
}

/** Atomically reserve n messages from the monthly limit (one Sheet round trip). */
export async function reserveQuota(kind: SendKind, n = 1): Promise<boolean> {
  return sheet.call<boolean>('consume_quota', { month: quotaMonth(), n, limit: await limitFor(kind) });
}

/**
 * Fast path for bot replies: check against the snapshot taken when the message arrived,
 * then record the use without waiting. Can overshoot by a message or two under heavy
 * concurrency, which is fine for a self-imposed limit.
 */
export function reserveFromSnapshot(snap: QuotaSnapshot): boolean {
  if (snap.used + 1 > snap.limit) return false;
  snap.used++;
  void sheet.call('consume_quota', { month: quotaMonth(), n: 1, limit: snap.limit, force: true });
  return true;
}

export function releaseQuota(n = 1) {
  return sheet.call('release_quota', { month: quotaMonth(), n });
}

export async function quotaStatus() {
  const s = await getSettings();
  const row = await sheet.first<{ used: number }>('quota_usage', { month: quotaMonth() });
  const used = row?.used ?? 0;
  return {
    month: quotaMonth(),
    used,
    limit: s.monthly_message_limit,
    reserve: s.service_reserve,
    remaining: Math.max(s.monthly_message_limit - used, 0),
    marketingRemaining: Math.max(s.monthly_message_limit - s.service_reserve - used, 0)
  };
}
