import 'server-only';
import { sheet } from './sheets';

/** Hand a chat back to the bot and close its open handoffs. */
export async function resumeBot(contactId: string) {
  const now = new Date().toISOString();
  await Promise.all([
    sheet.update('contacts', { id: contactId }, { bot_paused: false, paused_at: null, paused_reason: null }),
    sheet.update('handoffs', { contact_id: contactId, status: 'open' }, { status: 'resolved', resolved_at: now })
  ]);
}

export async function pauseBot(contactId: string, reason: string) {
  await sheet.update('contacts', { id: contactId }, { bot_paused: true, paused_at: new Date().toISOString(), paused_reason: reason });
}
