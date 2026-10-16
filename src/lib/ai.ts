import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { env } from './env';
import { sheet } from './sheets';
import { aiSystemPrompt } from './business.ts';
import { cleanText } from './sanitize';
import { log } from './log';
import type { Contact } from './types';

// Models that support the server-side refusal fallback ("default" routing).
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

let client: Anthropic | null = null;

export function aiConfigured(): boolean {
  return !!env().ANTHROPIC_API_KEY;
}

/** Last few text messages as Claude conversation turns (must start with the user). */
async function history(contactId: string): Promise<Anthropic.MessageParam[]> {
  const data = await sheet.find<{ direction: string; body: string | null }>('messages', { contact_id: contactId }, { order: 'created_at', desc: true, limit: 8 });
  const turns: Anthropic.MessageParam[] = data
    .reverse()
    .filter((m) => m.body && !String(m.body).startsWith('[template'))
    .map((m) => ({ role: m.direction === 'inbound' ? 'user' : 'assistant', content: String(m.body).slice(0, 600) }));
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns;
}

/**
 * Short answer to a free-text question, grounded in the business facts.
 * Returns null on any failure so the caller falls back to the menu.
 */
export async function aiReply(contact: Contact, maxTokens: number): Promise<string | null> {
  const e = env();
  if (!e.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic({ apiKey: e.ANTHROPIC_API_KEY, timeout: 8000, maxRetries: 0 });

  const messages = await history(contact.id);
  if (!messages.length || messages[messages.length - 1].role !== 'user') return null;

  const useFallback = FALLBACK_MODELS.has(e.AI_MODEL);
  try {
    const response = await client.beta.messages.create({
      model: e.AI_MODEL,
      max_tokens: maxTokens,
      ...(useFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: aiSystemPrompt(), cache_control: { type: 'ephemeral' } }],
      messages: [
        ...messages,
        { role: 'system', content: `Reply language: ${contact.lang === 'hinglish' ? 'Hinglish' : 'English'}.` }
      ]
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);

    if (response.stop_reason === 'refusal') return null;
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    const reply = cleanText(text, 700);
    return reply || null;
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) log.warn('ai rate limited');
    else if (err instanceof Anthropic.APIError) log.warn('ai api error', { status: err.status, error: err.message });
    else log.warn('ai call failed', { error: (err as Error).message });
    return null;
  }
}
