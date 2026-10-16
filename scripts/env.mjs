// Minimal .env.local / .env loader for the CLI scripts (no dependencies).
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    const p = path.join(ROOT, file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

export function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Set it in .env.local (see .env.example).`);
    process.exit(1);
  }
  return v;
}

/** Set KEY=value in .env.local without printing the value. */
export function writeEnvValue(name, value) {
  const p = path.join(ROOT, '.env.local');
  const text = existsSync(p) ? readFileSync(p, 'utf8') : '';
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, 'm');
  writeFileSync(p, re.test(text) ? text.replace(re, line) : `${text.replace(/\s*$/, '')}\n${line}\n`, { mode: 0o600 });
}

export async function kapso(pathname, init = {}) {
  const base = need('KAPSO_API_BASE_URL').replace(/\/+$/, '');
  if (!base.startsWith('https://')) throw new Error('KAPSO_API_BASE_URL must be https');
  const res = await fetch(`${base}${pathname}`, {
    ...init,
    headers: { 'X-API-Key': need('KAPSO_API_KEY'), 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    redirect: 'error'
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 500) }; }
  return { ok: res.ok, status: res.status, data };
}
