import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { env } from '@/lib/env';
import { sheet } from '@/lib/sheets';
import { optIn } from '@/lib/consent';
import { sendTemplate } from '@/lib/templates';
import { rateLimitShared, clientIp } from '@/lib/ratelimit';
import { cleanField, normalizeWaId } from '@/lib/sanitize';
import type { Contact } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  phone: z.string().min(7).max(20),
  name: z.string().max(60).optional(),
  consent: z.literal(true),
  source: z.string().max(40).optional(),
  lang: z.enum(['en', 'hinglish']).optional()
});

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = env().OPTIN_ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

/**
 * Website opt-in form (e.g. on ahg53.bond). Requires an explicit consent checkbox.
 * Stores consent with timestamp and source, then sends the welcome template.
 */
export async function POST(req: NextRequest) {
  const headers = corsHeaders(req.headers.get('origin'));
  if (!(await rateLimitShared(`optin:${clientIp(req.headers)}`, 3600, 10, true))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers });
  const waId = normalizeWaId(parsed.data.phone);
  if (!waId) return NextResponse.json({ error: 'Invalid phone number' }, { status: 400, headers });

  const { row: contact } = await sheet.insert<Contact>('contacts', {
    wa_id: waId, name: parsed.data.name ? cleanField(parsed.data.name, 60) : null, lang: parsed.data.lang ?? 'en'
  }, { ignoreConflict: true });
  if (contact.opted_out) return NextResponse.json({ ok: true }, { headers }); // a STOP is only undone by the person texting START
  const alreadyOptedIn = contact.marketing_opt_in;
  await optIn(contact, `website${parsed.data.source ? `:${cleanField(parsed.data.source, 30)}` : ''}`);
  if (!alreadyOptedIn) await sendTemplate(contact, 'ahg_welcome', 'marketing');
  await sheet.drain();

  return NextResponse.json({ ok: true }, { headers });
}
