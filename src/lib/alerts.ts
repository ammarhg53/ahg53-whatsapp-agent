import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from './env';
import { build, sendRaw, KapsoError } from './kapso';
import { reserveQuota, releaseQuota } from './quota';
import { escapeHtml } from './sanitize';
import { log } from './log';

type Alert = { type: string; customer: string; details: string; contactId?: string };

const oneLine = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n);

/** Message Ammar's own WhatsApp. Free text works inside his 24h window; otherwise use the utility template. */
async function whatsappAlert(a: Alert): Promise<boolean> {
  const e = env();
  if (!(await reserveQuota('alert'))) return false;
  const link = a.contactId ? `\n\nOpen: ${e.APP_URL}/dashboard/conversations/${a.contactId}` : '';
  try {
    await sendRaw(e.ADMIN_WHATSAPP, build.text(`🔔 *${a.type}*\nCustomer: ${a.customer}\n${a.details}${link}`));
    return true;
  } catch (err) {
    log.warn('admin text alert failed, trying template', { error: (err as Error).message });
  }
  try {
    await sendRaw(e.ADMIN_WHATSAPP, build.template('ahg_admin_alert', 'en', [{
      type: 'body',
      parameters: [
        { type: 'text', parameter_name: 'alert_type', text: oneLine(a.type, 60) },
        { type: 'text', parameter_name: 'customer', text: oneLine(a.customer, 80) },
        { type: 'text', parameter_name: 'details', text: oneLine(a.details, 600) || '-' }
      ]
    }]));
    return true;
  } catch (err) {
    await releaseQuota();
    log.error('admin template alert failed', { error: (err as KapsoError).message });
    return false;
  }
}

async function emailAlert(a: Alert): Promise<boolean> {
  const e = env();
  if (!e.RESEND_API_KEY || !e.ALERT_EMAIL_TO || !e.ALERT_EMAIL_FROM) return false;
  let html: string;
  try {
    html = await readFile(path.join(process.cwd(), 'emails', 'alert.html'), 'utf8');
  } catch {
    html = '<h2>{{type}}</h2><p>{{customer}}</p><pre>{{details}}</pre><p><a href="{{link}}">Open dashboard</a></p>';
  }
  const vars: Record<string, string> = {
    type: escapeHtml(a.type),
    customer: escapeHtml(a.customer),
    details: escapeHtml(a.details).replace(/\n/g, '<br>'),
    link: `${e.APP_URL}/dashboard${a.contactId ? `/conversations/${a.contactId}` : ''}`,
    logo: `${e.APP_URL}/logo.png`
  };
  html = html.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: e.ALERT_EMAIL_FROM, to: [e.ALERT_EMAIL_TO], subject: `[AHG53 Bot] ${a.type}: ${a.customer}`, html }),
    signal: AbortSignal.timeout(8000)
  }).catch((err: Error) => ({ ok: false, status: 0, statusText: err.message }) as Response);
  if (!res.ok) log.warn('email alert failed', { status: res.status });
  return res.ok;
}

/** Alert Ammar on every channel configured. Never throws. */
export async function alertAdmin(a: Alert) {
  const [wa, mail] = await Promise.allSettled([whatsappAlert(a), emailAlert(a)]);
  const delivered = (wa.status === 'fulfilled' && wa.value) || (mail.status === 'fulfilled' && mail.value);
  if (!delivered) log.error('admin alert not delivered on any channel', { type: a.type });
}
