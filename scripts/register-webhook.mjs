// Creates the phone-number webhook in Kapso pointing at <APP_URL>/api/whatsapp/webhook
// with a freshly generated signing secret, stored in .env.local as KAPSO_WEBHOOK_SECRET (never printed).
//
// Usage: npm run webhook:register            (uses APP_URL from .env.local)
//        npm run webhook:register -- --list  (show existing webhooks)
import { randomBytes } from 'node:crypto';
import { loadEnv, need, kapso, writeEnvValue } from './env.mjs';

loadEnv();
const phoneNumberId = need('KAPSO_PHONE_NUMBER_ID');
const base = `/platform/v1/whatsapp/phone_numbers/${encodeURIComponent(phoneNumberId)}/webhooks`;

async function list() {
  const res = await kapso(base);
  if (!res.ok) {
    console.error(`Kapso error ${res.status}`);
    process.exitCode = 1;
    return;
  }
  const hooks = res.data?.data ?? [];
  for (const h of hooks) console.log(`${h.id}  ${h.active ? 'active' : 'inactive'}  ${h.url}  [${(h.events ?? []).join(', ')}]`);
  if (!hooks.length) console.log('No webhooks yet.');
}

async function register() {
  const appUrl = need('APP_URL').replace(/\/+$/, '');
  if (!appUrl.startsWith('https://')) {
    console.error('APP_URL must be a public https URL (deploy first, or use a tunnel such as ngrok for local testing).');
    process.exitCode = 1;
    return;
  }
  // Kapso signs every delivery with this secret; the app verifies it.
  const secretKey = randomBytes(32).toString('hex');
  const res = await kapso(base, {
    method: 'POST',
    body: JSON.stringify({
      whatsapp_webhook: {
        url: `${appUrl}/api/whatsapp/webhook`,
        events: ['whatsapp.message.received', 'whatsapp.message.sent', 'whatsapp.message.delivered', 'whatsapp.message.read', 'whatsapp.message.failed'],
        kind: 'kapso',
        payload_version: 'v2',
        buffer_enabled: false,
        active: true,
        secret_key: secretKey
      }
    })
  });
  if (!res.ok) {
    console.error(`Kapso error ${res.status}: ${JSON.stringify(res.data?.error ?? res.data).slice(0, 300)}`);
    process.exitCode = 1;
    return;
  }
  const hook = res.data?.data ?? res.data;
  writeEnvValue('KAPSO_WEBHOOK_SECRET', secretKey);
  console.log(`Webhook created: ${hook?.id} → ${appUrl}/api/whatsapp/webhook`);
  console.log('Signing secret saved to .env.local as KAPSO_WEBHOOK_SECRET. Copy it to Vercel too.');
}

// Set exitCode instead of calling process.exit(), which can crash Node on Windows while sockets close.
await (process.argv.includes('--list') ? list() : register());
