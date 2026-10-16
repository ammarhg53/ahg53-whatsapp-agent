import Link from 'next/link';
import { sheet } from '@/lib/sheets';
import { sendToNumberAction } from '../actions';
import { Flash, type SearchParams } from '../ui';
import type { TemplateRow } from '@/lib/templates';

// Filled from the form below or the contact; anything else needs its own field.
const AUTO_PARAMS = new Set(['customer_name', 'country', 'business_name', 'service']);

export default async function SendToNumber({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const templates = await sheet.find<TemplateRow>('templates', { status: 'APPROVED', category: { op: 'in', value: ['MARKETING', 'UTILITY'] } }, { order: 'name' });
  const names = [...new Set(templates.filter((t) => t.name !== 'ahg_admin_alert').map((t) => t.name))];
  const chosen = typeof sp.template === 'string' && names.includes(sp.template) ? sp.template : '';
  const variants = templates.filter((t) => t.name === chosen);
  const marketing = variants.some((t) => t.category === 'MARKETING');
  const extraParams = [...new Set(variants.flatMap((t) => t.params ?? []))].filter((p) => !AUTO_PARAMS.has(p));
  const body = variants.find((v) => v.language === 'en' || v.language === 'en_US')?.components.find((c: any) => c.type === 'BODY')?.text
    ?? variants[0]?.components.find((c: any) => c.type === 'BODY')?.text;

  return (
    <div className="stack">
      <h1>Send to a number</h1>
      <Flash msg={sp.msg} />
      <p className="notice">
        WhatsApp rule: to message someone who hasn&apos;t written to you in the last 24 hours, the first message must be an
        <b> approved template</b>. As soon as they reply, open their chat in <Link href="/dashboard/conversations">Conversations</Link> and type freely.
      </p>

      <form className="card row">
        <label style={{ flex: 1 }}>1. Template
          <select name="template" defaultValue={chosen} required>
            <option value="" disabled>Choose an approved template…</option>
            {names.map((n) => <option key={n}>{n}</option>)}
          </select>
        </label>
        <button className="btn">Next</button>
      </form>
      {!names.length && (
        <p className="notice">No approved templates yet. Submit them (<code>npm run templates:submit</code>), wait for Meta&apos;s approval,
          then press <b>Sync</b> on the <Link href="/dashboard/templates">Templates</Link> page.</p>
      )}

      {chosen && (
        <form action={sendToNumberAction} className="card stack">
          <input type="hidden" name="template" value={chosen} />
          {body && <div className="preview">{body}</div>}
          <div className="form-grid">
            <label>2. WhatsApp number (with country code)<input name="phone" required placeholder="+971 50 123 4567" maxLength={20} /></label>
            <label>Name<input name="name" maxLength={60} placeholder="Aisha" /></label>
            <label>Country<input name="country" maxLength={60} placeholder="UAE" /></label>
            <label>Language
              <select name="lang" defaultValue="en"><option value="en">English</option><option value="hinglish">Hinglish</option></select>
            </label>
          </div>
          {extraParams.map((p) => <label key={p}>{p}<input name={`param_${p}`} required maxLength={600} /></label>)}
          {marketing && (
            <fieldset className="card stack">
              <legend><b>Consent</b> (required for marketing templates)</legend>
              <label>Where did they agree to WhatsApp messages?<input name="source" required maxLength={40} placeholder="e.g. asked on call, filled website form" /></label>
              <label className="checks"><input type="checkbox" name="consent" required />This person agreed to receive WhatsApp messages from AHG53</label>
            </fieldset>
          )}
          <button className="btn primary">Send template (uses 1 message)</button>
        </form>
      )}
    </div>
  );
}
