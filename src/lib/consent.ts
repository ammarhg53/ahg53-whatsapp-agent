import 'server-only';
import { sheet } from './sheets';
import { phoneHash } from './crypto';
import { eraseKapsoContact } from './kapso';
import { log, maskPhone } from './log';
import type { Contact } from './types';

const now = () => new Date().toISOString();

/** STOP: unsubscribe from all proactive messages, immediately. */
export async function optOut(contact: Contact) {
  const at = now();
  Object.assign(contact, { opted_out: true, opted_out_at: at, marketing_opt_in: false });
  await Promise.all([
    sheet.update('contacts', { id: contact.id }, { opted_out: true, opted_out_at: at, marketing_opt_in: false }),
    sheet.upsert('suppression', { phone_hash: phoneHash(contact.wa_id), reason: 'opted_out' }, ['phone_hash']),
    sheet.update('sequence_enrollments', { contact_id: contact.id, status: 'active' }, { status: 'stopped', stop_reason: 'opted_out' }),
    sheet.update('campaign_recipients', { contact_id: contact.id, status: 'pending' }, { status: 'skipped', error: 'opted out' })
  ]);
}

/** Record marketing consent with timestamp and source. */
export async function optIn(contact: Pick<Contact, 'id' | 'wa_id'>, source: string) {
  const at = now();
  Object.assign(contact, { marketing_opt_in: true, opt_in_at: at, opted_out: false });
  await Promise.all([
    sheet.update('contacts', { id: contact.id }, {
      marketing_opt_in: true, opt_in_at: at, opt_in_source: source.slice(0, 60), opted_out: false, opted_out_at: null
    }),
    sheet.remove('suppression', { phone_hash: phoneHash(contact.wa_id) })
  ]);
}

export async function isSuppressed(waId: string): Promise<boolean> {
  return (await sheet.count('suppression', { phone_hash: phoneHash(waId) })) > 0;
}

/** Which of these numbers are on the suppression list (one Sheet round trip). */
export async function suppressedSet(waIds: string[]): Promise<Set<string>> {
  if (!waIds.length) return new Set();
  const byHash = new Map(waIds.map((w) => [phoneHash(w), w]));
  const rows = await sheet.find<{ phone_hash: string }>('suppression', { phone_hash: { op: 'in', value: [...byHash.keys()] } });
  return new Set(rows.map((r) => byHash.get(r.phone_hash)!));
}

/** May we send a marketing template to this contact? */
export async function canMarket(contact: Pick<Contact, 'wa_id' | 'marketing_opt_in' | 'opted_out'>): Promise<boolean> {
  if (!contact.marketing_opt_in || contact.opted_out) return false;
  return !(await isSuppressed(contact.wa_id));
}

/**
 * "Delete my data": erase the contact and everything linked to it, keeping only a
 * hashed suppression marker. Call `eraseFromKapso` after any final reply, because
 * Kapso would otherwise store that reply again.
 */
export async function deleteContactData(contact: Pick<Contact, 'id' | 'wa_id'>) {
  await Promise.all([
    sheet.upsert('suppression', { phone_hash: phoneHash(contact.wa_id), reason: 'deleted' }, ['phone_hash']),
    sheet.remove('contacts', { id: contact.id }) // cascades to messages, leads, handoffs, recipients, enrolments
  ]);
}

export async function eraseFromKapso(waId: string) {
  try {
    if (!(await eraseKapsoContact(waId))) log.error('kapso erase failed — erase this contact manually in the Kapso inbox', { wa: maskPhone(waId) });
  } catch (err) {
    log.error('kapso erase failed — erase this contact manually in the Kapso inbox', { wa: maskPhone(waId), error: (err as Error).message });
  }
}
