import 'server-only';
import { sheet } from './sheets';
import { DEFAULT_HOURS, type BusinessHours } from './hours.ts';

export type SequenceStep = { day: number; template: string };

export type Settings = {
  monthly_message_limit: number;
  service_reserve: number;
  ai_enabled: boolean;
  ai_max_tokens: number;
  business_hours: BusinessHours;
  reengage_enabled: boolean;
  post_quote_sequence: SequenceStep[];
};

export const DEFAULT_SETTINGS: Settings = {
  monthly_message_limit: 2000,
  service_reserve: 300,
  ai_enabled: true,
  ai_max_tokens: 1024,
  business_hours: DEFAULT_HOURS,
  reengage_enabled: false,
  post_quote_sequence: [
    { day: 1, template: 'ahg_quote_followup' },
    { day: 3, template: 'ahg_quote_followup_2' },
    { day: 7, template: 'ahg_reengage' }
  ]
};

let cache: { at: number; value: Settings } | null = null;

/** Merge raw key → value pairs from the Sheet over the defaults and cache for 30 s. */
export function primeSettings(raw: Record<string, unknown>): Settings {
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const [k, v] of Object.entries(raw)) if (k in DEFAULT_SETTINGS && v !== null) merged[k] = v;
  cache = { at: Date.now(), value: merged as Settings };
  return cache.value;
}

export async function getSettings(fresh = false): Promise<Settings> {
  if (!fresh && cache && Date.now() - cache.at < 30_000) return cache.value;
  const rows = await sheet.find<{ key: string; value: unknown }>('settings');
  return primeSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}

export async function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  await sheet.upsert('settings', { key, value }, ['key']);
  cache = null;
}
