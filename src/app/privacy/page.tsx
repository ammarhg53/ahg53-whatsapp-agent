import type { Metadata } from 'next';
import { BUSINESS } from '@/lib/business.ts';

export const metadata: Metadata = { title: 'Privacy Notice', robots: { index: true, follow: true } };

export default function PrivacyPage() {
  return (
    <main className="prose">
      <h1>Privacy Notice — WhatsApp</h1>
      <p className="muted">{BUSINESS.brand} · {BUSINESS.tagline}</p>

      <h2>What we collect</h2>
      <p>When you message us on WhatsApp we store your WhatsApp number and profile name, the messages you send us,
        and anything you share in a quote request (name, business name, country/city, service, budget, timeline).</p>

      <h2>Why</h2>
      <p>To reply to you, prepare your quote, support your project, and — only if you agree — send occasional
        updates and offers. We never sell your data.</p>

      <h2>Marketing consent</h2>
      <p>We send marketing messages only after you opt in, and we record when and how you did. Reply <b>STOP</b>,
        <b> UNSUBSCRIBE</b> or <b>बंद</b> at any time and you will not receive marketing messages again.
        Reply <b>START</b> to opt back in.</p>

      <h2>Your data, your choice</h2>
      <p>Reply <b>DELETE MY DATA</b> on WhatsApp to erase your details, messages and quote requests from our system.
        We keep only an anonymous (hashed) marker of your number so we never send you marketing again.
        Messages already in your WhatsApp chat stay on your phone.</p>

      <h2>Who processes it</h2>
      <p>Messages travel through WhatsApp (Meta) and our messaging provider Kapso. Our data is stored with Supabase.
        If you use the free-text assistant, your question may be processed by Anthropic&apos;s Claude API to draft a reply.
        Each provider handles data under its own terms.</p>

      <h2>Contact</h2>
      <p>{BUSINESS.founder} — <a href={`mailto:${BUSINESS.founderEmail}`}>{BUSINESS.founderEmail}</a> ·
        support: <a href={`mailto:${BUSINESS.supportEmail}`}>{BUSINESS.supportEmail}</a> · {BUSINESS.phone}</p>
    </main>
  );
}
