import { getSettings } from '@/lib/settings';
import { saveSettingsAction } from '../actions';
import { Flash, type SearchParams } from '../ui';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const s = await getSettings(true);
  const aiReady = !!process.env.ANTHROPIC_API_KEY;

  return (
    <div className="stack">
      <h1>Settings</h1>
      <Flash msg={sp.msg} />
      <form action={saveSettingsAction} className="stack">
        <section className="card form-grid">
          <h2 style={{ gridColumn: '1 / -1' }}>Message limit</h2>
          <label>Monthly message limit<input type="number" name="monthly_message_limit" defaultValue={s.monthly_message_limit} min={0} /></label>
          <label>Kept for customer replies<input type="number" name="service_reserve" defaultValue={s.service_reserve} min={0} /></label>
          <p className="muted" style={{ gridColumn: '1 / -1' }}>Campaigns and follow-ups stop before eating into the reserve, so the bot can keep answering customers.</p>
        </section>

        <section className="card stack">
          <h2>Business hours (Asia/Kolkata)</h2>
          <div className="checks">{DAYS.map((d, i) => (
            <label key={d}><input type="checkbox" name="days" value={i + 1} defaultChecked={s.business_hours.days.includes(i + 1)} />{d}</label>
          ))}</div>
          <div className="form-grid">
            <label>Opens<input type="time" name="start" defaultValue={s.business_hours.start} /></label>
            <label>Closes<input type="time" name="end" defaultValue={s.business_hours.end} /></label>
          </div>
          <p className="muted">Outside these hours customers get one after-hours note (at most every 12 hours); the bot keeps working.</p>
        </section>

        <section className="card stack">
          <h2>Bot</h2>
          <label className="checks"><input type="checkbox" name="ai_enabled" defaultChecked={s.ai_enabled} />AI replies for free-text questions (Claude)</label>
          {!aiReady && <p className="notice">Add ANTHROPIC_API_KEY to the environment to turn AI replies on.</p>}
          <label>AI max tokens per reply<input type="number" name="ai_max_tokens" defaultValue={s.ai_max_tokens} min={256} max={4000} /></label>
        </section>

        <section className="card stack">
          <h2>Follow-ups</h2>
          <label>After a quote (days after the request → template)
            <textarea name="post_quote_sequence" defaultValue={JSON.stringify(s.post_quote_sequence, null, 2)} rows={6} style={{ fontFamily: 'monospace' }} />
          </label>
          <p className="muted">Each step needs marketing consent, is skipped if the customer replied or opted out, and counts against the limit.</p>
          <label className="checks"><input type="checkbox" name="reengage_enabled" defaultChecked={s.reengage_enabled} />Re-engage opted-in contacts quiet for 14+ days (template <code>ahg_reengage</code>, at most once per 30 days)</label>
        </section>

        <button className="btn primary">Save settings</button>
      </form>
    </div>
  );
}
