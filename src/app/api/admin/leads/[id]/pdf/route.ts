import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { sheet } from '@/lib/sheets';
import { env } from '@/lib/env';
import { SESSION_COOKIE, verifySession } from '@/lib/session';
import { BUSINESS } from '@/lib/business.ts';

export const runtime = 'nodejs';

const RED = rgb(0.843, 0.149, 0.118);
const YELLOW = rgb(1, 0.776, 0.102);
const GREY = rgb(0.42, 0.4, 0.37);

// Standard PDF fonts only cover WinAnsi; drop anything else (emoji, Devanagari).
const safe = (s: string | null | undefined) => (s ?? '-').replace(/[–—]/g, '-').replace(/[^\x20-\x7E -ÿ]/g, '');

/** A branded quote-request PDF Ammar can fill in and send. Admin only. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifySession((await cookies()).get(SESSION_COOKIE)?.value))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const lead = await sheet.first<any>('leads', { id });
  if (!lead) return NextResponse.json({ error: 'not found' }, { status: 404 });
  lead.contacts = await sheet.first<{ wa_id: string; name: string | null }>('contacts', { id: lead.contact_id });

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({ x: 0, y: 762, width: 595, height: 80, color: RED });
  page.drawRectangle({ x: 0, y: 756, width: 595, height: 6, color: YELLOW });
  let textX = 40;
  try {
    const res = await fetch(`${env().APP_URL}/logo.png`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const bytes = await res.arrayBuffer();
      // WhatsApp profile photos are often JPEGs even when saved as .png
      const logo = await pdf.embedPng(bytes).catch(() => pdf.embedJpg(bytes));
      page.drawImage(logo, { x: 40, y: 772, width: 60, height: 60 });
      textX = 112;
    }
  } catch { /* logo is optional */ }
  page.drawText(BUSINESS.brand, { x: textX, y: 808, size: 22, font: bold, color: rgb(1, 1, 1) });
  page.drawText(BUSINESS.tagline, { x: textX, y: 788, size: 11, font, color: rgb(1, 1, 1) });

  let y = 715;
  page.drawText('Quotation', { x: 40, y, size: 20, font: bold, color: RED });
  page.drawText(`Date: ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`, { x: 400, y, size: 10, font, color: GREY });
  y -= 36;

  const rows: [string, string | null][] = [
    ['Client', lead.name ?? lead.contacts?.name],
    ['Business', lead.business_name || '-'],
    ['Location', lead.location],
    ['WhatsApp', lead.contacts?.wa_id ? `+${lead.contacts.wa_id}` : '-'],
    ['Service', lead.service],
    ['Budget range', lead.budget],
    ['Timeline', lead.deadline]
  ];
  for (const [label, value] of rows) {
    page.drawText(label, { x: 40, y, size: 11, font: bold });
    page.drawText(safe(value), { x: 160, y, size: 11, font });
    y -= 22;
  }

  y -= 16;
  page.drawText('Scope & price', { x: 40, y, size: 14, font: bold, color: RED });
  y -= 10;
  for (let i = 0; i < 8; i++) {
    y -= 26;
    page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.5, color: GREY });
  }
  y -= 40;
  page.drawText('Total: ______________________', { x: 340, y, size: 12, font: bold });

  page.drawRectangle({ x: 0, y: 0, width: 595, height: 50, color: RED });
  page.drawText(`${BUSINESS.phone}  |  ${BUSINESS.founderEmail}  |  ${BUSINESS.website.replace('https://', '')}`, { x: 40, y: 20, size: 10, font, color: rgb(1, 1, 1) });

  const bytes = await pdf.save();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="AHG53-quote-${id.slice(0, 8)}.pdf"`,
      'Cache-Control': 'private, no-store'
    }
  });
}
