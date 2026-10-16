import 'server-only';
import { z } from 'zod';

const schema = z.object({
  APP_URL: z.string().url().transform((u) => u.replace(/\/+$/, '')),
  KAPSO_API_BASE_URL: z.string().url().default('https://api.kapso.ai'),
  KAPSO_API_KEY: z.string().min(10),
  KAPSO_PHONE_NUMBER_ID: z.string().regex(/^\d+$/),
  KAPSO_WABA_ID: z.string().regex(/^\d+$/),
  KAPSO_WEBHOOK_SECRET: z.string().min(8),
  META_GRAPH_VERSION: z.string().default('v24.0'),
  APPS_SCRIPT_URL: z.string().url().refine(
    (u) => u.startsWith('https://script.google.com/') || (process.env.ALLOW_LOCAL_SHEETS === '1' && u.startsWith('http://127.0.0.1:')),
    'must be the Apps Script /exec URL'
  ),
  APPS_SCRIPT_SECRET: z.string().min(24),
  ADMIN_PASSWORD_HASH: z.string().startsWith('$2'),
  SESSION_SECRET: z.string().min(32),
  PHONE_HASH_SALT: z.string().min(16),
  ADMIN_WHATSAPP: z.string().regex(/^\d{7,15}$/),
  RESEND_API_KEY: z.string().optional(),
  ALERT_EMAIL_TO: z.string().email().optional(),
  ALERT_EMAIL_FROM: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-opus-5-5'),
  CRON_SECRET: z.string().min(16),
  OPTIN_ALLOWED_ORIGINS: z.string().default('')
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

function parse() {
  const blankToUndefined = Object.fromEntries(
    Object.entries(process.env).map(([k, v]) => [k, v === '' ? undefined : v?.trim()])
  );
  return schema.safeParse(blankToUndefined);
}

/** Names (never values) of environment variables that are missing or invalid. */
export function envProblems(): string[] {
  const parsed = parse();
  return parsed.success ? [] : [...new Set(parsed.error.issues.map((i) => i.path.join('.')))];
}

/** Validated server environment. Throws with the names (never values) of bad vars. */
export function env(): Env {
  if (cached) return cached;
  const parsed = parse();
  if (!parsed.success) {
    throw new Error(`Invalid or missing environment variables: ${envProblems().join(', ')}`);
  }
  cached = parsed.data;
  return cached;
}
