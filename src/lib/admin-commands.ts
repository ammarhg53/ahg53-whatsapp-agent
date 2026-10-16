import 'server-only';
import { sheet } from './sheets';
import { env } from './env';
import { build, sendRaw } from './kapso';
import { reserveQuota, releaseQuota, quotaStatus } from './quota';
import { resumeBot } from './contacts';
import { log } from './log';

async function tell(text: string) {
  if (!(await reserveQuota('alert'))) return;
  try {
    await sendRaw(env().ADMIN_WHATSAPP, build.text(text));
  } catch (err) {
    await releaseQuota();
    log.warn('admin reply failed', { error: (err as Error).message });
  }
}

/**
 * Commands Ammar can send from his own WhatsApp (messages starting with #).
 * Anything else from his number goes through the normal bot, so he can test it.
 */
export async function handleAdminCommand(input: string) {
  const [cmd, arg] = input.slice(1).trim().split(/\s+/, 2).map((s) => s.toLowerCase());

  if (cmd === 'open') {
    const data = await sheet.find<{ wa_id: string; name: string | null; paused_reason: string | null }>('contacts', { bot_paused: true }, { order: 'paused_at', desc: true, limit: 10 });
    if (!data.length) return tell('✅ No chats waiting for you.');
    return tell(['🙋 Chats waiting (bot paused):', ...data.map((c) => `• ${c.name ?? '-'} …${c.wa_id.slice(-4)} — ${c.paused_reason ?? ''}`), '', 'Reply "#resume 1234" (last 4 digits) to hand a chat back to the bot.'].join('\n'));
  }

  if (cmd === 'resume' && arg && /^\d{4,15}$/.test(arg)) {
    const data = await sheet.find<{ id: string; wa_id: string; name: string | null }>('contacts', { wa_id: { op: 'endswith', value: arg }, bot_paused: true }, { limit: 2 });
    if (!data.length) return tell(`No paused chat ending in ${arg}.`);
    if (data.length > 1) return tell(`More than one paused chat ends in ${arg}; send more digits.`);
    await resumeBot(data[0].id);
    return tell(`🤖 Bot resumed for ${data[0].name ?? '-'} …${data[0].wa_id.slice(-4)}.`);
  }

  if (cmd === 'stats') {
    const q = await quotaStatus();
    const since = new Date(Date.now() - 864e5).toISOString();
    const [leads, hot] = await Promise.all([
      sheet.count('leads', { completed_at: { op: 'gte', value: since } }),
      sheet.count('leads', { score: 'hot', completed_at: { op: 'gte', value: since } })
    ]);
    return tell(`📊 Last 24h: ${leads ?? 0} quote requests (${hot ?? 0} hot).\nMessages this month: ${q.used}/${q.limit} (${q.remaining} left).\nDashboard: ${env().APP_URL}/dashboard`);
  }

  return tell('Commands:\n#open — chats waiting for you\n#resume 1234 — give a chat back to the bot\n#stats — today\'s numbers\n\nMessages without # go to the bot as a normal customer, so you can test it.');
}
