import 'server-only';
import { sheet } from './sheets';
import { env } from './env';
import { getSettings, type SequenceStep } from './settings';
import { suppressedSet } from './consent';
import { sendTemplate } from './templates';
import { send } from './outbound';
import { build } from './kapso';
import { t } from './business.ts';
import { log } from './log';
import type { Contact, Lead } from './types';

const DAY = 864e5;
const REENGAGE_STEPS: SequenceStep[] = [{ day: 0, template: 'ahg_reengage' }];

type Enrollment = {
  id: string; contact_id: string; lead_id: string | null; sequence: string; step: number;
  next_run_at: string; last_sent_at: string | null; enrolled_at: string;
};

const stop = (id: string, reason: string) => sheet.update('sequence_enrollments', { id }, { status: 'stopped', stop_reason: reason });

/** Send due follow-up steps. Each step is skipped if the customer replied or opted out. */
export async function processSequences(deadline: number) {
  const s = await getSettings();
  const stats = { sent: 0, stopped: 0 };
  const due = await sheet.find<Enrollment>('sequence_enrollments',
    { status: 'active', next_run_at: { op: 'lte', value: new Date().toISOString() } },
    { order: 'next_run_at', limit: 30 });
  if (!due.length) return stats;

  const [contacts, leads] = await Promise.all([
    sheet.find<Contact>('contacts', { id: { op: 'in', value: [...new Set(due.map((d) => d.contact_id))] } }),
    sheet.find<Lead>('leads', { id: { op: 'in', value: due.map((d) => d.lead_id).filter(Boolean) as string[] } })
  ]);
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const suppressed = await suppressedSet(contacts.map((c) => c.wa_id));

  for (const en of due) {
    if (Date.now() > deadline) break;
    const contact = contactById.get(en.contact_id);
    if (!contact) continue;
    const steps = en.sequence === 'reengage' ? REENGAGE_STEPS : s.post_quote_sequence;
    const step = steps[en.step];
    if (!step) {
      void sheet.update('sequence_enrollments', { id: en.id }, { status: 'completed' });
      continue;
    }
    if (!contact.marketing_opt_in || contact.opted_out || suppressed.has(contact.wa_id)) {
      void stop(en.id, contact.opted_out ? 'opted_out' : 'no_consent');
      stats.stopped++;
      continue;
    }
    // A reply after enrolment (15 min grace for the opt-in tap) or after the last step means they are engaged.
    const since = en.last_sent_at ? Date.parse(en.last_sent_at) : Date.parse(en.enrolled_at) + 15 * 60e3;
    if (contact.last_inbound_at && Date.parse(contact.last_inbound_at) > since) {
      void stop(en.id, 'replied');
      stats.stopped++;
      continue;
    }
    if (contact.bot_paused) {
      void stop(en.id, 'human_handling');
      continue;
    }

    const res = await sendTemplate(contact, step.template, 'marketing', { service: en.lead_id ? leadById.get(en.lead_id)?.service : null });
    const next = steps[en.step + 1];
    const advance = next
      ? { step: en.step + 1, next_run_at: new Date(Date.parse(en.enrolled_at) + next.day * DAY).toISOString() }
      : { step: en.step + 1, status: 'completed' };
    if (res.ok) {
      stats.sent++;
      void sheet.update('sequence_enrollments', { id: en.id }, { ...advance, last_sent_at: new Date().toISOString() });
    } else if (res.reason === 'quota') {
      void sheet.update('sequence_enrollments', { id: en.id }, { next_run_at: new Date(Date.now() + DAY).toISOString() });
    } else {
      log.warn('sequence step skipped', { template: step.template, reason: res.reason });
      void sheet.update('sequence_enrollments', { id: en.id }, advance);
    }
  }
  await sheet.drain();
  return stats;
}

/** Enrol opted-in contacts silent for 14+ days into a one-step re-engagement (at most once per 30 days). */
export async function enrollReengagement() {
  const s = await getSettings();
  if (!s.reengage_enabled) return 0;
  const cutoff = new Date(Date.now() - 14 * DAY).toISOString();
  const monthAgo = new Date(Date.now() - 30 * DAY).toISOString();
  const [candidates, recent] = await Promise.all([
    sheet.find<{ id: string }>('contacts', {
      marketing_opt_in: true, opted_out: false, bot_paused: false,
      wa_id: { op: 'neq', value: env().ADMIN_WHATSAPP },
      last_inbound_at: { op: 'lt', value: cutoff },
      last_outbound_at: { op: 'lt_or_null', value: cutoff }
    }, { limit: 40 }),
    sheet.find<{ contact_id: string; sequence: string; status: string; enrolled_at: string }>('sequence_enrollments',
      { enrolled_at: { op: 'gte', value: monthAgo } })
  ]);
  const busy = new Set(recent.filter((r) => r.status === 'active' || r.sequence === 'reengage').map((r) => r.contact_id));
  const rows = candidates.filter((c) => !busy.has(c.id)).map((c) => ({ contact_id: c.id, sequence: 'reengage', next_run_at: new Date().toISOString() }));
  if (rows.length) await sheet.insertMany('sequence_enrollments', rows);
  return rows.length;
}

/** One gentle reminder (inside the 24h window) for quotes left half-way; abandon after 7 days. */
export async function nudgeUnfinishedQuotes() {
  const now = Date.now();
  void sheet.update('leads', { status: 'in_progress', updated_at: { op: 'lt', value: new Date(now - 7 * DAY).toISOString() } }, { status: 'abandoned' });

  const leads = await sheet.find<Lead>('leads', {
    status: 'in_progress', nudged_at: null,
    updated_at: { op: 'lt', value: new Date(now - 2 * 3600e3).toISOString() }
  }, { limit: 20 });
  const fresh = leads.filter((l) => Date.parse(l.updated_at) > now - 20 * 3600e3);
  if (!fresh.length) return 0;
  const contacts = await sheet.find<Contact>('contacts', { id: { op: 'in', value: fresh.map((l) => l.contact_id) } });
  const byId = new Map(contacts.map((c) => [c.id, c]));

  let sent = 0;
  for (const lead of fresh) {
    void sheet.update('leads', { id: lead.id }, { nudged_at: new Date().toISOString() });
    const c = byId.get(lead.contact_id);
    if (!c || c.bot_paused || c.opted_out || !c.last_inbound_at || now - Date.parse(c.last_inbound_at) > 23 * 3600e3) continue;
    const res = await send(c, build.buttons(t(c.lang, 'resumeAsk'), [
      { id: 'resume_yes', title: t(c.lang, 'resumeYes') },
      { id: 'resume_restart', title: t(c.lang, 'resumeRestart') },
      { id: 'resume_menu', title: t(c.lang, 'btnMenu') }
    ]), 'service');
    if (res.ok) sent++;
  }
  await sheet.drain();
  return sent;
}
