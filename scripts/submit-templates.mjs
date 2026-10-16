// Submits the WhatsApp templates in templates/*.json to Meta (through Kapso) for approval.
//
// Usage: npm run templates:submit                  (all)
//        npm run templates:submit -- --only ahg_offer
//        npm run templates:submit -- --dry-run      (print what would be sent)
//
// "{{APP_URL}}" inside button URLs is replaced with APP_URL so tracked links point at this app.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv, need, kapso, ROOT } from './env.mjs';

loadEnv();
const dry = process.argv.includes('--dry-run');
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null;
const waba = need('KAPSO_WABA_ID');
const appUrl = need('APP_URL').replace(/\/+$/, '');
const version = process.env.META_GRAPH_VERSION || 'v24.0';

const dir = path.join(ROOT, 'templates');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
let failures = 0;

// Image templates need a sample picture for Meta's review (customers get the picture you choose per campaign).
// Default sample: the dashboard logo served by the app; override with --example-image https://...
const exIdx = process.argv.indexOf('--example-image');
const exampleImage = exIdx > -1 ? process.argv[exIdx + 1] : `${appUrl}/logo.png`;
let exampleHandle = null;
async function getExampleHandle() {
  if (exampleHandle) return exampleHandle;
  const up = await kapso('/platform/v1/whatsapp/media', {
    method: 'POST',
    body: JSON.stringify({ media_ingest: { phone_number_id: need('KAPSO_PHONE_NUMBER_ID'), source: exampleImage, delivery: 'meta_resumable_asset' } })
  });
  exampleHandle = up.data?.data?.target?.handle;
  if (!up.ok || !exampleHandle) throw new Error(`sample image upload failed (${up.status}): ${JSON.stringify(up.data?.error ?? up.data).slice(0, 200)}`);
  return exampleHandle;
}

for (const file of files) {
  let raw = readFileSync(path.join(dir, file), 'utf8').replaceAll('{{APP_URL}}', appUrl);
  if (raw.includes('{{EXAMPLE_IMAGE_HANDLE}}') && !dry && (!only || raw.includes(`"name": "${only}"`))) {
    try {
      raw = raw.replaceAll('{{EXAMPLE_IMAGE_HANDLE}}', await getExampleHandle());
    } catch (err) {
      failures++;
      console.log(`✗ ${file} → ${err.message}`);
      continue;
    }
  }
  const tpl = JSON.parse(raw);
  if (only && tpl.name !== only) continue;
  const label = `${tpl.name} (${tpl.language}, ${tpl.category})`;
  if (dry) {
    console.log(`--- ${label}\n${JSON.stringify(tpl, null, 2)}`);
    continue;
  }
  const res = await kapso(`/meta/whatsapp/${version}/${waba}/message_templates`, { method: 'POST', body: JSON.stringify(tpl) });
  if (res.ok) {
    console.log(`✓ ${label} → ${res.data?.status ?? 'submitted'}`);
  } else {
    failures++;
    const e = res.data?.error ?? res.data;
    console.log(`✗ ${label} → ${res.status}: ${e?.error_user_msg ?? e?.message ?? JSON.stringify(e).slice(0, 200)}`);
  }
}
if (!dry) console.log('\nApproval usually takes minutes to a day. Then open Dashboard → Templates → Sync.');
process.exit(failures ? 1 : 0);
