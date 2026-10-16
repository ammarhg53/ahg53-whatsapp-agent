import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sheet } from '@/lib/sheets';
import { audienceSchema, campaignStats, countAudience, sampleContact } from '@/lib/campaigns';
import { needsImage, pickTemplate, renderPreview } from '@/lib/templates';
import { quotaStatus } from '@/lib/quota';
import { cancelCampaignAction, confirmCampaignAction } from '../../actions';
import { Flash, fmt, type SearchParams } from '../../ui';

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const c = await sheet.first<any>('campaigns', { id });
  if (!c) notFound();

  const audience = audienceSchema.parse(c.audience);
  const [stats, q, tpl, sample, audienceCount] = await Promise.all([
    campaignStats(id),
    quotaStatus(),
    pickTemplate(c.template_name, 'en'),
    sampleContact(audience),
    c.status === 'draft' ? countAudience(audience) : Promise.resolve(c.recipient_count as number)
  ]);
  const preview = tpl ? renderPreview(tpl, { contact: sample, fixed: c.params ?? {} }) : 'Template not approved / not synced.';
  const fits = audienceCount <= q.marketingRemaining;
  const describe = [
    audience.scores.length && `score: ${audience.scores.join(', ')}`,
    audience.statuses.length && `status: ${audience.statuses.join(', ')}`,
    audience.countries.length && `country: ${audience.countries.join(', ')}`,
    audience.tags.length && `tags: ${audience.tags.join(', ')}`
  ].filter(Boolean).join(' · ') || 'everyone opted in';

  return (
    <div className="stack">
      <Link href="/dashboard/campaigns">← Campaigns</Link>
      <div className="row spread">
        <h1>{c.name}</h1>
        <span className="badge">{c.status}</span>
      </div>
      <Flash msg={sp.msg} />

      <div className="grid">
        <section className="card">
          <h2>Preview</h2>
          <p className="muted">Template <code>{c.template_name}</code>, shown for {sample.name ?? 'a contact'}.</p>
          {tpl && needsImage(tpl) && (c.params?._image_link
            ? <img src={c.params._image_link} alt="Campaign picture" style={{ maxWidth: 420, width: '100%', borderRadius: 12, display: 'block', marginBottom: 8 }} />
            : c.params?._image_id ? <p className="muted">📷 Picture attached (uploaded to WhatsApp)</p> : <p className="error">No picture attached</p>)}
          <div className="preview">{preview}</div>
          {c.link_url && <p className="muted">Button opens {c.link_url} (tracked)</p>}
        </section>

        <section className="card stack">
          <h2>Audience &amp; cost</h2>
          <p>{describe}</p>
          <p><span className="stat">{audienceCount}</span> recipients = <b>{audienceCount} messages</b> from your monthly limit.</p>
          <p className="muted">Marketing allowance left this month: {q.marketingRemaining} (of {q.limit}, {q.reserve} kept for customer replies). WhatsApp also bills each marketing message through Kapso/Meta.</p>
          <p>Send time: {c.scheduled_at ? fmt(c.scheduled_at) : 'immediately after confirming'}</p>
          {c.status === 'draft' && (
            <>
              {!fits && <p className="error">Not enough quota for this audience. Narrow it or raise the limit in Settings.</p>}
              {!tpl && <p className="error">This template isn&apos;t approved yet.</p>}
              <form action={confirmCampaignAction}>
                <input type="hidden" name="campaignId" value={c.id} />
                <button className="btn primary" disabled={!fits || !tpl || audienceCount === 0}>Confirm &amp; schedule {audienceCount} messages</button>
              </form>
            </>
          )}
          {['draft', 'scheduled', 'sending'].includes(c.status) && (
            <form action={cancelCampaignAction}>
              <input type="hidden" name="campaignId" value={c.id} />
              <button className="btn danger">Cancel campaign</button>
            </form>
          )}
        </section>
      </div>

      {c.status !== 'draft' && (
        <section className="card">
          <h2>Results</h2>
          <div className="grid">
            {([
              ['Sent', stats.sent], ['Pending', stats.pending], ['Failed', stats.failed], ['Skipped (no consent)', stats.skipped],
              ['Delivered', stats.delivered], ['Read', stats.read], ['Clicked', stats.clicked], ['Replied', stats.replied], ['Became leads', stats.converted]
            ] as const).map(([label, n]) => (
              <div key={label}><div className="muted">{label}</div><div className="stat">{n}</div></div>
            ))}
          </div>
          <p className="muted">Started {fmt(c.started_at)} · Finished {fmt(c.finished_at)}. Sending runs in batches every 5 minutes.</p>
        </section>
      )}
    </div>
  );
}
