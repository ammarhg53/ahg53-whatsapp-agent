import 'server-only';
import { sheet } from './sheets';
import { env } from './env';
import { kapsoFetch, build } from './kapso';
import { send, type SendResult } from './outbound';
import type { SendKind } from './quota';
import type { Contact } from './types';

export type TemplateRow = {
  id: string;
  name: string;
  language: string;
  category: string | null;
  status: string | null;
  components: any[];
  params: string[];
  has_url_var: boolean;
};

type MetaTemplate = { id: string; name: string; language: string; category: string; status: string; components: any[] };

/** Named {{params}} used in a template's header and body, in order. */
export function extractParams(components: any[]): string[] {
  const names: string[] = [];
  for (const c of components ?? []) {
    if ((c.type === 'HEADER' || c.type === 'BODY') && typeof c.text === 'string') {
      for (const m of c.text.matchAll(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/g)) if (!names.includes(m[1])) names.push(m[1]);
    }
  }
  return names;
}

function urlButtonIndex(components: any[]): number {
  const buttons = components?.find((c) => c.type === 'BUTTONS')?.buttons ?? [];
  return buttons.findIndex((b: any) => b.type === 'URL' && /\{\{1\}\}/.test(b.url ?? ''));
}

/** Pull every template on the WABA from Meta (via Kapso) into our table. */
export async function syncTemplates(): Promise<number> {
  let after: string | undefined;
  let count = 0;
  do {
    const page = await kapsoFetch<{ data: MetaTemplate[]; paging?: { cursors?: { after?: string }; next?: string } }>(
      `${env().KAPSO_WABA_ID}/message_templates`,
      { query: { limit: '100', fields: 'id,name,language,category,status,components', ...(after ? { after } : {}) } }
    );
    const rows = (page.data ?? []).map((t) => ({
      meta_id: t.id,
      name: t.name,
      language: t.language,
      category: t.category,
      status: t.status,
      components: t.components ?? [],
      params: extractParams(t.components),
      has_url_var: urlButtonIndex(t.components) >= 0,
      synced_at: new Date().toISOString()
    }));
    await Promise.all(rows.map((r) => sheet.upsert('templates', r, ['name', 'language'])));
    count += rows.length;
    after = page.paging?.next ? page.paging?.cursors?.after : undefined;
  } while (after);
  approvedCache = null;
  return count;
}

let approvedCache: { at: number; rows: TemplateRow[] } | null = null;

/** All approved templates, cached for a minute (campaigns look one up per recipient). */
export async function approvedTemplates(): Promise<TemplateRow[]> {
  if (approvedCache && Date.now() - approvedCache.at < 60_000) return approvedCache.rows;
  const rows = await sheet.find<TemplateRow>('templates', { status: 'APPROVED' });
  approvedCache = { at: Date.now(), rows };
  return rows;
}

/** Approved template in the contact's language, falling back to English. */
export async function pickTemplate(name: string, lang: Contact['lang']): Promise<TemplateRow | null> {
  const rows = (await approvedTemplates()).filter((r) => r.name === name);
  const order = lang === 'hinglish' ? ['hi', 'en', 'en_US', 'en_GB'] : ['en', 'en_US', 'en_GB', 'hi'];
  for (const code of order) {
    const hit = rows.find((r) => r.language === code);
    if (hit) return hit;
  }
  return rows[0] ?? null;
}

export type HeaderImage = { id?: string; link?: string };

export type TemplateContext = {
  contact: Pick<Contact, 'name' | 'country' | 'business_name'>;
  service?: string | null;
  fixed?: Record<string, string>;
  trackCode?: string;
  image?: HeaderImage;
};

/** Does this template start with a picture (IMAGE header)? */
export function needsImage(tpl: Pick<TemplateRow, 'components'>): boolean {
  return (tpl.components ?? []).some((c) => c.type === 'HEADER' && c.format === 'IMAGE');
}

/** Image chosen for a campaign / send, kept inside its params as _image_id or _image_link. */
export function imageFromParams(params: Record<string, string> | null | undefined): HeaderImage | undefined {
  if (params?._image_id) return { id: params._image_id };
  if (params?._image_link) return { link: params._image_link };
  return undefined;
}

/** Meta rejects parameters with newlines, tabs or 4+ spaces. */
const paramText = (s: string) => s.replace(/[\r\n\t]+/g, ' · ').replace(/ {4,}/g, '   ').trim().slice(0, 900) || '-';

export function resolveParam(name: string, ctx: TemplateContext): string {
  if (ctx.fixed?.[name]) return ctx.fixed[name];
  switch (name) {
    case 'customer_name': return ctx.contact.name?.split(' ')[0] || 'there';
    case 'country': return ctx.contact.country || 'your country';
    case 'business_name': return ctx.contact.business_name || 'your business';
    case 'service': return ctx.service || 'your project';
    default: return '-';
  }
}

/** Send-time components for a template row, filled from the contact and fixed values. */
export function templateComponents(tpl: TemplateRow, ctx: TemplateContext): unknown[] {
  const components: unknown[] = [];
  if (needsImage(tpl) && ctx.image) {
    components.push({ type: 'header', parameters: [{ type: 'image', image: ctx.image.id ? { id: ctx.image.id } : { link: ctx.image.link } }] });
  }
  for (const c of tpl.components) {
    if ((c.type === 'HEADER' && c.format === 'TEXT') || c.type === 'BODY') {
      const names = extractParams([c]);
      if (names.length) {
        components.push({
          type: c.type.toLowerCase(),
          parameters: names.map((n) => ({ type: 'text', parameter_name: n, text: paramText(resolveParam(n, ctx)) }))
        });
      }
    }
  }
  const idx = urlButtonIndex(tpl.components);
  if (idx >= 0) {
    components.push({ type: 'button', sub_type: 'url', index: String(idx), parameters: [{ type: 'text', text: ctx.trackCode || 'site' }] });
  }
  return components;
}

/** Render the body text with values, for dashboard previews. */
export function renderPreview(tpl: TemplateRow, ctx: TemplateContext): string {
  const body = tpl.components.find((c) => c.type === 'BODY')?.text ?? '';
  const header = tpl.components.find((c) => c.type === 'HEADER' && c.format === 'TEXT')?.text;
  const fill = (s: string) => s.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/g, (_: string, n: string) => resolveParam(n, ctx));
  return [header ? `*${fill(header)}*` : null, fill(body)].filter(Boolean).join('\n\n');
}

export async function sendTemplate(
  contact: Pick<Contact, 'id' | 'wa_id' | 'lang' | 'name' | 'country' | 'business_name'>,
  name: string,
  kind: SendKind,
  ctx: Omit<TemplateContext, 'contact'> & { campaignId?: string; quotaReserved?: boolean } = {}
): Promise<SendResult | { ok: false; reason: 'no_template' | 'no_image' }> {
  const tpl = await pickTemplate(name, contact.lang);
  if (!tpl) return { ok: false, reason: 'no_template' };
  if (needsImage(tpl) && !ctx.image?.id && !ctx.image?.link) return { ok: false, reason: 'no_image' };
  const payload = build.template(tpl.name, tpl.language, templateComponents(tpl, { ...ctx, contact }));
  return send(contact, payload, kind, { campaignId: ctx.campaignId, quotaReserved: ctx.quotaReserved });
}
