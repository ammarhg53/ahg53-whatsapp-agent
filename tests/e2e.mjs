// End-to-end conversation test: runs the built app (`npm run build` first) against a
// fake Kapso API and the fake Google Sheet, then plays a full customer conversation.
// Usage: node tests/e2e.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { createGas } = require('./gas-mock.cjs');

const MOCK_PORT = 4010;
const APP_PORT = 3124;
const WEBHOOK_SECRET = 'e2e-webhook-secret-123';
const gas = createGas();
const sent = []; // messages the app sent through "Kapso"

const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (req.url === '/sheets' && req.method === 'POST') {
    const out = gas.context.doPost({ postData: { contents: body } });
    res.writeHead(200, { 'content-type': 'application/json' }).end(out.text);
  } else if (/\/meta\/whatsapp\/v[\d.]+\/\d+\/messages$/.test(req.url) && req.method === 'POST') {
    if (req.headers['x-api-key'] !== 'e2e-kapso-key-123456') return res.writeHead(401).end('{}');
    const msg = JSON.parse(body);
    sent.push(msg);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ messages: [{ id: `wamid.out.${sent.length}` }] }));
  } else if (req.url.startsWith('/platform/v1/whatsapp/contacts/') && req.method === 'DELETE') {
    res.writeHead(204).end();
  } else {
    res.writeHead(404).end('{}');
  }
});
await new Promise((r) => server.listen(MOCK_PORT, '127.0.0.1', r));

const env = {
  ...process.env,
  // 'test' stops Next.js from loading the developer's .env.local over these values
  NODE_ENV: 'test',
  NEXT_TELEMETRY_DISABLED: '1',
  APP_URL: 'https://bot.example.com',
  KAPSO_API_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  KAPSO_API_KEY: 'e2e-kapso-key-123456',
  KAPSO_PHONE_NUMBER_ID: '1347369521796708',
  KAPSO_WABA_ID: '1626288265568713',
  KAPSO_WEBHOOK_SECRET: WEBHOOK_SECRET,
  APPS_SCRIPT_URL: `http://127.0.0.1:${MOCK_PORT}/sheets`,
  APPS_SCRIPT_SECRET: gas.secret,
  ALLOW_LOCAL_SHEETS: '1',
  ADMIN_PASSWORD_HASH: '$2a$12$abcdefghijklmnopqrstuuJ0pY8m9Y6i0vXh1Qy0Yk3VQe5bG4dW2',
  SESSION_SECRET: 'x'.repeat(40),
  PHONE_HASH_SALT: 'salt-salt-salt-salt',
  ADMIN_WHATSAPP: '918866475352',
  CRON_SECRET: 'cron-secret-cron-secret',
  ANTHROPIC_API_KEY: ''
};
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(APP_PORT)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let appLog = '';
app.stdout.on('data', (d) => (appLog += d));
app.stderr.on('data', (d) => (appLog += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`http://127.0.0.1:${APP_PORT}/privacy`)).ok) break; } catch {}
  await sleep(500);
}

