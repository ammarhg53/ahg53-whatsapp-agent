import 'server-only';
import { randomUUID } from 'node:crypto';
import { sheet } from './sheets';
import { env } from './env';
import { build, type OutboundPayload } from './kapso';
import { send } from './outbound';
import { getSettings, primeSettings } from './settings';
import { isOpen, quotaMonth } from './hours.ts';
import { detectLang } from './lang.ts';
import { detectCountry, scoreLead } from './scoring.ts';
import { BUSINESS, BUDGETS, DEADLINES, SERVICES, matchFaq, menuRows, t, type Lang } from './business.ts';
import { cleanField } from './sanitize';
import { optIn, optOut, deleteContactData, eraseFromKapso } from './consent';
import { alertAdmin } from './alerts';
import { aiReply } from './ai';
import { handleAdminCommand } from './admin-commands';
import { maskPhone, log } from './log';
import type { QuotaSnapshot } from './quota';
import type { Contact, InboundMessage, Lead } from './types';

const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------- keywords
const norm = (s: string) => s.trim().toLowerCase().replace(/[.!?,;:]+$/g, '').replace(/\s+/g, ' ');
const STOP_WORDS = new Set(['stop', 'unsubscribe', 'बंद', 'band', 'band karo', 'stop karo', 'opt out', 'optout', 'stop all']);
const START_WORDS = new Set(['start', 'subscribe', 'unstop', 'opt in', 'optin']);
const DELETE_WORDS = new Set(['delete my data', 'delete data', 'erase my data', 'mera data delete karo', 'data delete karo', 'delete me']);
const PRIVACY_WORDS = new Set(['privacy', 'privacy policy', 'privacy notice']);
const GREETING = /^(hi+|hello+|hey+|hii+|helo|hola|namaste|namaskar|salam|assalam(u)? ?alaikum|good (morning|afternoon|evening)|menu|main menu|options|help|start over)\b/;
const QUOTE = /\b(quote|quotation|estimate)\b/;
const HUMAN = /\b(human|agent|ammar|real person|call me|talk to (someone|a person)|baat karni)\b/;
const SERVICES_WORD = /^(services?|what do you do)$/;

// Template quick-reply buttons arrive as their text (or payload).
const TEMPLATE_BUTTONS: Record<string, string> = {
  'get a free quote': 'menu_quote', 'free quote lijiye': 'menu_quote',
  'our services': 'menu_services', 'hamari services': 'menu_services',
  'i have a question': 'menu_human', 'mera ek sawaal hai': 'menu_human',
  "let's get started": 'tpl_ready', 'chaliye shuru karein': 'tpl_ready',
  'suggest a plan': 'tpl_ready', 'plan suggest karein': 'tpl_ready',
  'not right now': 'tpl_not_now', 'abhi nahi': 'tpl_not_now'
};

// Quota snapshot for the message being handled, so replies don't each wait on the Sheet.
const quotaFor = new WeakMap<Contact, QuotaSnapshot>();

// ---------------------------------------------------------------- helpers
async function reply(c: Contact, payload: OutboundPayload, kind: 'service' | 'ai' = 'service') {
  const res = await send(c, payload, kind, { quota: quotaFor.get(c) });
  if (!res.ok) log.warn('bot reply not sent', { to: maskPhone(c.wa_id), reason: res.reason });
  return res.ok;
}

/** Update the local copy now and queue the Sheet write (flushed with the next batch). */
function updateContact(c: Contact, patch: Partial<Contact>) {
  Object.assign(c, patch);
  void sheet.update('contacts', { id: c.id }, patch);
}

function setFlow(c: Contact, flow: Contact['flow'], step: string | null = null, data: Record<string, string> = {}) {
  updateContact(c, { flow, flow_step: step, flow_data: data });
}

const when = async (lang: Lang) => t(lang, isOpen((await getSettings()).business_hours) ? 'whenOpen' : 'whenClosed');

function menuPayload(c: Contact, body?: string): OutboundPayload {
  return build.list(body ?? t(c.lang, 'menuBody'), t(c.lang, 'menuButton'), menuRows(c.lang), t(c.lang, 'menuFooter'));
}

// One message: greeting text plus the menu. The profile photo is managed in Kapso.
async function sendGreeting(c: Contact) {
  await reply(c, menuPayload(c, t(c.lang, 'greeting', { name: c.name?.split(' ')[0] ?? 'there' })));
}

