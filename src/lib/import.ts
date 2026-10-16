import 'server-only';
import { sheet } from './sheets';
import { suppressedSet } from './consent';
import type { Contact } from './types';

export type ImportRow = { wa_id: string; name: string | null; country: string | null; tags?: string[] };

/**
 * Add contacts who already gave marketing consent, recording when and from where.
 * Numbers that sent STOP (or asked for deletion) are never re-subscribed.
 */
export async function importOptedIn(rows: ImportRow[], source: string) {
  const unique = [...new Map(rows.map((r) => [r.wa_id, r])).values()];
  const [existing, suppressed] = await Promise.all([
    sheet.find<Contact>('contacts', { wa_id: { op: 'in', value: unique.map((r) => r.wa_id) } }),
    suppressedSet(unique.map((r) => r.wa_id))
  ]);
  const byWa = new Map(existing.map((c) => [c.wa_id, c]));
  const at = new Date().toISOString();
  const consent = { marketing_opt_in: true, opt_in_at: at, opt_in_source: source.slice(0, 60) };

  let skippedOptedOut = 0;
  let optedIn = 0;
  const fresh: Record<string, unknown>[] = [];
  for (const r of unique) {
    const c = byWa.get(r.wa_id);
    if (c?.opted_out || suppressed.has(r.wa_id)) {
      skippedOptedOut++;
      continue;
    }
    if (c) {
      if (!c.marketing_opt_in) {
        void sheet.update('contacts', { id: c.id }, { ...consent, ...(r.tags?.length ? { tags: [...new Set([...c.tags, ...r.tags])] } : {}) });
        optedIn++;
      }
      continue;
    }
    fresh.push({ wa_id: r.wa_id, name: r.name, country: r.country, tags: r.tags ?? [], ...consent, updated_at: at });
  }
  let added = 0;
  for (let i = 0; i < fresh.length; i += 400) {
    added += await sheet.insertMany('contacts', fresh.slice(i, i + 400), { ignoreConflict: true });
  }
  await sheet.drain();
  return { added, optedIn, skippedOptedOut };
}