const CUSTOMER = '971501234567';
let seq = 0;
async function say(text, replyId) {
  seq++;
  const message = replyId
    ? { id: `wamid.in.${seq}`, type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: replyId, title: text } } }
    : { id: `wamid.in.${seq}`, type: 'text', text: { body: text } };
  const payload = JSON.stringify({ message, conversation: { phone_number: `+${CUSTOMER}`, kapso: { contact_name: 'Aisha Khan' } }, phone_number_id: '1347369521796708' });
  const before = sent.length;
  const res = await fetch(`http://127.0.0.1:${APP_PORT}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-webhook-event': 'whatsapp.message.received',
      'x-webhook-signature': createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex'),
      'x-idempotency-key': `idem-${seq}`
    },
    body: payload
  });
  assert.equal(res.status, 200);
  // wait for the background processing to send its replies and settle
  let stable = 0;
  for (let i = 0; i < 80 && stable < 4; i++) {
    await sleep(150);
    stable = sent.length > before ? stable + 1 : 0;
  }
  return sent.slice(before);
}
const bodyOf = (m) => m.text?.body ?? m.image?.caption ?? m.interactive?.body?.text ?? `[${m.type}]`;
// The after-hours note depends on when the test runs, so leave it out of the checks.
const toCustomer = (msgs) => msgs.filter((m) => m.to === CUSTOMER && !/Thanks for your message! Our team is available/.test(bodyOf(m)));
const rows = (t, where = {}) => gas.call([{ op: 'find', table: t, where }]).results[0].data;
const check = (label, fn) => { fn(); console.log(`✔ ${label}`); };

try {
  let out = toCustomer(await say('hi'));
  check("greeting with menu list", () => {
    assert.equal(out.length, 1);
    assert.equal(out[0].interactive.type, 'list');
    assert.match(bodyOf(out[0]), /Welcome to \*AHG53 Agency\*/);
    assert.equal(out[0].interactive.action.sections[0].rows.length, 5);
  });

  out = toCustomer(await say('Get a Free Quote', 'menu_quote'));
  check('quote starts', () => assert.match(bodyOf(out[0]), /1\/6/));
  out = toCustomer(await say('Aisha Khan'));
  check('asks business', () => assert.match(bodyOf(out[0]), /2\/6/));
  out = toCustomer(await say('skip'));
  check('skip business → asks location', () => assert.match(bodyOf(out[0]), /3\/6/));
  out = toCustomer(await say('Dubai, UAE'));
  check('honest country line + service list', () => {
    assert.match(bodyOf(out[0]), /ready to serve clients in UAE/);
    assert.equal(out[0].interactive.type, 'list');
  });
  out = toCustomer(await say('Mobile Apps', 'q_svc_app'));
  check('asks budget', () => assert.match(bodyOf(out[0]), /5\/6/));
  out = toCustomer(await say('$5,000+', 'bud_5k'));
  check('asks timeline (buttons)', () => assert.equal(out[0].interactive.type, 'button'));
  const done = await say('ASAP (<2 weeks)', 'dl_asap');
  out = toCustomer(done);
  check('summary + opt-in question', () => {
    assert.match(bodyOf(out[0]), /Your quote request is in/);
    assert.match(bodyOf(out[0]), /Service: Mobile Apps/);
    assert.match(bodyOf(out[1]), /updates and offers/);
  });
  check('admin alerted about a HOT lead', () => {
    const alert = done.find((m) => m.to === '918866475352');
    assert.ok(alert, 'no admin alert');
    assert.match(bodyOf(alert), /HOT quote request/);
  });

  await sleep(500);
  const lead = rows('leads')[0];
  check('lead saved and scored hot', () => {
    assert.equal(lead.status, 'complete');
    assert.equal(lead.score, 'hot');
    assert.equal(lead.country, 'UAE');
    assert.equal(lead.business_name, '-');
  });
  check('follow-up sequence enrolled', () => assert.equal(rows('sequence_enrollments')[0].sequence, 'post_quote'));

  out = toCustomer(await say('Yes, send updates', 'optin_yes'));
  await sleep(300);
  check('consent recorded with source', () => {
    const c = rows('contacts', { wa_id: CUSTOMER })[0];
    assert.equal(c.marketing_opt_in, true);
    assert.equal(c.opt_in_source, 'whatsapp_quote_flow');
    assert.ok(c.opt_in_at);
  });

  out = toCustomer(await say('mujhe website kitne din mein milegi?'));
  check('Hinglish detected, FAQ answered in Hinglish', () => assert.match(bodyOf(out[0]), /Timeline:\* simple website aam taur/));

  const handoff = await say('talk to ammar');
  await sleep(300);
  check('handoff pauses bot and alerts admin', () => {
    assert.ok(rows('contacts', { wa_id: CUSTOMER })[0].bot_paused);
    assert.ok(handoff.some((m) => m.to === '918866475352'));
    assert.equal(rows('handoffs')[0].status, 'open');
  });
  out = toCustomer(await say('hello?'));
  check('bot stays quiet while paused', () => assert.equal(out.length, 0));

  out = toCustomer(await say('STOP'));
  await sleep(300);
  check('STOP works even while paused, stops follow-ups', () => {
    assert.match(bodyOf(out[0]), /unsubscribe/i);
    const c = rows('contacts', { wa_id: CUSTOMER })[0];
    assert.equal(c.opted_out, true);
    assert.equal(c.marketing_opt_in, false);
    assert.equal(rows('sequence_enrollments')[0].status, 'stopped');
    assert.equal(rows('suppression').length, 1);
  });

  // replaying a delivery must not produce a second reply
  const before = sent.length;
  seq--;
  await say('STOP');
  check('duplicate webhook ignored', () => assert.equal(sent.length, before));

  out = toCustomer(await say('DELETE MY DATA'));
  check('delete asks for confirmation', () => assert.equal(out[0].interactive.type, 'button'));
  out = toCustomer(await say('Yes, delete', 'del_yes'));
  await sleep(500);
  check('delete erases contact data but keeps suppression marker', () => {
    assert.match(bodyOf(out[0]), /data has been deleted/);
    assert.equal(rows('contacts', { wa_id: CUSTOMER }).length, 0);
    assert.equal(rows('leads').length, 0);
    assert.equal(rows('messages').filter((m) => m.contact_id === lead.contact_id).length, 0);
    assert.equal(rows('suppression').length, 1);
  });

  const q = rows('quota_usage')[0];
  check(`quota counted every message (${q.used} used, ${sent.length} sent)`, () => assert.equal(q.used, sent.length));
  console.log('\nAll end-to-end checks passed.');
} catch (err) {
  console.error('\n✗', err.message, '\n  at', err.stack.split('\n').find((l) => l.includes('e2e.mjs'))?.trim());
  console.error('--- app log (tail) ---\n' + appLog.split('\n').slice(-30).join('\n'));
  process.exitCode = 1;
} finally {
  app.kill();
  server.close();
}
