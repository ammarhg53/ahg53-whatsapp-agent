// Creates the phone-number webhook in Kapso pointing at <APP_URL>/api/whatsapp/webhook
// and stores the returned signing secret in .env.local as KAPSO_WEBHOOK_SECRET (never printed).
//
// Usage: npm run webhook:register            (uses APP_URL from .env.local)
//        npm run webhook:register -- --list  (show existing webhooks)
import { loadEnv, need, kapso, writeEnvValue } from './env.mjs';

loadEnv();
const phoneNumberId = need('KAPSO_PHONE_NUMBER_ID');
const base = `/platform/v1/whatsapp/phone_numbers/${encodeURIComponent(phoneNumberId)}/webhooks`;

if (process.argv.includes('--list')) {
  const res = await kapso(base);
  const hooks = res.data?.data ?? [];
  if (!res.ok) { console.error(`Kapso error ${res.status}`); process.exit(1); }
  for (const h of hooks) console.log(`${h.id}  ${h.active ? 'active' : 'inactive'}  ${h.url}  [${(h.events ?? []).join(', ')}]`);
  if (!hooks.length) console.log('No webhooks yet.');
  process.exit(0);
}

const appUrl = need('APP_URL').replace(/\/+$/, '');
if (!appUrl.startsWith('https://')) {
  console.error('APP_URL must be a public https URL (deploy first, or use a tunnel such as ngrok for local testing).');
  process.exit(1);
}

const res = await kapso(base, {
  method: 'POST',
  body: JSON.stringify({
    whatsapp_webhook: {
      url: `${appUrl}/api/whatsapp/webhook`,
      events: ['whatsapp.message.received', 'whatsapp.message.sent', 'whatsapp.message.delivered', 'whatsapp.message.read', 'whatsapp.message.failed'],
      kind: 'kapso',
      payload_version: 'v2',
      buffer_enabled: false,
      active: true
    }
  })
});

if (!res.ok) {
  console.error(`Kapso error ${res.status}: ${JSON.stringify(res.data?.error ?? res.data).slice(0, 300)}`);
  process.exit(1);
}
const hook = res.data?.data ?? res.data;
const secret = hook?.secret_key ?? hook?.secret;
console.log(`Webhook created: ${hook?.id} → ${appUrl}/api/whatsapp/webhook`);
if (secret) {
  writeEnvValue('KAPSO_WEBHOOK_SECRET', secret);
  console.log('Signing secret saved to .env.local as KAPSO_WEBHOOK_SECRET. Copy it to your hosting environment variables too.');
} else {
  console.log('No secret in the response — copy the webhook secret from the Kapso dashboard into KAPSO_WEBHOOK_SECRET.');
}
