import { NextResponse, type NextRequest } from 'next/server';
import { sheet } from '@/lib/sheets';
import { BUSINESS } from '@/lib/business.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SAFE_URL = /^https:\/\/[^\s"'<>]+$/;

/** Click tracking for template URL buttons: /r/<track_code> → campaign link (or the website). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  let target: string = BUSINESS.website;
  if (/^[0-9a-f]{12}$/.test(code)) {
    const r = await sheet.first<{ id: string; campaign_id: string; clicked_at: string | null }>('campaign_recipients', { track_code: code }).catch(() => null);
    if (r) {
      const [campaign] = await Promise.all([
        sheet.first<{ link_url: string | null }>('campaigns', { id: r.campaign_id }),
        r.clicked_at ? null : sheet.update('campaign_recipients', { id: r.id }, { clicked_at: new Date().toISOString() })
      ]).catch(() => [null]);
      const link = campaign?.link_url;
      if (link && SAFE_URL.test(link)) target = link;
    }
  }
  return NextResponse.redirect(target, 302);
}
