import Link from 'next/link';
import { sheet, type Where } from '@/lib/sheets';
import type { Contact } from '@/lib/types';
import { importContactsAction } from '../actions';
import { Consent, Flash, fmt, Score, type SearchParams } from '../ui';

export default async function Conversations({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.replace(/[^\p{L}\p{N} +]/gu, '').trim().slice(0, 40) : '';
  const paused = sp.paused === '1';

  const where: Where = {};
  if (q) {
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 4) where.wa_id = { op: 'ilike', value: digits };
    else where.name = { op: 'ilike', value: q };
  }
  if (paused) where.bot_paused = true;
  const contacts = await sheet.find<Contact>('contacts', where, { order: 'last_inbound_at', desc: true, limit: 200 });

  return (
    <div className="stack">
      <h1>Conversations</h1>
      <Flash msg={sp.msg} />
      <form className="row card">
        <input name="q" placeholder="Search name or number" defaultValue={q} style={{ flex: 1, minWidth: 180 }} />
        <label className="checks"><input type="checkbox" name="paused" value="1" defaultChecked={paused} />Waiting for me</label>
        <button className="btn">Search</button>
      </form>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Contact</th><th>Country</th><th>Status</th><th>Score</th><th>Marketing</th><th>Last message</th></tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/dashboard/conversations/${c.id}`}><b>{c.name ?? 'Unknown'}</b></Link>
                  <div className="muted">+{c.wa_id} · {c.lang}</div>
                  {c.bot_paused && <span className="badge paused">bot paused</span>}
                  {c.tags?.map((t) => <span key={t} className="badge" style={{ marginLeft: 4 }}>{t}</span>)}
                </td>
                <td>{c.country ?? '—'}</td>
                <td>{c.status}</td>
                <td><Score score={c.lead_score} /></td>
                <td><Consent optedIn={c.marketing_opt_in} optedOut={c.opted_out} /></td>
                <td>{fmt(c.last_inbound_at)}</td>
              </tr>
            ))}
            {!contacts.length && <tr><td colSpan={6} className="muted">No conversations yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <details className="card">
        <summary><b>Import opted-in contacts</b></summary>
        <form action={importContactsAction} className="stack" style={{ marginTop: 12 }}>
          <p className="muted">Only add people who agreed to receive WhatsApp messages from AHG53. One per line: <code>phone,name,country</code> (phone with country code). Numbers that sent STOP are skipped.</p>
          <textarea name="rows" placeholder={'971501234567,Aisha,UAE\n447700900123,James,UK'} rows={6} />
          <label>Where did consent come from?<input name="source" placeholder="e.g. website form, event sign-up sheet" required maxLength={40} /></label>
          <label className="checks"><input type="checkbox" name="consent" required />These people gave consent to receive WhatsApp marketing</label>
          <button className="btn primary">Import</button>
        </form>
      </details>
    </div>
  );
}
