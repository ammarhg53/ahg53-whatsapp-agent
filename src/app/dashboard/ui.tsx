// Small shared server components for dashboard pages.

export function fmt(ts: string | null | undefined): string {
  if (!ts) return '—';
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ts));
}

export function Flash({ msg }: { msg?: string | string[] }) {
  const text = Array.isArray(msg) ? msg[0] : msg;
  if (!text) return null;
  return <p className="notice">{text}</p>;
}

export function Score({ score }: { score: string | null | undefined }) {
  if (!score) return <span className="muted">—</span>;
  return <span className={`badge ${score}`}>{score}</span>;
}

export function Consent({ optedIn, optedOut }: { optedIn: boolean; optedOut: boolean }) {
  if (optedOut) return <span className="badge bad">opted out</span>;
  if (optedIn) return <span className="badge good">opted in</span>;
  return <span className="badge">no consent</span>;
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
