import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sheet } from '@/lib/sheets';
import {
  deleteContactAction, pauseBotAction, resumeBotAction, sendManualReplyAction,
  sendProjectUpdateAction, setMarketingAction, updateContactAction
} from '../../actions';
import { Consent, Flash, fmt, Score, type SearchParams } from '../../ui';
import type { Contact, Lead } from '@/lib/types';

export default async function ConversationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const [contact, messages, leads] = await Promise.all([
    sheet.first<Contact>('contacts', { id }),
    sheet.find<{ id: string; direction: string; body: string | null; kind: string; status: string | null; created_at: string }>('messages', { contact_id: id }, { order: 'created_at', desc: true, limit: 100 }),
    sheet.find<Lead>('leads', { contact_id: id }, { order: 'created_at', desc: true })
  ]);
  if (!contact) notFound();
  const c = contact;
  const windowOpen = !!c.last_inbound_at && Date.now() - Date.parse(c.last_inbound_at) < 24 * 3600e3;

  return (
    <div className="stack">
      <Link href="/dashboard/conversations">← Conversations</Link>
      <div className="row spread">
        <h1>{c.name ?? 'Unknown'} <span className="muted">+{c.wa_id}</span></h1>
        <div className="row">
          <Score score={c.lead_score} />
          <Consent optedIn={c.marketing_opt_in} optedOut={c.opted_out} />
          {c.bot_paused ? <span className="badge paused">bot paused</span> : <span className="badge good">bot active</span>}
        </div>
      </div>
      <Flash msg={sp.msg} />

      <section className="card row spread">
        <div>
          {c.bot_paused
            ? <>Bot paused {fmt(c.paused_at)} — <i>{c.paused_reason}</i>. Reply here or in the Kapso inbox, then resume.</>
            : <>The bot is answering this chat.</>}
        </div>
        <form action={c.bot_paused ? resumeBotAction : pauseBotAction}>
          <input type="hidden" name="contactId" value={c.id} />
          <button className={`btn ${c.bot_paused ? 'primary' : ''}`}>{c.bot_paused ? 'Resume bot' : 'Pause bot'}</button>
        </form>
      </section>

      <section className="card">
        <h2>Chat</h2>
        <div className="chat">
          {[...messages].reverse().map((m) => (
            <div key={m.id} className={`bubble ${m.direction === 'inbound' ? 'in' : 'out'}`}>
              {m.body}
              <small>{fmt(m.created_at)}{m.direction === 'outbound' ? ` · ${m.kind} · ${m.status ?? ''}` : ''}</small>
            </div>
          ))}
          {!messages.length && <p className="muted">No messages.</p>}
        </div>
        <form action={sendManualReplyAction} className="stack" style={{ marginTop: 12 }}>
          <input type="hidden" name="contactId" value={c.id} />
          <textarea name="text" placeholder={windowOpen ? 'Type a reply (pauses the bot for this chat)' : '24-hour window closed — use a template'} disabled={!windowOpen} maxLength={4000} />
          <button className="btn primary" disabled={!windowOpen}>Send reply</button>
        </form>
      </section>

      <div className="grid">
        <section className="card">
          <h2>Details</h2>
          <form action={updateContactAction} className="stack">
            <input type="hidden" name="contactId" value={c.id} />
            <label>Status
              <select name="status" defaultValue={c.status}>
                {['new', 'lead', 'customer', 'lost'].map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label>Country<input name="country" defaultValue={c.country ?? ''} maxLength={60} /></label>
            <label>Tags (comma separated)<input name="tags" defaultValue={(c.tags ?? []).join(', ')} /></label>
            <p className="muted">Business: {c.business_name || '—'} · Language: {c.lang} · First seen {fmt(c.created_at)}</p>
            <button className="btn">Save</button>
          </form>
        </section>

        <section className="card">
          <h2>Marketing consent</h2>
          <p><Consent optedIn={c.marketing_opt_in} optedOut={c.opted_out} /></p>
          <p className="muted">
            {c.marketing_opt_in && <>Opted in {fmt(c.opt_in_at)} via <b>{c.opt_in_source}</b>.</>}
            {c.opted_out && <>Opted out {fmt(c.opted_out_at)}.</>}
          </p>
          <form action={setMarketingAction} className="stack">
            <input type="hidden" name="contactId" value={c.id} />
            {c.marketing_opt_in ? (
              <><input type="hidden" name="optIn" value="false" /><button className="btn danger">Mark as opted out</button></>
            ) : (
              <>
                <input type="hidden" name="optIn" value="true" />
                <label>Consent source<input name="source" placeholder="e.g. asked on call 17 Oct" maxLength={40} /></label>
                <button className="btn">Record opt-in</button>
              </>
            )}
          </form>
        </section>
      </div>

      <section className="card">
        <h2>Send project update (template)</h2>
        <form action={sendProjectUpdateAction} className="form-grid">
          <input type="hidden" name="contactId" value={c.id} />
          <label>Project name<input name="project" maxLength={60} required /></label>
          <label style={{ gridColumn: '1 / -1' }}>Update<textarea name="update" maxLength={600} required placeholder="e.g. Homepage design is ready for your review: https://..." /></label>
          <div><button className="btn yellow" disabled={c.opted_out}>Send update</button></div>
        </form>
      </section>

      <section className="card table-wrap">
        <h2>Quote requests</h2>
        <table>
          <thead><tr><th>Date</th><th>Service</th><th>Budget</th><th>Timeline</th><th>Score</th><th>Status</th><th /></tr></thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id}>
                <td>{fmt(l.created_at)}</td><td>{l.service ?? '—'}</td><td>{l.budget ?? '—'}</td><td>{l.deadline ?? '—'}</td>
                <td><Score score={l.score} /></td><td>{l.status}</td>
                <td>{l.status !== 'in_progress' && <a href={`/api/admin/leads/${l.id}/pdf`} target="_blank">Quote PDF</a>}</td>
              </tr>
            ))}
            {!leads.length && <tr><td colSpan={7} className="muted">No quote requests.</td></tr>}
          </tbody>
        </table>
      </section>

      <details className="card">
        <summary><b className="error">Delete this contact&apos;s data</b></summary>
        <form action={deleteContactAction} className="stack" style={{ marginTop: 12 }}>
          <input type="hidden" name="contactId" value={c.id} />
          <p className="muted">Erases the contact, messages, quotes and campaign history. A hashed marker stays so they never get marketing again.</p>
          <label>Type DELETE to confirm<input name="confirm" required /></label>
          <button className="btn danger">Delete permanently</button>
        </form>
      </details>
    </div>
  );
}
