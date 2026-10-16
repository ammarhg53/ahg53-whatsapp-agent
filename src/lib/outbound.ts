import 'server-only';
import { sheet } from './sheets';
import { sendRaw, payloadPreview, KapsoError, type OutboundPayload } from './kapso';
import { reserveQuota, reserveFromSnapshot, releaseQuota, type QuotaSnapshot, type SendKind } from './quota';
import { log, maskPhone } from './log';

export type Recipient = { id: string; wa_id: string };

export type SendResult =
  | { ok: true; wamid: string }
  | { ok: false; reason: 'quota' | 'error'; error?: string; code?: number };

/**
 * The single path for every outbound WhatsApp message: reserves quota, sends via
 * Kapso, then records the message and touches the contact (without waiting).
 * Pass `quota` (a snapshot) to skip the Sheet round trip before sending, or
 * `quotaReserved` when the caller already reserved quota for a whole batch.
 */
export async function send(
  to: Recipient,
  payload: OutboundPayload,
  kind: SendKind,
  opts: { campaignId?: string; quota?: QuotaSnapshot; quotaReserved?: boolean; record?: boolean } = {}
): Promise<SendResult> {
  const reserved = opts.quotaReserved || (opts.quota ? reserveFromSnapshot(opts.quota) : await reserveQuota(kind));
  if (!reserved) {
    log.warn('quota exhausted, message not sent', { to: maskPhone(to.wa_id), kind });
    return { ok: false, reason: 'quota' };
  }
  try {
    const wamid = await sendRaw(to.wa_id, payload);
    if (opts.record !== false) {
      const now = new Date().toISOString();
      void sheet.insert('messages', {
        contact_id: to.id, direction: 'outbound', wamid, type: payload.type,
        body: payloadPreview(payload).slice(0, 2000), status: 'accepted', kind, campaign_id: opts.campaignId ?? null
      }, { ignoreConflict: true });
      void sheet.update('contacts', { id: to.id }, { last_outbound_at: now });
    }
    return { ok: true, wamid };
  } catch (err) {
    void releaseQuota();
    const e = err as KapsoError;
    log.error('send failed', { to: maskPhone(to.wa_id), kind, status: e.status, code: e.code, error: e.message });
    return { ok: false, reason: 'error', error: e.message, code: e.code };
  }
}
