/** Strip control characters, collapse whitespace and cap length of user text. */
export function cleanText(input: unknown, max = 1000): string {
  if (typeof input !== 'string') return '';
  return input
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

/** Normalise a WhatsApp number to digits only; returns null if implausible. */
export function normalizeWaId(input: unknown): string | null {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  const d = String(input).replace(/\D/g, '');
  return /^\d{7,15}$/.test(d) ? d : null;
}

/** Short single-line value for names, business names, cities. */
export function cleanField(input: unknown, max = 80): string {
  return cleanText(input, max).replace(/\n/g, ' ');
}

/** Escape text for safe insertion into HTML (emails). */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
