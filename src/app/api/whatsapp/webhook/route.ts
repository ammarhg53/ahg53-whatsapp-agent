import { NextResponse, after, type NextRequest } from 'next/server';
import { verifyKapsoSignature } from '@/lib/crypto';
import { rateLimitLocal, clientIp } from '@/lib/ratelimit';
import { sheet } from '@/lib/sheets';
import { handleInbound } from '@/lib/bot';
import { cleanText, normalizeWaId } from '@/lib/sanitize';
import { log, maskPhone } from '@/lib/log';
import type { InboundMessage } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BODY = 512 * 1024;

type KapsoEvent = { event?: string; message?: any; conversation?: any; phone_number_id?: string };

function toInbound(evt: KapsoEvent): InboundMessage | null {
  const m = evt.message;
  const waId = normalizeWaId(evt.conversation?.phone_number ?? m?.from);
  if (!m?.id || !waId) return null;
  let text = '';
  let replyId = '';
  switch (m.type) {
    case 'text':
      text = m.text?.body ?? '';
      break;
    case 'interactive': {
      const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
      text = r?.title ?? '';
      replyId = r?.id ?? '';
      break;
    }
    case 'button':
      text = m.button?.text ?? '';
      break;
    default:
      text = m.kapso?.content ?? `[${m.type}]`;
  }
  return {
    waId,
    profileName: cleanText(evt.conversation?.kapso?.contact_name ?? '', 60),
    wamid: String(m.id).slice(0, 200),
    type: String(m.type ?? 'unknown').slice(0, 30),
    text: cleanText(text, 1000),
    replyId: /^[a-z0-9_]{1,64}$/.test(replyId) ? replyId : ''
  };
}

async function handleStatus(event: string, evt: KapsoEvent) {
  const wamid = evt.message?.id;
  if (!wamid) return;
  const status = event.replace('whatsapp.message.', '');
  const now = new Date().toISOString();
  void sheet.update('messages', { wamid }, { status });
  if (status === 'delivered') {
    void sheet.update('campaign_recipients', { wamid, delivered_at: null }, { delivered_at: now });
  } else if (status === 'read') {
    void sheet.update('campaign_recipients', { wamid, read_at: null }, { read_at: now });
    void sheet.update('campaign_recipients', { wamid, delivered_at: null }, { delivered_at: now });
  } else if (status === 'failed') {
    const err = evt.message?.kapso?.statuses?.at?.(-1)?.errors?.[0];
    void sheet.update('campaign_recipients', { wamid }, { status: 'failed', error: String(err?.title ?? 'failed').slice(0, 200) });
  }
}

async function processEvent(event: string, evt: KapsoEvent) {
  if (event === 'whatsapp.message.received') {
    const msg = toInbound(evt);
    if (!msg) return log.warn('unparseable inbound message');
    if (!rateLimitLocal(`wa:${msg.waId}`, 60, 20)) return log.warn('per-sender rate limit hit', { from: maskPhone(msg.waId) });
    await handleInbound(msg);
  } else if (/^whatsapp\.message\.(sent|delivered|read|failed)$/.test(event)) {
    await handleStatus(event, evt);
  }
}

export async function POST(req: NextRequest) {
  if (!rateLimitLocal(`webhook:${clientIp(req.headers)}`, 60, 600)) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: 'too large' }, { status: 413 });
  if (!verifyKapsoSignature(raw, req.headers.get('x-webhook-signature'))) {
    log.warn('webhook signature rejected');
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const idem = req.headers.get('x-idempotency-key')?.slice(0, 200);
  const headerEvent = req.headers.get('x-webhook-event') ?? '';
  const items: KapsoEvent[] = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : Array.isArray(body?.events) ? body.events : [body];

  // Answer Kapso within its 10s window; do the work after the response.
  after(async () => {
    // Kapso retries deliveries; skip ones already handled (inbound messages are also deduped by wamid).
    if (idem && (await sheet.call<boolean>('seen', { key: idem, ttl: 21600 }).catch(() => false))) return;
    for (const item of items.slice(0, 100)) {
      try {
        await processEvent(item.event ?? headerEvent, item);
      } catch (err) {
        log.error('webhook event failed', { event: item.event ?? headerEvent, error: (err as Error).message });
      }
    }
    await sheet.drain();
  });

  return NextResponse.json({ ok: true });
}
