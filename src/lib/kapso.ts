import 'server-only';
import { env } from './env';

export class KapsoError extends Error {
  constructor(message: string, public status: number, public code?: number) {
    super(message);
  }
}

function proxyUrl(path: string) {
  const e = env();
  return `${e.KAPSO_API_BASE_URL.replace(/\/+$/, '')}/meta/whatsapp/${e.META_GRAPH_VERSION}/${path.replace(/^\/+/, '')}`;
}

/** Call the Kapso Meta proxy. Never follows redirects; never logs the API key. */
export async function kapsoFetch<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string> } = {}
): Promise<T> {
  const url = new URL(proxyUrl(path));
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: { 'X-API-Key': env().KAPSO_API_KEY, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store'
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = data?.error ?? {};
    const message = String(err.message ?? err.error_user_msg ?? `Kapso HTTP ${res.status}`).slice(0, 300);
    throw new KapsoError(message, res.status, err.code);
  }
  return data as T;
}

/**
 * Ask Kapso to permanently erase a contact and its conversations/messages/media
 * (queued asynchronously). A 404 means Kapso holds nothing for this number.
 */
export async function eraseKapsoContact(waId: string): Promise<boolean> {
  const e = env();
  const url = `${e.KAPSO_API_BASE_URL.replace(/\/+$/, '')}/platform/v1/whatsapp/contacts/${encodeURIComponent(`+${waId}`)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'X-API-Key': e.KAPSO_API_KEY },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store'
  });
  return res.status === 204 || res.status === 404;
}

export type OutboundPayload =
  | { type: 'text'; text: { body: string; preview_url?: boolean } }
  | { type: 'image'; image: { link: string; caption?: string } }
  | { type: 'interactive'; interactive: Record<string, unknown> }
  | { type: 'template'; template: { name: string; language: { code: string }; components?: unknown[] } };

/** Send one message to a WhatsApp number (digits only). Returns the wamid. */
export async function sendRaw(to: string, payload: OutboundPayload): Promise<string> {
  const res = await kapsoFetch<{ messages?: { id: string }[] }>(`${env().KAPSO_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    body: { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload }
  });
  const id = res?.messages?.[0]?.id;
  if (!id) throw new KapsoError('No message id in Kapso response', 502);
  return id;
}

// ---------------------------------------------------------------- payload builders
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export type Row = { id: string; title: string; description?: string };

export const build = {
  text: (body: string): OutboundPayload => ({ type: 'text', text: { body: clip(body, 4096), preview_url: false } }),

  image: (link: string, caption?: string): OutboundPayload => ({
    type: 'image',
    image: { link, ...(caption ? { caption: clip(caption, 1024) } : {}) }
  }),

  buttons: (body: string, buttons: { id: string; title: string }[], footer?: string): OutboundPayload => ({
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: clip(body, 1024) },
      ...(footer ? { footer: { text: clip(footer, 60) } } : {}),
      action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: clip(b.title, 20) } })) }
    }
  }),

  list: (body: string, button: string, rows: Row[], footer?: string): OutboundPayload => ({
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: clip(body, 1024) },
      ...(footer ? { footer: { text: clip(footer, 60) } } : {}),
      action: {
        button: clip(button, 20),
        sections: [
          {
            title: 'Options',
            rows: rows.slice(0, 10).map((r) => ({
              id: r.id,
              title: clip(r.title, 24),
              ...(r.description ? { description: clip(r.description, 72) } : {})
            }))
          }
        ]
      }
    }
  }),

  ctaUrl: (body: string, displayText: string, url: string, footer?: string): OutboundPayload => ({
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      body: { text: clip(body, 1024) },
      ...(footer ? { footer: { text: clip(footer, 60) } } : {}),
      action: { name: 'cta_url', parameters: { display_text: clip(displayText, 20), url } }
    }
  }),

  template: (name: string, languageCode: string, components: unknown[]): OutboundPayload => ({
    type: 'template',
    template: { name, language: { code: languageCode }, ...(components.length ? { components } : {}) }
  })
};

/** Text preview of an outbound payload, stored in our messages table. */
export function payloadPreview(p: OutboundPayload): string {
  switch (p.type) {
    case 'text':
      return p.text.body;
    case 'image':
      return `[image] ${p.image.caption ?? ''}`.trim();
    case 'template':
      return `[template ${p.template.name}/${p.template.language.code}]`;
    case 'interactive': {
      const body = (p.interactive.body as { text?: string } | undefined)?.text ?? '';
      return `[${String(p.interactive.type)}] ${body}`;
    }
  }
}
