// Imports your opted-in number list into the Google Sheet.
//
// Usage:
//   npm run import:contacts -- numbers.csv --source "existing clients, agreed on WhatsApp"
//   npm run import:contacts -- numbers.csv --source "..." --default-cc 91 --tag clients --dry-run
//
// The file can be CSV (Excel → Save As → CSV) or plain text with one number per line.
// A header row is detected automatically (phone / number / mobile / whatsapp, name, country, tags).
// Numbers without a country code: pass --default-cc (e.g. 91 for India, 971 for UAE).
// Only import people who agreed to receive WhatsApp messages from AHG53.
// Numbers that sent STOP or asked for deletion are never re-subscribed.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadEnv, need } from './env.mjs';

loadEnv();
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i > -1 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const source = flag('source');
const defaultCc = (flag('default-cc') ?? '').replace(/\D/g, '');
const extraTag = flag('tag');
const dry = args.includes('--dry-run');

if (!file || !source) {
  console.error('Usage: npm run import:contacts -- <file.csv> --source "where consent came from" [--default-cc 91] [--tag clients] [--dry-run]');
  process.exit(1);
}

// ---------------------------------------------------------------- parse
function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',' || ch === ';' || ch === '\t') { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const lines = readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
let cols = { phone: 0, name: -1, country: -1, tags: -1 };
const head = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
const hasHeader = head.some((h) => /phone|number|mobile|whatsapp|contact/.test(h));
if (hasHeader) {
  const find = (re) => head.findIndex((h) => re.test(h));
  cols = { phone: find(/phone|number|mobile|whatsapp|contact/), name: find(/name/), country: find(/country/), tags: find(/tag/) };
  lines.shift();
}

function normalize(raw) {
  let d = String(raw ?? '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (defaultCc && d.length <= 10) d = defaultCc + d.replace(/^0+/, '');
  return /^\d{10,15}$/.test(d) ? d : null;
}

const rows = new Map();
const invalid = [];
for (const line of lines) {
  const c = parseCsvLine(line);
  const wa = normalize(c[cols.phone]);
  if (!wa) { invalid.push(c[cols.phone] ?? line); continue; }
  if (rows.has(wa)) continue; // first occurrence wins
  const tags = [...(cols.tags > -1 && c[cols.tags] ? c[cols.tags].split(/[|/]/).map((t) => t.trim().toLowerCase()).filter(Boolean) : []), ...(extraTag ? [extraTag.toLowerCase()] : [])];
  rows.set(wa, { wa_id: wa, name: cols.name > -1 ? (c[cols.name] || null)?.slice(0, 60) ?? null : null, country: cols.country > -1 ? (c[cols.country] || null)?.slice(0, 60) ?? null : null, tags });
}
console.log(`Read ${lines.length} rows → ${rows.size} unique valid numbers, ${invalid.length} invalid.`);
if (invalid.length) console.log(`Invalid (first 10): ${invalid.slice(0, 10).join(', ')}${defaultCc ? '' : '  ← numbers without country code? use --default-cc 91'}`);
if (dry) {
  console.log('Dry run — first 5:', [...rows.values()].slice(0, 5));
  process.exit(0);
}

// ---------------------------------------------------------------- write to the Sheet
const url = need('APPS_SCRIPT_URL');
const secret = need('APPS_SCRIPT_SECRET');
const salt = need('PHONE_HASH_SALT');
const hash = (wa) => createHash('sha256').update(`${salt}:${wa}`).digest('hex');

async function call(ops) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ secret, ops }), redirect: 'follow' });
  const body = JSON.parse(await res.text());
  if (body.error) throw new Error(body.error);
  return body.results.map((r) => { if (!r.ok) throw new Error(r.error); return r.data; });
}

const all = [...rows.values()];
const [existing, suppressed] = await call([
  { op: 'find', table: 'contacts', where: { wa_id: { op: 'in', value: all.map((r) => r.wa_id) } } },
  { op: 'find', table: 'suppression', where: { phone_hash: { op: 'in', value: all.map((r) => hash(r.wa_id)) } } }
]);
const byWa = new Map(existing.map((c) => [c.wa_id, c]));
const blocked = new Set(suppressed.map((s) => s.phone_hash));
const at = new Date().toISOString();
const consent = { marketing_opt_in: true, opt_in_at: at, opt_in_source: `import:${source}`.slice(0, 60) };

let skipped = 0;
const updates = [];
const fresh = [];
for (const r of all) {
  const c = byWa.get(r.wa_id);
  if (c?.opted_out || blocked.has(hash(r.wa_id))) { skipped++; continue; }
  if (c) {
    if (!c.marketing_opt_in) updates.push({ op: 'update', table: 'contacts', where: { id: c.id }, patch: { ...consent, tags: [...new Set([...(c.tags ?? []), ...r.tags])] } });
  } else {
    fresh.push({ ...r, ...consent, updated_at: at });
  }
}
for (let i = 0; i < updates.length; i += 150) await call(updates.slice(i, i + 150));
let added = 0;
for (let i = 0; i < fresh.length; i += 400) {
  const [res] = await call([{ op: 'insert', table: 'contacts', rows: fresh.slice(i, i + 400), ignoreConflict: true }]);
  added += res.rows.length;
}
console.log(`Done: ${added} added, ${updates.length} existing contacts opted in, ${skipped} skipped (sent STOP / deleted).`);