const serviceRows = (lang: Lang, prefix = '') => SERVICES.map((s) => ({ id: prefix + s.id, title: s.title, description: s.desc[lang] }));
const budgetRows = () => BUDGETS.map((b) => ({ id: b.id, title: b.title }));
const deadlineButtons = (lang: Lang) => DEADLINES.map((d) => ({ id: d.id, title: d.title[lang] }));

async function inProgressLead(c: Contact): Promise<Lead | null> {
  return sheet.first<Lead>('leads', { contact_id: c.id, status: 'in_progress' }, { order: 'created_at', desc: true });
}

// ---------------------------------------------------------------- campaign attribution
async function trackCampaignConversion(c: Contact, leadId: string) {
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const r = await sheet.first<{ id: string; campaign_id: string }>('campaign_recipients',
    { contact_id: c.id, status: 'sent', converted_at: null, sent_at: { op: 'gte', value: since } },
    { order: 'sent_at', desc: true });
  if (!r) return;
  void sheet.update('campaign_recipients', { id: r.id }, { converted_at: nowIso() });
  void sheet.update('leads', { id: leadId }, { campaign_id: r.campaign_id });
}

// ---------------------------------------------------------------- quote flow
type Step = 'name' | 'business' | 'location' | 'service' | 'budget' | 'deadline' | null;

function nextStep(lead: Lead): Step {
  if (!lead.name) return 'name';
  if (!lead.business_name) return 'business';
  if (!lead.location) return 'location';
  if (!lead.service) return 'service';
  if (!lead.budget) return 'budget';
  if (!lead.deadline) return 'deadline';
  return null;
}

async function askStep(c: Contact, lead: Lead, prefix = '') {
  const step = nextStep(lead);
  if (!step) return completeQuote(c, lead);
  setFlow(c, 'quote', step, { ...c.flow_data, leadId: lead.id });
  const p = prefix ? `${prefix}\n\n` : '';
  switch (step) {
    case 'name': return reply(c, build.text(p + t(c.lang, 'qStart')));
    case 'business': return reply(c, build.text(p + t(c.lang, 'qBusiness')));
    case 'location': return reply(c, build.text(p + t(c.lang, 'qLocation')));
    case 'service': return reply(c, build.list(p + t(c.lang, 'qService'), t(c.lang, 'servicesButton'), serviceRows(c.lang, 'q_')));
    case 'budget': return reply(c, build.list(p + t(c.lang, 'qBudget'), 'Budget', budgetRows()));
    case 'deadline': return reply(c, build.buttons(p + t(c.lang, 'qDeadline'), deadlineButtons(c.lang)));
  }
}

async function startQuote(c: Contact) {
  void sheet.update('leads', { contact_id: c.id, status: 'in_progress' }, { status: 'abandoned' });
  const now = nowIso();
  const lead: Lead = {
    id: randomUUID(), contact_id: c.id, name: null, business_name: null, location: null, country: null, service: null,
    budget: null, deadline: null, score: null, score_points: null, status: 'in_progress', campaign_id: null,
    nudged_at: null, created_at: now, updated_at: now, completed_at: null
  };
  void sheet.insert('leads', lead);
  c.flow_data = {};
  await Promise.all([trackCampaignConversion(c, lead.id), askStep(c, lead)]);
}

function saveLead(lead: Lead, patch: Partial<Lead>) {
  Object.assign(lead, patch);
  void sheet.update('leads', { id: lead.id }, patch);
}

async function currentLead(c: Contact, known?: Lead | null): Promise<Lead | null> {
  const id = c.flow_data?.leadId;
  if (known && (!id || known.id === id)) return known;
  if (id) {
    const lead = await sheet.first<Lead>('leads', { id, status: 'in_progress' });
    if (lead) return lead;
  }
  return inProgressLead(c);
}

function locationAck(lang: Lang, country: string | null): string {
  if (country === BUSINESS.base) return t(lang, 'homeMarket');
  if (country && (BUSINESS.targetCountries as readonly string[]).includes(country)) return t(lang, 'readyToServe', { country });
  return t(lang, 'bestQuote');
}

