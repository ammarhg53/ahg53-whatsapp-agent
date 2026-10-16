'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { sheet } from '@/lib/sheets';
import { build } from '@/lib/kapso';
import { send } from '@/lib/outbound';
import { optIn, optOut, deleteContactData, eraseFromKapso, isSuppressed } from '@/lib/consent';
import { importOptedIn } from '@/lib/import';
import { resumeBot, pauseBot } from '@/lib/contacts';
import { imageFromParams, needsImage, pickTemplate, sendTemplate, syncTemplates } from '@/lib/templates';
import { uploadMedia } from '@/lib/kapso';
import { audienceSchema, confirmCampaign, countAudience } from '@/lib/campaigns';
import { quotaStatus } from '@/lib/quota';
import { saveSetting } from '@/lib/settings';
import { cleanField, cleanText, normalizeWaId } from '@/lib/sanitize';
import type { Contact } from '@/lib/types';

const uuid = z.string().uuid();

const IMAGE_TYPES = ['image/jpeg', 'image/png'];

/**
 * Picture for an image template: an uploaded file (sent to WhatsApp, kept ~30 days)
 * or a public https link. Returns params to store, or an error message.
 */
async function readImage(form: FormData): Promise<{ params: Record<string, string> } | { error: string }> {
  const file = form.get('image_file');
  if (file instanceof File && file.size > 0) {
    if (!IMAGE_TYPES.includes(file.type)) return { error: 'The picture must be a JPG or PNG' };
    if (file.size > 4 * 1024 * 1024) return { error: 'The picture must be under 4 MB' };
    try {
      return { params: { _image_id: await uploadMedia(file, file.type) } };
    } catch (err) {
      return { error: `Picture upload failed: ${(err as Error).message}` };
    }
  }
  const link = String(form.get('image_link') ?? '').trim();
  if (link) {
    if (!/^https:\/\/[^\s"'<>]+$/.test(link)) return { error: 'The picture link must start with https://' };
    return { params: { _image_link: link } };
  }
  return { params: {} };
}
const back = (path: string, msg: string): never => redirect(`${path}?msg=${encodeURIComponent(msg)}`);

async function getContact(id: string): Promise<Contact> {
  const contact = await sheet.first<Contact>('contacts', { id: uuid.parse(id) });
  if (!contact) throw new Error('Contact not found');
  return contact;
}

// ---------------------------------------------------------------- conversations
export async function resumeBotAction(form: FormData) {
  await requireAdmin();
  const id = uuid.parse(form.get('contactId'));
  await resumeBot(id);
  revalidatePath(`/dashboard/conversations/${id}`);
  revalidatePath('/dashboard');
}

export async function pauseBotAction(form: FormData) {
  await requireAdmin();
  const id = uuid.parse(form.get('contactId'));
  await pauseBot(id, 'paused from dashboard');
  revalidatePath(`/dashboard/conversations/${id}`);
}

export async function sendManualReplyAction(form: FormData) {
  await requireAdmin();
  const c = await getContact(String(form.get('contactId')));
  const path = `/dashboard/conversations/${c.id}`;
  const text = cleanText(form.get('text'), 4000);
  if (!text) back(path, 'Message is empty');
  if (!c.last_inbound_at || Date.now() - Date.parse(c.last_inbound_at) > 24 * 3600e3) {
    back(path, 'The 24-hour window is closed — use a template instead');
  }
  if (!c.bot_paused) await pauseBot(c.id, 'Ammar replied from dashboard');
  const res = await send(c, build.text(text), 'manual');
  back(path, res.ok ? 'Sent. Bot is paused for this chat — resume it when you are done.' : `Not sent: ${res.reason === 'quota' ? 'monthly limit reached' : res.error}`);
}

export async function sendProjectUpdateAction(form: FormData) {
  await requireAdmin();
  const c = await getContact(String(form.get('contactId')));
  const path = `/dashboard/conversations/${c.id}`;
  if (c.opted_out) back(path, 'This number opted out — not sent');
  const project = cleanField(form.get('project'), 60);
  const update = cleanField(form.get('update'), 600);
  if (!project || !update) back(path, 'Project name and update are required');
  const res = await sendTemplate(c, 'ahg_project_update', 'utility', { fixed: { project_name: project, update_text: update } });
  back(path, res.ok ? 'Project update sent' : `Not sent: ${res.reason === 'no_template' ? 'template ahg_project_update is not approved yet' : res.reason}`);
}

export async function updateContactAction(form: FormData) {
  await requireAdmin();
  const c = await getContact(String(form.get('contactId')));
  const tags = String(form.get('tags') ?? '')
    .split(',').map((t) => cleanField(t, 40).toLowerCase()).filter(Boolean).slice(0, 20);
  const status = z.enum(['new', 'lead', 'customer', 'lost']).parse(form.get('status'));
  const country = cleanField(form.get('country'), 60) || null;
  await sheet.update('contacts', { id: c.id }, { tags, status, country });
  revalidatePath(`/dashboard/conversations/${c.id}`);
}

export async function setMarketingAction(form: FormData) {
  await requireAdmin();
  const c = await getContact(String(form.get('contactId')));
  if (form.get('optIn') === 'true') {
    const source = cleanField(form.get('source'), 40);
    if (!source) back(`/dashboard/conversations/${c.id}`, 'Say where the consent came from');
    await optIn(c, `manual:${source}`);
  } else {
    await optOut(c);
  }
  revalidatePath(`/dashboard/conversations/${c.id}`);
}

export async function deleteContactAction(form: FormData) {
  await requireAdmin();
  const c = await getContact(String(form.get('contactId')));
  if (form.get('confirm') !== 'DELETE') back(`/dashboard/conversations/${c.id}`, 'Type DELETE to confirm');
  await deleteContactData(c);
  await eraseFromKapso(c.wa_id);
  back('/dashboard/conversations', 'Contact data deleted here and erasure requested in Kapso');
}

export async function importContactsAction(form: FormData) {
  await requireAdmin();
  const source = cleanField(form.get('source'), 40);
  if (form.get('consent') !== 'on' || !source) back('/dashboard/conversations', 'Confirm consent and give its source');
  const lines = String(form.get('rows') ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 2000);
  let invalid = 0;
  const rows: { wa_id: string; name: string | null; country: string | null }[] = [];
  for (const line of lines) {
    const [phone, name, country] = line.split(',').map((s) => s.trim());
    const waId = normalizeWaId(phone);
    if (!waId) { invalid++; continue; }
    rows.push({ wa_id: waId, name: name ? cleanField(name, 60) : null, country: country ? cleanField(country, 60) : null });
  }
  const r = await importOptedIn(rows, `import:${source}`);
  back('/dashboard/conversations', `Added ${r.added}, opted in ${r.optedIn} existing, skipped ${r.skippedOptedOut} who sent STOP, ${invalid} invalid`);
}

/** Start a conversation with any number using an approved template. */
export async function sendToNumberAction(form: FormData) {
  await requireAdmin();
  const template = z.string().regex(/^[a-z0-9_]{1,512}$/).safeParse(form.get('template'));
  const path = `/dashboard/send${template.success ? `?template=${template.data}` : ''}`;
  const fail = (msg: string) => redirect(`${path}${path.includes('?') ? '&' : '?'}msg=${encodeURIComponent(msg)}`);
  if (!template.success) fail('Choose a template');
  const waId = normalizeWaId(String(form.get('phone') ?? '').replace(/^00/, ''));
  if (!waId || waId.length < 10) fail('Enter the full number with country code, e.g. +971 50 123 4567');

  const tpl = await pickTemplate(template.data!, form.get('lang') === 'hinglish' ? 'hinglish' : 'en');
  if (!tpl) fail('That template is not approved yet');
  const isMarketing = tpl!.category === 'MARKETING';
  const source = cleanField(form.get('source'), 40);
  if (isMarketing && (form.get('consent') !== 'on' || !source)) fail('Marketing templates need the person\'s consent and where it came from');

  if (await isSuppressed(waId!)) fail('This number opted out (STOP) or asked for deletion — not sent');
  const { row: contact } = await sheet.insert<Contact>('contacts', {
    wa_id: waId,
    name: cleanField(form.get('name'), 60) || null,
    country: cleanField(form.get('country'), 60) || null,
    lang: form.get('lang') === 'hinglish' ? 'hinglish' : 'en'
  }, { ignoreConflict: true });
  if (contact.opted_out) fail('This number opted out (STOP) — not sent');
  if (isMarketing && !contact.marketing_opt_in) await optIn(contact, `manual:${source}`);

  const fixed: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (k.startsWith('param_') && typeof v === 'string' && v.trim()) fixed[k.slice(6)] = cleanField(v, 600);
  }
  let image;
  if (needsImage(tpl!)) {
    const img = await readImage(form);
    if ('error' in img) fail(img.error);
    else if (!Object.keys(img.params).length) fail('This template needs a picture — upload one or paste a link');
    else image = imageFromParams(img.params);
  }
  const res = await sendTemplate(contact, template.data!, isMarketing ? 'marketing' : 'utility', { fixed, image });
  await sheet.drain();
  if (!res.ok) fail(`Not sent: ${res.reason === 'quota' ? 'monthly message limit reached' : res.reason === 'no_template' ? 'template not approved' : res.reason === 'no_image' ? 'picture missing' : (res as { error?: string }).error ?? 'error'}`);
  back(`/dashboard/conversations/${contact.id}`, 'Template sent. When they reply you can type freely here for 24 hours.');
}

// ---------------------------------------------------------------- leads
export async function setLeadStatusAction(form: FormData) {
  await requireAdmin();
  const id = uuid.parse(form.get('leadId'));
  const status = z.enum(['complete', 'won', 'lost']).parse(form.get('status'));
  await sheet.update('leads', { id }, { status });
  const lead = await sheet.first<{ contact_id: string }>('leads', { id });
  if (lead && status === 'won') await sheet.update('contacts', { id: lead.contact_id }, { status: 'customer' });
  revalidatePath('/dashboard/leads');
}

// ---------------------------------------------------------------- campaigns
function parseAudience(form: FormData) {
  return audienceSchema.parse({
    tags: String(form.get('tags') ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
    countries: form.getAll('countries').map(String).filter(Boolean),
    scores: form.getAll('scores').map(String),
    statuses: form.getAll('statuses').map(String)
  });
}

export async function createCampaignAction(form: FormData) {
  await requireAdmin();
  const name = cleanField(form.get('name'), 80);
  const template = z.string().regex(/^[a-z0-9_]{1,512}$/).safeParse(form.get('template'));
  if (!name || !template.success) back('/dashboard/campaigns/new', 'Name and an approved template are required');
  const link = String(form.get('link_url') ?? '').trim();
  if (link && !/^https:\/\/[^\s"'<>]+$/.test(link)) back('/dashboard/campaigns/new', 'Link must start with https://');
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (k.startsWith('param_') && typeof v === 'string' && v.trim()) params[k.slice(6)] = cleanField(v, 600);
  }
  const tplRows = await sheet.find<{ components: any[] }>('templates', { name: template.data!, status: 'APPROVED' });
  if (tplRows.some((t) => needsImage(t))) {
    const img = await readImage(form);
    if ('error' in img) back(`/dashboard/campaigns/new?template=${template.data}`, img.error);
    else if (!Object.keys(img.params).length) back(`/dashboard/campaigns/new?template=${template.data}`, 'This template needs a picture — upload one or paste a link');
    else Object.assign(params, img.params);
  }
  const when = String(form.get('scheduled_at') ?? '');
  // datetime-local is entered in IST
  const scheduledAt = when ? new Date(`${when}:00+05:30`) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) back('/dashboard/campaigns/new', 'Invalid schedule time');

  const { row } = await sheet.insert<{ id: string }>('campaigns', {
    name, template_name: template.data!, audience: parseAudience(form), params, link_url: link || null,
    scheduled_at: scheduledAt?.toISOString() ?? null
  });
  redirect(`/dashboard/campaigns/${row.id}`);
}

export async function confirmCampaignAction(form: FormData) {
  await requireAdmin();
  const id = uuid.parse(form.get('campaignId'));
  const path = `/dashboard/campaigns/${id}`;
  const c = await sheet.first<{ status: string; audience: unknown; scheduled_at: string | null }>('campaigns', { id });
  if (!c || c.status !== 'draft') back(path, 'Only drafts can be confirmed');
  const audience = audienceSchema.parse(c!.audience);
  const n = await countAudience(audience);
  const q = await quotaStatus();
  if (n === 0) back(path, 'No opted-in contacts match this audience');
  if (n > q.marketingRemaining) back(path, `Needs ${n} messages but only ${q.marketingRemaining} are left for marketing this month`);
  const at = c!.scheduled_at && Date.parse(c!.scheduled_at) > Date.now() ? new Date(c!.scheduled_at) : new Date();
  const count = await confirmCampaign(id, audience, at);
  back(path, `Scheduled for ${count} recipients`);
}

export async function cancelCampaignAction(form: FormData) {
  await requireAdmin();
  const id = uuid.parse(form.get('campaignId'));
  await Promise.all([
    sheet.update('campaigns', { id, status: { op: 'in', value: ['draft', 'scheduled', 'sending'] } }, { status: 'cancelled', finished_at: new Date().toISOString() }),
    sheet.update('campaign_recipients', { campaign_id: id, status: 'pending' }, { status: 'skipped', error: 'campaign cancelled' })
  ]);
  back(`/dashboard/campaigns/${id}`, 'Campaign cancelled');
}

// ---------------------------------------------------------------- templates & settings
export async function syncTemplatesAction() {
  await requireAdmin();
  try {
    const n = await syncTemplates();
    back('/dashboard/templates', `Synced ${n} templates from WhatsApp`);
  } catch (err) {
    if ((err as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw err;
    back('/dashboard/templates', `Sync failed: ${(err as Error).message}`);
  }
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const sequenceSchema = z.array(z.object({ day: z.number().int().min(0).max(60), template: z.string().regex(/^[a-z0-9_]+$/) })).max(10);

export async function saveSettingsAction(form: FormData) {
  await requireAdmin();
  const num = (k: string, min: number, max: number) => z.coerce.number().int().min(min).max(max).parse(form.get(k));
  let sequence: z.infer<typeof sequenceSchema>;
  try {
    sequence = sequenceSchema.parse(JSON.parse(String(form.get('post_quote_sequence') ?? '[]')));
  } catch {
    back('/dashboard/settings', 'Follow-up sequence must be valid JSON like [{"day":1,"template":"ahg_quote_followup"}]');
  }
  const limit = num('monthly_message_limit', 0, 1_000_000);
  const reserve = num('service_reserve', 0, limit);
  await Promise.all([
    saveSetting('monthly_message_limit', limit),
    saveSetting('service_reserve', reserve),
    saveSetting('ai_enabled', form.get('ai_enabled') === 'on'),
    saveSetting('ai_max_tokens', num('ai_max_tokens', 256, 4000)),
    saveSetting('reengage_enabled', form.get('reengage_enabled') === 'on'),
    saveSetting('business_hours', {
      days: form.getAll('days').map(Number).filter((d) => d >= 1 && d <= 7),
      start: hhmm.parse(form.get('start')),
      end: hhmm.parse(form.get('end'))
    }),
    saveSetting('post_quote_sequence', sequence!)
  ]);
  back('/dashboard/settings', 'Settings saved');
}
