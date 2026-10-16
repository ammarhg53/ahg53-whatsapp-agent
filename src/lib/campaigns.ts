import 'server-only';
import { z } from 'zod';
import { sheet, type Where } from './sheets';
import { env } from './env';
import { suppressedSet } from './consent';
import { sendTemplate } from './templates';
import { reserveQuota, releaseQuota } from './quota';
import { log } from './log';
import type { Contact } from './types';

export const audienceSchema = z.object({
  tags: z.array(z.string().max(40)).max(20).default([]),
  countries: z.array(z.string().max(60)).max(30).default([]),
  scores: z.array(z.enum(['hot', 'warm', 'cold'])).default([]),
  statuses: z.array(z.enum(['new', 'lead', 'customer', 'lost'])).default([])
});
export type Audience = z.infer<typeof audienceSchema>;

/** Opted-in contacts matching the filter. Opted-out numbers can never match. */
function audienceWhere(a: Audience): Where {
  const where: Where = { marketing_opt_in: true, opted_out: false, wa_id: { op: 'neq', value: env().ADMIN_WHATSAPP } };
  if (a.tags.length) where.tags = { op: 'overlaps', value: a.tags };
  if (a.countries.length) where.country = { op: 'in', value: a.countries };
  if (a.scores.length) where.lead_score = { op: 'in', value: a.scores };
  if (a.statuses.length) where.status = { op: 'in', value: a.statuses };
  return where;
}

export function countAudience(a: Audience): Promise<number> {
  return sheet.count('contacts', audienceWhere(a));
}

export async function sampleContact(a: Audience): Promise<Pick<Contact, 'name' | 'country' | 'business_name'>> {
  return (await sheet.first<Contact>('contacts', audienceWhere(a))) ?? { name: 'Aisha', country: 'UAE', business_name: null };
}

/** Freeze the audience into campaign_recipients and schedule the campaign. */
export async function confirmCampaign(campaignId: string, audience: Audience, scheduledAt: Date): Promise<number> {
  const contacts = await sheet.find<{ id: string }>('contacts', audienceWhere(audience));
  for (let i = 0; i < contacts.length; i += 400) {
    await sheet.insertMany('campaign_recipients',
      contacts.slice(i, i + 400).map((c) => ({ campaign_id: campaignId, contact_id: c.id })),
      { ignoreConflict: true });
  }
  await sheet.update('campaigns', { id: campaignId }, {
    status: 'scheduled', scheduled_at: scheduledAt.toISOString(), recipient_count: contacts.length
  });
  return contacts.length;
}

type Recipient = { id: string; contact_id: string; track_code: string };
type Campaign = { id: string; status: string; template_name: string; params: Record<string, string> | null };

/** Send due campaigns in batches until the time budget runs out. */
export async function processCampaigns(deadline: number): Promise<{ sent: number; failed: number; skipped: number }> {
  const stats = { sent: 0, failed: 0, skipped: 0 };
  const now = new Date().toISOString();
  const [sending, due] = await Promise.all([
    sheet.find<Campaign>('campaigns', { status: 'sending' }),
    sheet.find<Campaign>('campaigns', { status: 'scheduled', scheduled_at: { op: 'lte', value: now } }, { order: 'scheduled_at' })
  ]);

  for (const campaign of [...sending, ...due]) {
    if (campaign.status === 'scheduled') void sheet.update('campaigns', { id: campaign.id }, { status: 'sending', started_at: now });

    while (Date.now() < deadline) {
      const batch = await sheet.find<Recipient>('campaign_recipients', { campaign_id: campaign.id, status: 'pending' }, { limit: 20 });
      if (!batch.length) {
        await sheet.update('campaigns', { id: campaign.id }, { status: 'sent', finished_at: new Date().toISOString() });
        break;
      }
      const contacts = await sheet.find<Contact>('contacts', { id: { op: 'in', value: batch.map((r) => r.contact_id) } });
      const byId = new Map(contacts.map((c) => [c.id, c]));
      const suppressed = await suppressedSet(contacts.map((c) => c.wa_id));
      const sendable = batch.filter((r) => {
        const c = byId.get(r.contact_id);
        return c && c.marketing_opt_in && !c.opted_out && !suppressed.has(c.wa_id);
      });
      for (const r of batch) {
        if (sendable.includes(r)) continue;
        void sheet.update('campaign_recipients', { id: r.id }, { status: 'skipped', error: 'no consent' });
        stats.skipped++;
      }
      if (!sendable.length) continue;

      // Reserve the whole batch at once; stop (and resume on a later tick) when the marketing allowance is used up.
      if (!(await reserveQuota('marketing', sendable.length))) {
        log.warn('campaign paused: marketing quota reached', { campaign: campaign.id });
        await sheet.drain();
        return stats;
      }
      let unused = 0;
      for (const r of sendable) {
        const contact = byId.get(r.contact_id)!;
        const res = await sendTemplate(contact, campaign.template_name, 'marketing', {
          campaignId: campaign.id, fixed: campaign.params ?? {}, trackCode: r.track_code, quotaReserved: true
        });
        if (res.ok) {
          void sheet.update('campaign_recipients', { id: r.id }, { status: 'sent', wamid: res.wamid, sent_at: new Date().toISOString() });
          stats.sent++;
        } else {
          if (res.reason !== 'error') unused++; // template missing: nothing reached WhatsApp
          void sheet.update('campaign_recipients', { id: r.id }, {
            status: 'failed', error: res.reason === 'no_template' ? 'template not approved' : String(res.error ?? res.reason).slice(0, 200)
          });
          stats.failed++;
        }
      }
      if (unused) void releaseQuota(unused);
      await sheet.drain();
    }
  }
  return stats;
}

type RecipientRow = { status: string; delivered_at: string | null; read_at: string | null; clicked_at: string | null; replied_at: string | null; converted_at: string | null };

export function summarize(rows: RecipientRow[]) {
  const n = (f: (r: RecipientRow) => boolean) => rows.filter(f).length;
  return {
    total: rows.length,
    pending: n((r) => r.status === 'pending'),
    sent: n((r) => r.status === 'sent'),
    failed: n((r) => r.status === 'failed'),
    skipped: n((r) => r.status === 'skipped'),
    delivered: n((r) => !!r.delivered_at),
    read: n((r) => !!r.read_at),
    clicked: n((r) => !!r.clicked_at),
    replied: n((r) => !!r.replied_at),
    converted: n((r) => !!r.converted_at)
  };
}

/** Per-campaign funnel for the dashboard. */
export async function campaignStats(campaignId: string) {
  return summarize(await sheet.find<RecipientRow>('campaign_recipients', { campaign_id: campaignId }));
}