/** Free-text answer during the quote flow. Returns true if consumed. */
async function quoteText(c: Contact, text: string, known: Lead | null): Promise<boolean> {
  const lead = await currentLead(c, known);
  if (!lead) {
    setFlow(c, null);
    return false;
  }
  const step = nextStep(lead);
  const value = cleanField(text, 80);
  if (step === 'name') {
    if (value.length < 2 || value.length > 60) return !!(await reply(c, build.text(t(c.lang, 'qInvalidName'))));
    saveLead(lead, { name: value });
    updateContact(c, { name: value });
  } else if (step === 'business') {
    // '-' marks "skipped" (an empty cell would read back as "not answered yet")
    if (/^(skip|no|none|nahi|nahin|-)$/i.test(value)) saveLead(lead, { business_name: '-' });
    else if (value.length < 2) return !!(await reply(c, build.text(t(c.lang, 'qInvalidText'))));
    else {
      saveLead(lead, { business_name: value });
      updateContact(c, { business_name: value });
    }
  } else if (step === 'location') {
    if (value.length < 2) return !!(await reply(c, build.text(t(c.lang, 'qInvalidText'))));
    const country = detectCountry(value);
    saveLead(lead, { location: value, country });
    updateContact(c, { country: country ?? value, city: value });
    await askStep(c, lead, locationAck(c.lang, country));
    return true;
  } else {
    // service / budget / deadline expect a tap; re-show the options
    await askStep(c, lead, t(c.lang, 'qPickOption'));
    return true;
  }
  await askStep(c, lead);
  return true;
}

/** Tapped list row / button that belongs to the quote flow. */
async function quoteChoice(c: Contact, id: string, known: Lead | null): Promise<boolean> {
  const svc = id.startsWith('q_svc_') ? SERVICES.find((s) => 'q_' + s.id === id) : undefined;
  const budget = BUDGETS.find((b) => b.id === id);
  const deadline = DEADLINES.find((d) => d.id === id);
  if (!svc && !budget && !deadline) return false;

  const lead = await currentLead(c, known);
  if (!lead) {
    // Old message tapped after the flow ended: start a fresh quote.
    await startQuote(c);
    return true;
  }
  if (svc) {
    saveLead(lead, { service: svc.title });
    c.flow_data = { ...c.flow_data, serviceId: svc.id };
  }
  if (budget) {
    saveLead(lead, { budget: budget.title });
    c.flow_data = { ...c.flow_data, budgetId: budget.id };
  }
  if (deadline) {
    saveLead(lead, { deadline: deadline.title.en });
    c.flow_data = { ...c.flow_data, deadlineId: deadline.id };
  }
  await askStep(c, lead);
  return true;
}

async function completeQuote(c: Contact, lead: Lead) {
  const serviceId = c.flow_data.serviceId ?? SERVICES.find((s) => s.title === lead.service)?.id;
  const budgetId = c.flow_data.budgetId ?? BUDGETS.find((b) => b.title === lead.budget)?.id;
  const deadlineId = c.flow_data.deadlineId ?? DEADLINES.find((d) => d.title.en === lead.deadline)?.id;
  const { score, points } = scoreLead({ budgetId, country: lead.country, deadlineId, serviceId });

  saveLead(lead, { status: 'complete', score, score_points: points, completed_at: nowIso() });
  updateContact(c, { status: c.status === 'customer' ? 'customer' : 'lead', lead_score: score });
  setFlow(c, null);

  await reply(c, build.text(t(c.lang, 'qDone', {
    name: lead.name?.split(' ')[0] ?? '',
    business: lead.business_name || '-',
    location: lead.location ?? '-',
    service: lead.service ?? '-',
    budget: lead.budget ?? '-',
    deadline: lead.deadline ?? '-',
    when: await when(c.lang)
  })));

  if (!c.marketing_opt_in && !c.opted_out) {
    await reply(c, build.buttons(t(c.lang, 'optinAsk'), [
      { id: 'optin_yes', title: t(c.lang, 'optinYes') },
      { id: 'optin_no', title: t(c.lang, 'optinNo') }
    ]));
  }

  // Follow-up sequence; each step re-checks consent and replies before sending.
  const steps = (await getSettings()).post_quote_sequence;
  if (steps.length) {
    void sheet.insert('sequence_enrollments', {
      contact_id: c.id, lead_id: lead.id, sequence: 'post_quote',
      next_run_at: new Date(Date.now() + steps[0].day * 864e5).toISOString()
    });
  }

  await alertAdmin({
    type: `New ${score.toUpperCase()} quote request`,
    customer: `${lead.name ?? '-'} (+${c.wa_id})`,
    details: `Business: ${lead.business_name || '-'}\nLocation: ${lead.location}\nService: ${lead.service}\nBudget: ${lead.budget}\nTimeline: ${lead.deadline}`,
    contactId: c.id
  });
}

