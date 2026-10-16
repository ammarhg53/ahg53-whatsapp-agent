import { BUDGETS, DEADLINES, type ServiceId } from './business.ts';

const COUNTRY_ALIASES: [RegExp, string][] = [
  [/\b(uae|u\.a\.e|emirates|dubai|sharjah|abu ?dhabi|ajman|ras al khaimah|rak|fujairah|umm al quwain)\b/, 'UAE'],
  [/\b(saudi|ksa|riyadh|jeddah|jiddah|dammam|mecca|makkah|medina|madinah|khobar)\b/, 'Saudi Arabia'],
  [/\b(uk|u\.k|united kingdom|england|britain|scotland|wales|london|manchester|birmingham)\b/, 'UK'],
  [/\b(usa|u\.s\.a|us|united states|america|new york|california|texas|florida|chicago)\b/, 'USA'],
  [/\b(india|bharat|mumbai|delhi|bangalore|bengaluru|hyderabad|chennai|kolkata|pune|ahmedabad|surat|vadodara|jaipur|gujarat)\b/, 'India'],
  [/\b(qatar|doha)\b/, 'Qatar'],
  [/\b(oman|muscat)\b/, 'Oman'],
  [/\b(kuwait)\b/, 'Kuwait'],
  [/\b(bahrain|manama)\b/, 'Bahrain'],
  [/\b(canada|toronto|vancouver)\b/, 'Canada'],
  [/\b(australia|sydney|melbourne)\b/, 'Australia']
];

/** Best-effort country from free text like "Dubai, UAE". Returns null if unknown. */
export function detectCountry(location: string): string | null {
  const lower = ` ${location.toLowerCase()} `;
  for (const [re, country] of COUNTRY_ALIASES) if (re.test(lower)) return country;
  return null;
}

const COUNTRY_POINTS: Record<string, number> = { UAE: 3, 'Saudi Arabia': 3, UK: 2, USA: 2, India: 1 };
const SERVICE_POINTS: Partial<Record<ServiceId, number>> = {
  svc_software: 2, svc_app: 2, svc_ecom: 2, svc_automation: 2, svc_whitelabel: 2,
  svc_web: 1, svc_uiux: 1, svc_seo: 1, svc_script: 1, svc_m365email: 0
};

export type ScoreInput = { budgetId?: string; country?: string | null; deadlineId?: string; serviceId?: string };

/** Hot / warm / cold from budget, country, urgency and service type. */
export function scoreLead(input: ScoreInput): { score: 'hot' | 'warm' | 'cold'; points: number } {
  let points = 0;
  points += BUDGETS.find((b) => b.id === input.budgetId)?.points ?? 0;
  points += input.country ? COUNTRY_POINTS[input.country] ?? 1 : 0;
  points += DEADLINES.find((d) => d.id === input.deadlineId)?.points ?? 0;
  points += SERVICE_POINTS[input.serviceId as ServiceId] ?? 0;
  const score = points >= 8 ? 'hot' : points >= 5 ? 'warm' : 'cold';
  return { score, points };
}
