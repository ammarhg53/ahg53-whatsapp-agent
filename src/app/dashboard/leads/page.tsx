import Link from 'next/link';
import { sheet, type Where } from '@/lib/sheets';
import type { Contact, Lead } from '@/lib/types';
import { setLeadStatusAction } from '../actions';
import { fmt, Score, type SearchParams } from '../ui';

const SCORES = ['hot', 'warm', 'cold'];
const STATUSES = ['in_progress', 'complete', 'won', 'lost', 'abandoned'];

export default async function Leads({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const score = typeof sp.score === 'string' && SCORES.includes(sp.score) ? sp.score : '';
  const status = typeof sp.status === 'string' && STATUSES.includes(sp.status) ? sp.status : '';

  const where: Where = {};
  if (score) where.score = score;
  if (status) where.status = status;
  const rows = await sheet.find<Lead>('leads', where, { order: 'created_at', desc: true, limit: 200 });
  const people = rows.length ? await sheet.find<Contact>('contacts', { id: { op: 'in', value: [...new Set(rows.map((l) => l.contact_id))] } }) : [];
  const leads = rows.map((l) => ({ ...l, contacts: people.find((c) => c.id === l.contact_id) }));

  return (
    <div className="stack">
      <h1>Leads</h1>
      <form className="row card">
        <label>Score
          <select name="score" defaultValue={score}><option value="">All</option>{SCORES.map((s) => <option key={s}>{s}</option>)}</select>
        </label>
        <label>Status
          <select name="status" defaultValue={status}><option value="">All</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        </label>
        <button className="btn">Filter</button>
      </form>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Lead</th><th>Location</th><th>Service</th><th>Budget</th><th>Timeline</th><th>Score</th><th>Status</th><th /></tr></thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id}>
                <td>
                  <Link href={`/dashboard/conversations/${l.contacts?.id}`}><b>{l.name ?? l.contacts?.name ?? 'Unknown'}</b></Link>
                  <div className="muted">{l.business_name || ''} · {fmt(l.created_at)}</div>
                  {l.campaign_id && <span className="badge">from campaign</span>}
                </td>
                <td>{l.location ?? '—'}</td><td>{l.service ?? '—'}</td><td>{l.budget ?? '—'}</td><td>{l.deadline ?? '—'}</td>
                <td><Score score={l.score} /></td>
                <td>{l.status}</td>
                <td>
                  {['complete', 'won', 'lost'].includes(l.status) && (
                    <div className="row">
                      <a href={`/api/admin/leads/${l.id}/pdf`} target="_blank">PDF</a>
                      {(['won', 'lost'] as const).filter((s) => s !== l.status).map((s) => (
                        <form key={s} action={setLeadStatusAction}>
                          <input type="hidden" name="leadId" value={l.id} />
                          <input type="hidden" name="status" value={s} />
                          <button className="btn">{s}</button>
                        </form>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!leads.length && <tr><td colSpan={8} className="muted">No leads yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