// ---------------------------------------------------------------- handoff
async function handoff(c: Contact, reason: string, note?: string) {
  const [lead, recent] = await Promise.all([
    sheet.first<Lead>('leads', { contact_id: c.id }, { order: 'created_at', desc: true }),
    sheet.find<{ body: string }>('messages', { contact_id: c.id, direction: 'inbound' }, { order: 'created_at', desc: true, limit: 5 })
  ]);
  const summary = [
    `Reason: ${reason}`,
    note ? `Message: ${note}` : null,
    c.country ? `Country: ${c.country}` : null,
    lead ? `Last quote: ${lead.service ?? '-'} · ${lead.budget ?? '-'} · ${lead.deadline ?? '-'} (${lead.score ?? lead.status})` : null,
    recent.length ? `Recent: ${recent.map((m) => `"${String(m.body).slice(0, 80)}"`).reverse().join(' | ')}` : null
  ].filter(Boolean).join('\n');

  updateContact(c, { bot_paused: true, paused_at: nowIso(), paused_reason: reason, flow: null, flow_step: null, flow_data: {} });
  void sheet.insert('handoffs', { contact_id: c.id, reason, summary });
  await reply(c, build.text(t(c.lang, reason === 'support' ? 'supportLogged' : 'handoff', { when: await when(c.lang) })));
  await alertAdmin({
    type: reason === 'support' ? 'Support request' : 'Customer wants to talk to you',
    customer: `${c.name ?? '-'} (+${c.wa_id})`,
    details: summary,
    contactId: c.id
  });
}

// ---------------------------------------------------------------- actions by id
async function handleAction(c: Contact, id: string, known: Lead | null): Promise<boolean> {
  switch (id) {
    case 'menu_services':
      await reply(c, build.list(t(c.lang, 'servicesBody'), t(c.lang, 'servicesButton'), serviceRows(c.lang)));
      return true;
    case 'menu_quote':
    case 'act_quote':
    case 'resume_restart':
      await startQuote(c);
      return true;
    case 'menu_portfolio':
      await reply(c, build.ctaUrl(t(c.lang, 'portfolioBody'), t(c.lang, 'portfolioButton'), BUSINESS.website, t(c.lang, 'menuFooter')));
      return true;
    case 'menu_human':
      await handoff(c, 'requested human');
      return true;
    case 'tpl_ready':
      await handoff(c, 'ready to proceed (follow-up reply)');
      return true;
    case 'menu_support':
      setFlow(c, 'support', 'describe');
      await reply(c, build.text(t(c.lang, 'supportAsk')));
      return true;
    case 'act_menu':
    case 'resume_menu':
      setFlow(c, null);
      await reply(c, menuPayload(c));
      return true;
    case 'resume_yes': {
      const lead = await currentLead(c, known);
      if (lead) await askStep(c, lead);
      else await startQuote(c);
      return true;
    }
    case 'optin_yes':
      await optIn(c, 'whatsapp_quote_flow');
      await reply(c, build.text(t(c.lang, 'optinThanks')));
      return true;
    case 'optin_no':
      await reply(c, build.text(t(c.lang, 'optinDeclined')));
      return true;
    case 'tpl_not_now':
      void sheet.update('sequence_enrollments', { contact_id: c.id, status: 'active' }, { status: 'stopped', stop_reason: 'not_now' });
      await reply(c, build.text(t(c.lang, 'notNow')));
      return true;
    case 'del_yes':
      await deleteContactData(c);
      // The contact is gone, so the confirmation isn't recorded; then erase Kapso's copy.
      await send(c, build.text(t(c.lang, 'deleteDone')), 'service', { quota: quotaFor.get(c), record: false });
      await eraseFromKapso(c.wa_id);
      return true;
    case 'del_no':
      setFlow(c, null);
      await reply(c, build.text(t(c.lang, 'deleteCancelled')));
      return true;
  }
  const svc = SERVICES.find((s) => s.id === id);
  if (svc) {
    await reply(c, build.buttons(t(c.lang, 'serviceDetail', { title: svc.title, desc: svc.desc[c.lang] }), [
      { id: 'act_quote', title: t(c.lang, 'btnQuote') },
      { id: 'act_menu', title: t(c.lang, 'btnMenu') }
    ]));
    return true;
  }
  return quoteChoice(c, id, known);
}

// ---------------------------------------------------------------- entry point
type InboundContext = {
  duplicate: boolean;
  isNew?: boolean;
  contact?: Contact;
  prevLastInbound?: string | null;
  lead?: Lead | null;
  settings?: Record<string, unknown>;
  quotaUsed?: number;
};

