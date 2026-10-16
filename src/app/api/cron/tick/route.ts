import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';
import { sheet } from '@/lib/sheets';
import { processCampaigns } from '@/lib/campaigns';
import { processSequences, enrollReengagement, nudgeUnfinishedQuotes } from '@/lib/sequences';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const expected = env().CRON_SECRET;
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** Runs every 5 minutes: campaigns, follow-up sequences, quote nudges, housekeeping. */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const deadline = Date.now() + 45_000;
  const result: Record<string, unknown> = {};
  for (const [name, job] of [
    ['campaigns', () => processCampaigns(deadline)],
    ['reengage_enrolled', () => enrollReengagement()],
    ['sequences', () => processSequences(deadline)],
    ['quote_nudges', () => nudgeUnfinishedQuotes()],
    ['housekeeping', () => sheet.call('cleanup', { keepDays: 60 })]
  ] as const) {
    try {
      result[name] = await job();
    } catch (err) {
      result[name] = 'error';
      log.error(`cron ${name} failed`, { error: (err as Error).message });
    }
  }
  await sheet.drain();
  return NextResponse.json(result);
}

export const POST = GET;
