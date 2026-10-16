import { NextResponse } from 'next/server';
import { envProblems } from '@/lib/env';
import { sheet } from '@/lib/sheets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Setup check: lists the *names* of missing settings and whether the Sheet answers. No values are shown. */
export async function GET() {
  const problems = envProblems();
  if (problems.length) return NextResponse.json({ ok: false, missing_or_invalid: problems }, { status: 503 });
  try {
    await sheet.count('settings');
    return NextResponse.json({ ok: true, sheet: 'connected' });
  } catch (err) {
    return NextResponse.json({ ok: false, sheet: (err as Error).message.slice(0, 200) }, { status: 503 });
  }
}
