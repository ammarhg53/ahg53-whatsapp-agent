export type BusinessHours = { days: number[]; start: string; end: string };

export const DEFAULT_HOURS: BusinessHours = { days: [1, 2, 3, 4, 5, 6], start: '10:00', end: '19:00' };

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Current weekday (1=Mon … 7=Sun) and minutes since midnight in Asia/Kolkata. */
export function kolkataNow(date = new Date()): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return { day: WEEKDAY[get('weekday')] ?? 1, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function isOpen(hours: BusinessHours = DEFAULT_HOURS, date = new Date()): boolean {
  const { day, minutes } = kolkataNow(date);
  return hours.days.includes(day) && minutes >= toMinutes(hours.start) && minutes < toMinutes(hours.end);
}

/** 'YYYY-MM' month key in Asia/Kolkata, used for the monthly message quota. */
export function quotaMonth(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).formatToParts(date);
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`;
}
