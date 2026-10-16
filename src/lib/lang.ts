import type { Lang } from './business.ts';

const HINGLISH_WORDS = new Set([
  'hai', 'hain', 'kya', 'kaise', 'kaisa', 'kitna', 'kitne', 'kitni', 'kab', 'kahan', 'kaha', 'mujhe', 'mujhko', 'chahiye', 'chaiye',
  'karna', 'karni', 'karo', 'karwana', 'karwani', 'banwana', 'banwani', 'banana', 'banani', 'aap', 'aapka', 'aapki', 'aapke', 'apna', 'apni',
  'humein', 'hamara', 'hamari', 'mera', 'meri', 'mere', 'nahi', 'nahin', 'haan', 'han', 'ji', 'bhai', 'theek', 'thik', 'accha', 'acha',
  'achha', 'kaam', 'kuch', 'batao', 'bataiye', 'batayiye', 'dijiye', 'wala', 'wali', 'abhi', 'jaldi', 'sasta', 'bhi', 'toh', 'bhejo',
  'bhejiye', 'samjha', 'sakte', 'sakta', 'sakti', 'hoga', 'hogi', 'raha', 'rahi', 'rahe', 'liye', 'lekin', 'aur', 'kar', 'shukriya',
  'dhanyavad', 'namaste', 'kripya', 'matlab', 'kyun', 'kyu', 'jaise', 'sab', 'yeh', 'woh', 'hum', 'tum', 'ho', 'tha', 'thi'
]);

/**
 * Detect the reply language from a customer message.
 * Returns null when the message has too little signal (keep the previous language).
 */
export function detectLang(text: string): Lang | null {
  if (!text) return null;
  if (/[ऀ-ॿ]/.test(text)) return 'hinglish'; // Devanagari script
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length === 0) return null;
  const hits = words.filter((w) => HINGLISH_WORDS.has(w)).length;
  if (hits >= 2 || (hits >= 1 && words.length <= 3 && words.some((w) => w.length > 3 && HINGLISH_WORDS.has(w)))) return 'hinglish';
  if (words.length >= 3 && hits === 0) return 'en';
  return null;
}
