// Reuse the GAS calendar so the headless scheduler and PRICE close share a
// single CLOSED/OPEN contract. Never infer a weekday holiday from an empty API.
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/gas/apps_script.gs', import.meta.url), 'utf8');
const calendars = new Map();
for (const match of source.matchAll(/var KRX_CONFIRMED_CLOSED_DATES_(\d{4})\s*=\s*\{([\s\S]*?)\};/g)) {
  const year = match[1];
  const dates = [...match[2].matchAll(/'(\d{4}-\d{2}-\d{2})'\s*:\s*1/g)].map(row => row[1]);
  if (!dates.length || dates.some(date => !date.startsWith(year + '-')))
    throw new Error('KRX_CALENDAR_INVALID_' + year);
  calendars.set(year, new Set(dates));
}
if (!calendars.has('2026')) throw new Error('KRX_CALENDAR_MISSING_2026');

export function krxSessionStatus(date) {
  const text = String(date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return 'UNKNOWN';
  const parsed = new Date(text + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== text) return 'UNKNOWN';
  if ([0,6].includes(parsed.getUTCDay())) return 'CLOSED';
  const year = text.slice(0,4);
  if (!calendars.has(year)) return 'UNKNOWN';
  return calendars.get(year).has(text) ? 'CLOSED' : 'OPEN';
}