export async function handleInbound(msg: InboundMessage) {
  const e = env();
  if (msg.waId === e.ADMIN_WHATSAPP && msg.text.trim().startsWith('#')) {
    await handleAdminCommand(msg.text.trim());
    return;
  }

  // One round trip: contact, stored message (duplicates detected), open quote, settings, quota.
  const ctx = await sheet.call<InboundContext>('inbound', {
    wa_id: msg.waId,
    profile_name: cleanField(msg.profileName, 60) || null,
    wamid: msg.wamid,
    type: msg.type,
    body: msg.text.slice(0, 2000),
    month: quotaMonth()
  });
  if (ctx.duplicate || !ctx.contact) return;

  const c = ctx.contact;
  const s = primeSettings(ctx.settings ?? {});
  quotaFor.set(c, { used: ctx.quotaUsed ?? 0, limit: s.monthly_message_limit });
  const known = ctx.lead ?? null;

  if (msg.type === 'text') {
    const lang = detectLang(msg.text);
    if (lang && lang !== c.lang) updateContact(c, { lang });
  }

  const text = norm(msg.text);
  const id = msg.replyId || TEMPLATE_BUTTONS[text] || '';

  // Consent keywords always work, even while the bot is paused.
  if (STOP_WORDS.has(text)) {
    await optOut(c);
    await reply(c, build.text(t(c.lang, 'stopDone')));
    return;
  }
  if (START_WORDS.has(text)) {
    await optIn(c, 'whatsapp_keyword');
    await reply(c, build.text(t(c.lang, 'startDone')));
    return;
  }
  if (DELETE_WORDS.has(text)) {
    setFlow(c, 'delete_confirm', 'confirm');
    await reply(c, build.buttons(t(c.lang, 'deleteAsk'), [
      { id: 'del_yes', title: t(c.lang, 'deleteYes') },
      { id: 'del_no', title: t(c.lang, 'deleteNo') }
    ]));
    return;
  }
  if (id === 'del_yes' || id === 'del_no') {
    if (c.flow === 'delete_confirm' || id === 'del_no') await handleAction(c, id, known);
    return;
  }
  if (PRIVACY_WORDS.has(text)) {
    await reply(c, build.text(t(c.lang, 'privacy', { url: `${e.APP_URL}/privacy` })));
    return;
  }

  if (c.bot_paused) return; // a human is handling this chat

  if (!isOpen(s.business_hours)) {
    const last = c.after_hours_notified_at ? Date.parse(c.after_hours_notified_at) : 0;
    if (Date.now() - last > 12 * 3600e3) {
      updateContact(c, { after_hours_notified_at: nowIso() });
      await reply(c, build.text(t(c.lang, 'afterHours')));
    }
  }

  if (id && (await handleAction(c, id, known))) return;

  if (c.flow === 'delete_confirm') setFlow(c, null);

  if (c.flow === 'support' && text) {
    await handoff(c, 'support', msg.text.slice(0, 500));
    return;
  }

  if (c.flow === 'quote' && !GREETING.test(text)) {
    if (await quoteText(c, msg.text, known)) return;
  }

  if (GREETING.test(text) || !ctx.prevLastInbound) {
    if (known && nextStep(known)) {
      await reply(c, build.buttons(t(c.lang, 'resumeAsk'), [
        { id: 'resume_yes', title: t(c.lang, 'resumeYes') },
        { id: 'resume_restart', title: t(c.lang, 'resumeRestart') },
        { id: 'resume_menu', title: t(c.lang, 'btnMenu') }
      ]));
      return;
    }
    if (c.flow) setFlow(c, null);
    await sendGreeting(c);
    return;
  }

  if (QUOTE.test(text)) return void (await startQuote(c));
  if (HUMAN.test(text)) return void (await handoff(c, 'requested human', msg.text.slice(0, 300)));
  if (SERVICES_WORD.test(text)) return void (await handleAction(c, 'menu_services', known));

  if (msg.type !== 'text') {
    // Media, location, etc. — Ammar can review it in the inbox.
    await reply(c, menuPayload(c, t(c.lang, 'fallback')));
    return;
  }

  const faq = matchFaq(text);
  if (faq) {
    await reply(c, build.text(`${faq.answer[c.lang]}\n\n${t(c.lang, 'menuFooter')}`));
    return;
  }

  if (s.ai_enabled) {
    const answer = await aiReply(c, s.ai_max_tokens);
    if (answer) {
      await reply(c, build.text(answer), 'ai');
      return;
    }
  }

  await reply(c, menuPayload(c, t(c.lang, 'fallback')));
}
