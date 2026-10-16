import Link from 'next/link';
import { sheet } from '@/lib/sheets';
import { summarize } from '@/lib/campaigns';
import { fmt } from '../ui';

export default async function Campaigns() {
  const campaigns = await sheet.find<{ id: string; name: string; template_name: string; status: string; scheduled_at: string | null; created_at: string }>('campaigns', {}, { order: 'created_at', desc: true, limit: 50 });
  const recipients = campaigns.length ? await sheet.find<any>('campaign_recipients', { campaign_id: { op: 'in', value: campaigns.map((c) => c.id) } }) : [];
  const stats = campaigns.map((c) => summarize(recipients.filter((r) => r.campaign_id === c.id)));

  return (
    <div className="stack">
      <div className="row spread">
        <h1>Campaigns</h1>
        <Link href="/dashboard/campaigns/new" className="btn primary">New campaign</Link>
      </div>
      <p className="muted">Campaigns go only to contacts who opted in, using templates WhatsApp has approved. Opted-out numbers are always excluded.</p>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Campaign</th><th>Status</th><th>Sent</th><th>Delivered</th><th>Read</th><th>Clicked</th><th>Replied</th><th>Leads</th></tr></thead>
          <tbody>
            {campaigns.map((c, i) => (
              <tr key={c.id}>
                <td><Link href={`/dashboard/campaigns/${c.id}`}><b>{c.name}</b></Link><div className="muted">{c.template_name} · {fmt(c.scheduled_at ?? c.created_at)}</div></td>
                <td>{c.status}</td>
                <td>{stats[i].sent}/{stats[i].total}</td>
                <td>{stats[i].delivered}</td><td>{stats[i].read}</td><td>{stats[i].clicked}</td><td>{stats[i].replied}</td><td>{stats[i].converted}</td>
              </tr>
            ))}
            {!campaigns.length && <tr><td colSpan={8} className="muted">No campaigns yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
