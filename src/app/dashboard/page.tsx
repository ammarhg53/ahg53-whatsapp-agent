import Link from 'next/link';
import { sheet } from '@/lib/sheets';
import type { Contact } from '@/lib/types';
import { quotaStatus } from '@/lib/quota';
import { fmt, Score } from './ui';

export default async function Overview() {
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const [q, openHandoffs, leads, contactCount, optedIn] = await Promise.all([
    quotaStatus(),
    sheet.find<{ id: string; contact_id: string; summary: string; created_at: string }>('handoffs', { status: 'open' }, { order: 'created_at', desc: true, limit: 20 }),
    sheet.find<{ score: string | null }>('leads', { completed_at: { op: 'gte', value: weekAgo } }),
    sheet.count('contacts'),
    sheet.count('contacts', { marketing_opt_in: true, opted_out: false })
  ]);
  const handoffContacts = openHandoffs.length
    ? await sheet.find<Contact>('contacts', { id: { op: 'in', value: openHandoffs.map((h) => h.contact_id) } })
    : [];
  const handoffs = openHandoffs.map((h) => ({ ...h, contacts: handoffContacts.find((c) => c.id === h.contact_id) }));
  const byScore = (s: string) => leads.filter((l) => l.score === s).length;
  const pct = q.limit ? Math.min(100, Math.round((q.used / q.limit) * 100)) : 100;

  return (
    <div className="stack">
      <h1>Overview</h1>

      <section className="card">
        <div className="row spread">
          <h2>Messages this month ({q.month})</h2>
          <span><b>{q.used}</b> / {q.limit}</span>
        </div>
        <div className="quota"><span style={{ width: `${pct}%` }} /></div>
        <p className="muted">
          {q.remaining} left · {q.marketingRemaining} available for marketing ({q.reserve} kept for customer replies).
          Every bot reply, AI reply, alert and campaign message counts.
        </p>
      </section>

      <div className="grid">
        <div className="card"><div className="muted">Waiting for you</div><div className="stat">{handoffs.length}</div></div>
        <div className="card"><div className="muted">Quotes (7 days)</div><div className="stat">{leads.length}</div>
          <div className="row"><Score score="hot" /> {byScore('hot')} <Score score="warm" /> {byScore('warm')} <Score score="cold" /> {byScore('cold')}</div></div>
        <div className="card"><div className="muted">Contacts</div><div className="stat">{contactCount}</div></div>
        <div className="card"><div className="muted">Opted in to marketing</div><div className="stat">{optedIn}</div></div>
      </div>

      <section className="card">
        <h2>Chats waiting for you</h2>
        {!handoffs.length && <p className="muted">Nothing waiting. 🎉</p>}
        {handoffs.map((h) => (
          <div key={h.id} className="card">
            <div className="row spread">
              <Link href={`/dashboard/conversations/${h.contacts?.id}`}><b>{h.contacts?.name ?? 'Unknown'}</b> +{h.contacts?.wa_id}</Link>
              <span className="muted">{fmt(h.created_at)}</span>
            </div>
            <p style={{ whiteSpace: 'pre-wrap' }} className="muted">{h.summary}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
