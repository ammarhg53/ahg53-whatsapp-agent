/** Mask a phone number for logs: 918866475352 → 91******5352 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '-';
  const d = String(phone).replace(/\D/g, '');
  if (d.length <= 6) return '***';
  return d.slice(0, 2) + '*'.repeat(d.length - 6) + d.slice(-4);
}

const SECRET_KEYS = /(token|secret|key|password|authorization|signature)/i;
const LONG_DIGITS = /\b\d{8,15}\b/g;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[depth]';
  if (typeof value === 'string') return value.replace(LONG_DIGITS, (m) => maskPhone(m)).slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.test(k) ? '[redacted]' : scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Structured logger that redacts secrets and masks phone numbers. */
export const log = {
  info: (msg: string, data?: Record<string, unknown>) => console.log(JSON.stringify({ level: 'info', msg, ...(scrub(data ?? {}) as object) })),
  warn: (msg: string, data?: Record<string, unknown>) => console.warn(JSON.stringify({ level: 'warn', msg, ...(scrub(data ?? {}) as object) })),
  error: (msg: string, data?: Record<string, unknown>) => console.error(JSON.stringify({ level: 'error', msg, ...(scrub(data ?? {}) as object) }))
};
