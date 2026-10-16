import { sheet } from '@/lib/sheets';
import type { TemplateRow } from '@/lib/templates';
import { syncTemplatesAction } from '../actions';
import { Flash, fmt, type SearchParams } from '../ui';

const statusClass = (s: string | null) => (s === 'APPROVED' ? 'good' : s === 'REJECTED' || s === 'DISABLED' ? 'hot' : 'paused');

export default async function Templates({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const templates = (await sheet.find<TemplateRow & { synced_at: string }>('templates'))
    .sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language));

  return (
    <div className="stack">
      <div className="row spread">
        <h1>WhatsApp templates</h1>
        <form action={syncTemplatesAction}><button className="btn primary">Sync from WhatsApp</button></form>
      </div>
      <Flash msg={sp.msg} />
      <p className="muted">
        Marketing and follow-up messages outside the 24-hour window must use templates approved by WhatsApp.
        Ready-to-submit texts are in the <code>templates/</code> folder — run <code>npm run templates:submit</code>, wait for approval
        (minutes to a day), then sync here.
      </p>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Language</th><th>Category</th><th>Status</th><th>Values</th><th>Synced</th></tr></thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}>
                <td><b>{t.name}</b><div className="muted" style={{ maxWidth: 420, whiteSpace: 'pre-wrap' }}>{t.components?.find((c: any) => c.type === 'BODY')?.text}</div></td>
                <td>{t.language}</td>
                <td>{t.category}</td>
                <td><span className={`badge ${statusClass(t.status)}`}>{t.status}</span></td>
                <td>{(t.params ?? []).join(', ') || '—'}{t.has_url_var && <div className="muted">+ tracked link</div>}</td>
                <td>{fmt(t.synced_at)}</td>
              </tr>
            ))}
            {!templates.length && <tr><td colSpan={6} className="muted">Nothing synced yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
