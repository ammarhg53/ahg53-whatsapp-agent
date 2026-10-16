import { NextResponse } from 'next/server';
import { envProblems } from '@/lib/env';
import { sheet } from '@/lib/sheets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Setup check: lists the *names* of missing settings and whether the Sheet answers. No values are shown. */
export async function GET() {
  const problems = envProblems();
  if (problems.length) return NextResponse.json({ ok: false, missing_or_invalid: problems }, { status: 503 });
  // Shape check only (catches a hash damaged while pasting into Vercel); the value is never returned.
  const adminHashOk = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(process.env.ADMIN_PASSWORD_HASH?.trim() ?? '');
  try {
    await sheet.count('settings');
    return NextResponse.json({ ok: adminHashOk, sheet: 'connected', admin_password_hash: adminHashOk ? 'ok' : 'damaged — paste it again' });
  } catch (err) {
    return NextResponse.json({ ok: false, sheet: (err as Error).message.slice(0, 200) }, { status: 503 });
  }
}
