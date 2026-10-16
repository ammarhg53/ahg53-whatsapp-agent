import Link from 'next/link';
import { sheet } from '@/lib/sheets';
import type { Contact } from '@/lib/types';
import { createCampaignAction } from '../../actions';
import { Flash, type SearchParams } from '../../ui';
import type { TemplateRow } from '@/lib/templates';

// Params filled automatically from each contact; anything else is asked for below.
const AUTO_PARAMS = new Set(['customer_name', 'country', 'business_name', 'service']);

export default async function NewCampaign({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const [templates, contactMeta] = await Promise.all([
    sheet.find<TemplateRow>('templates', { status: 'APPROVED', category: { op: 'in', value: ['MARKETING', 'UTILITY'] } }, { order: 'name' }),
    sheet.find<Contact>('contacts', { marketing_opt_in: true, opted_out: false })
  ]);
  const names = [...new Set(templates.map((t) => t.name))];
  const chosen = typeof sp.template === 'string' && names.includes(sp.template) ? sp.template : '';
  const variants = templates.filter((t) => t.name === chosen);
  const extraParams = [...new Set(variants.flatMap((t) => t.params))].filter((p) => !AUTO_PARAMS.has(p));
  const hasLink = variants.some((t) => t.has_url_var);
  const countries = [...new Set(contactMeta.map((c) => c.country).filter(Boolean))].sort() as string[];
  const tags = [...new Set(contactMeta.flatMap((c) => c.tags ?? []))].sort();

  return (
    <div className="stack">
      <Link href="/dashboard/campaigns">← Campaigns</Link>
      <h1>New campaign</h1>
      <Flash msg={sp.msg} />

      <form className="card row">
        <label style={{ flex: 1 }}>1. Template
          <select name="template" defaultValue={chosen} required>
            <option value="" disabled>Choose an approved template…</option>
            {names.map((n) => <option key={n}>{n}</option>)}
          </select>
        </label>
        <button className="btn">Next</button>
      </form>
      {!names.length && <p className="notice">No approved templates yet. Submit them (<code>npm run templates:submit</code>), wait for WhatsApp approval, then press <b>Sync</b> on the Templates page.</p>}

      {chosen && (
        <form action={createCampaignAction} className="card stack">
          <input type="hidden" name="template" value={chosen} />
          <p className="muted">Languages available: {variants.map((v) => v.language).join(', ')}. Each contact gets their language (Hinglish → <code>hi</code>) or English.</p>
          <label>2. Campaign name<input name="name" required maxLength={80} placeholder="e.g. Dubai websites — October" /></label>

          <fieldset className="card">
            <legend><b>3. Audience</b> (opted-in contacts only; leave empty for everyone opted in)</legend>
            <div className="stack">
              <div className="checks"><b>Lead score: </b>{['hot', 'warm', 'cold'].map((s) => <label key={s}><input type="checkbox" name="scores" value={s} />{s}</label>)}</div>
              <div className="checks"><b>Status: </b>{['new', 'lead', 'customer', 'lost'].map((s) => <label key={s}><input type="checkbox" name="statuses" value={s} />{s}</label>)}</div>
              {countries.length > 0 && <div className="checks"><b>Country: </b>{countries.map((c) => <label key={c}><input type="checkbox" name="countries" value={c} />{c}</label>)}</div>}
              <label>Tags (any of, comma separated){tags.length > 0 && <span className="muted"> — existing: {tags.join(', ')}</span>}<input name="tags" /></label>
            </div>
          </fieldset>

          {extraParams.length > 0 && (
            <fieldset className="card">
              <legend><b>4. Template values</b> (same for everyone)</legend>
              {extraParams.map((p) => <label key={p}>{p}<input name={`param_${p}`} required maxLength={600} /></label>)}
            </fieldset>
          )}
          {hasLink && <label>Button link (clicks are tracked)<input name="link_url" type="url" placeholder="https://ahg53.bond" /></label>}
          <label>Schedule (IST, leave empty to send right after you confirm)<input type="datetime-local" name="scheduled_at" /></label>
          <button className="btn primary">Preview &amp; check cost →</button>
        </form>
      )}
    </div>
  );
}
