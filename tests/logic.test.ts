import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { detectLang } from '../src/lib/lang.ts';
import { detectCountry, scoreLead } from '../src/lib/scoring.ts';
import { isOpen, kolkataNow, quotaMonth } from '../src/lib/hours.ts';
import { cleanText, normalizeWaId } from '../src/lib/sanitize.ts';
import { maskPhone } from '../src/lib/log.ts';
import { BUDGETS, DEADLINES, SERVICES, menuRows, matchFaq, t } from '../src/lib/business.ts';

test('language detection', () => {
  assert.equal(detectLang('mujhe website banwani hai'), 'hinglish');
  assert.equal(detectLang('मुझे वेबसाइट चाहिए'), 'hinglish');
  assert.equal(detectLang('I need a website for my restaurant'), 'en');
  assert.equal(detectLang('ok'), null);
  assert.equal(detectLang('kitna hoga'), 'hinglish');
});

test('country detection', () => {
  assert.equal(detectCountry('Dubai, UAE'), 'UAE');
  assert.equal(detectCountry('sharjah'), 'UAE');
  assert.equal(detectCountry('Riyadh KSA'), 'Saudi Arabia');
  assert.equal(detectCountry('London'), 'UK');
  assert.equal(detectCountry('Surat, Gujarat'), 'India');
  assert.equal(detectCountry('Nairobi, Kenya'), null);
});

test('lead scoring', () => {
  assert.equal(scoreLead({ budgetId: 'bud_5k', country: 'UAE', deadlineId: 'dl_asap', serviceId: 'svc_app' }).score, 'hot');
  assert.equal(scoreLead({ budgetId: 'bud_500_2k', country: 'UK', deadlineId: 'dl_1m', serviceId: 'svc_web' }).score, 'warm');
  assert.equal(scoreLead({ budgetId: 'bud_lt500', country: 'India', deadlineId: 'dl_flex', serviceId: 'svc_m365email' }).score, 'cold');
});

test('business hours in Asia/Kolkata', () => {
  const hours = { days: [1, 2, 3, 4, 5, 6], start: '10:00', end: '19:00' };
  // Fri 17 Oct 2026 06:30 UTC = 12:00 IST
  assert.equal(isOpen(hours, new Date('2026-10-16T06:30:00Z')), true);
  // 14:00 UTC = 19:30 IST → closed
  assert.equal(isOpen(hours, new Date('2026-10-16T14:00:00Z')), false);
  // Sunday noon IST → closed
  assert.equal(isOpen(hours, new Date('2026-10-18T06:30:00Z')), false);
  assert.deepEqual(kolkataNow(new Date('2026-10-16T06:30:00Z')), { day: 5, minutes: 720 });
  assert.equal(quotaMonth(new Date('2026-10-31T19:00:00Z')), '2026-11'); // already November in India
});

test('input cleaning and phone handling', () => {
  assert.equal(cleanText('  hi\u0000 there‮  '), 'hi there');
  assert.equal(cleanText('x'.repeat(2000)).length, 1000);
  assert.equal(normalizeWaId('+91 88664-75352'), '918866475352');
  assert.equal(normalizeWaId('123'), null);
  assert.equal(maskPhone('918866475352'), '91******5352');
});

test('interactive labels fit WhatsApp limits', () => {
  assert.ok(SERVICES.length <= 10, 'list max 10 rows');
  for (const lang of ['en', 'hinglish'] as const) {
    for (const r of menuRows(lang)) {
      assert.ok(r.title.length <= 24, `menu title too long: ${r.title}`);
      assert.ok(r.description.length <= 72, `menu description too long: ${r.description}`);
    }
    for (const s of SERVICES) {
      assert.ok(s.title.length <= 24, s.title);
      assert.ok(s.desc[lang].length <= 72, s.desc[lang]);
    }
    for (const d of DEADLINES) assert.ok(d.title[lang].length <= 20, d.title[lang]);
    for (const key of ['btnQuote', 'btnMenu', 'optinYes', 'optinNo', 'resumeYes', 'resumeRestart', 'deleteYes', 'deleteNo', 'menuButton', 'servicesButton', 'portfolioButton'] as const) {
      assert.ok(t(lang, key).length <= 20, `${lang}.${key} too long: ${t(lang, key)}`);
    }
  }
  for (const b of BUDGETS) assert.ok(b.title.length <= 24, b.title);
});

test('faq matching', () => {
  assert.equal(matchFaq('how much does a website cost?')?.id, 'pricing');
  assert.equal(matchFaq('website kitne din mein banegi')?.id, 'timeline');
  assert.equal(matchFaq('do you do white label work')?.id, 'whitelabel');
  assert.equal(matchFaq('hello'), null);
});

test('templates are valid and honest', () => {
  const dir = new URL('../templates/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 13);
  for (const f of files) {
    const tpl = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
    assert.match(tpl.name, /^[a-z0-9_]+$/);
    assert.ok(['MARKETING', 'UTILITY'].includes(tpl.category));
    const bodyComp = tpl.components.find((c: any) => c.type === 'BODY');
    assert.ok(bodyComp.text.length <= 1024, `${f} body too long`);
    const params = [...bodyComp.text.matchAll(/\{\{([a-z_]+)\}\}/g)].map((m) => m[1]);
    for (const p of params) assert.ok(bodyComp.example.body_text_named_params.some((e: any) => e.param_name === p), `${f} missing example for ${p}`);
    assert.doesNotMatch(bodyComp.text, /\b(we have (delivered|worked)|our clients in|trusted by)\b/i, `${f} makes a past-delivery claim`);
    if (tpl.category === 'MARKETING') assert.ok(tpl.components.some((c: any) => c.type === 'FOOTER' && /STOP/.test(c.text)), `${f} needs a STOP footer`);
    for (const b of tpl.components.find((c: any) => c.type === 'BUTTONS')?.buttons ?? []) assert.ok(b.text.length <= 25, `${f} button too long`);
  }
});
