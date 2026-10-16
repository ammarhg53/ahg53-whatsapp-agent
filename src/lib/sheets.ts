import 'server-only';
import { env } from './env';
import { log } from './log';

// Client for the Google Sheets database (apps-script/Code.gs).
//
// Every Apps Script call takes ~1 s, so operations are queued and sent together:
// everything issued in the same tick goes out as one request, and requests run one
// after another so writes always land in the order they were made. Writes that the
// caller doesn't need to wait for can be fired without `await`; call `drain()` before
// the request ends to make sure they reached the Sheet.

export type Table =
  | 'contacts' | 'messages' | 'leads' | 'handoffs' | 'suppression' | 'templates'
  | 'campaigns' | 'campaign_recipients' | 'sequence_enrollments' | 'settings' | 'quota_usage';

type Op = { op: string; table?: Table; [k: string]: unknown };
type Filter =
  | { op: 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'lt_or_null' | 'endswith' | 'ilike'; value: string | number }
  | { op: 'in' | 'nin' | 'overlaps'; value: (string | number)[] }
  | { op: 'null' | 'notnull' };
export type Where = Record<string, string | number | boolean | null | Filter>;
export type FindOpts = { order?: string; desc?: boolean; limit?: number; offset?: number };

export class SheetError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

type Pending = { op: Op; resolve: (v: any) => void; reject: (e: Error) => void };
let queue: Pending[] = [];
let scheduled = false;
let chain: Promise<void> = Promise.resolve();

async function post(ops: Op[]): Promise<{ ok: boolean; data?: unknown; error?: string; code?: string }[]> {
  const e = env();
  const res = await fetch(e.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // Apps Script reads the raw body
    body: JSON.stringify({ secret: e.APPS_SCRIPT_SECRET, ops }),
    redirect: 'follow', // Apps Script answers via a redirect to googleusercontent.com
    signal: AbortSignal.timeout(40_000),
    cache: 'no-store'
  });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    throw new SheetError(`Sheets API returned non-JSON (HTTP ${res.status}) — check APPS_SCRIPT_URL and the web app deployment`);
  }
  if (body.error) throw new SheetError(`Sheets API: ${body.error}`, body.error);
  return body.results;
}

function flush() {
  scheduled = false;
  const batch = queue;
  queue = [];
  if (!batch.length) return;
  chain = chain.then(async () => {
    try {
      const results = await post(batch.map((p) => p.op));
      batch.forEach((p, i) => {
        const r = results[i];
        if (r?.ok) p.resolve(r.data);
        else p.reject(new SheetError(r?.error ?? 'no result', r?.code));
      });
    } catch (err) {
      batch.forEach((p) => p.reject(err as Error));
    }
  });
}

function enqueue<T>(op: Op): Promise<T> {
  const p = new Promise<T>((resolve, reject) => queue.push({ op, resolve, reject }));
  if (!scheduled) {
    scheduled = true;
    setImmediate(flush);
  }
  // Unawaited writes must not crash the process; awaited callers still see the error.
  p.catch((err: SheetError) => log.error('sheet op failed', { op: op.op, table: op.table, error: err.message, code: err.code }));
  return p;
}

export const sheet = {
  find: <T = any>(table: Table, where: Where = {}, opts: FindOpts = {}) => enqueue<T[]>({ op: 'find', table, where, ...opts }),

  first: async <T = any>(table: Table, where: Where = {}, opts: FindOpts = {}): Promise<T | null> =>
    (await enqueue<T[]>({ op: 'find', table, where, ...opts, limit: 1 }))[0] ?? null,

  count: (table: Table, where: Where = {}) => enqueue<number>({ op: 'count', table, where }),

  /** Insert rows; ids, timestamps and defaults are filled in by the Sheet. */
  insert: async <T = any>(table: Table, row: Record<string, unknown>, opts: { ignoreConflict?: boolean } = {}) => {
    const r = await enqueue<{ rows: T[]; conflicts: T[] }>({ op: 'insert', table, rows: [row], ignoreConflict: !!opts.ignoreConflict });
    return { row: (r.rows[0] ?? r.conflicts[0]) as T, conflict: r.conflicts.length > 0 };
  },

  insertMany: async (table: Table, rows: Record<string, unknown>[], opts: { ignoreConflict?: boolean } = {}) =>
    (await enqueue<{ rows: unknown[] }>({ op: 'insert', table, rows, ignoreConflict: !!opts.ignoreConflict })).rows.length,

  update: (table: Table, where: Where, patch: Record<string, unknown>) => enqueue<number>({ op: 'update', table, where, patch }),

  upsert: (table: Table, row: Record<string, unknown>, key: string[]) => enqueue<string>({ op: 'upsert', table, row, key }),

  /** Delete matching rows. Deleting a contact also deletes its messages, leads, handoffs, recipients and enrolments. */
  remove: (table: Table, where: Where) => enqueue<number>({ op: 'remove', table, where }),

  call: <T = any>(op: string, args: Record<string, unknown> = {}) => enqueue<T>({ op, ...args }),

  /** Wait until every queued operation has reached the Sheet. */
  drain: async () => {
    while (queue.length || scheduled) {
      flush();
      await chain;
    }
    await chain;
  }
};
