// NH PLUG KOSPI200 NIGHT preparation only: pure validation, no API calls or GAS writes.
// A final trade captured after 06:00 is a *reference*, NOT KRX's official settlement/close.
const SOURCE = 'NH_PLUG';
const SERIES = 'K200_NIGHT';
const KIND = 'NIGHT_LAST_TRADE_REFERENCE';
const DAY_MS = 86_400_000;
const TICK = 0.05;

function fail(code) { throw new Error('NHPLUG_NIGHT_' + code); }
function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const t = Date.parse(date + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === date;
}
function dateBefore(date) {
  return new Date(Date.parse(date + 'T00:00:00Z') - DAY_MS).toISOString().slice(0, 10);
}
function kstTime(date, hhmmss) { return Date.parse(date + 'T' + hhmmss + '+09:00'); }
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  return Date.parse(value);
}
function priceValue(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))) return NaN;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && Math.abs(n / TICK - Math.round(n / TICK)) < 1e-6 ? n : NaN;
}

// Expected input is deliberately provider-normalized, *not* raw NH REST or WS.
// The specific NH response schema and the active contract must be verified before wiring.
export function buildNightReference(input) {
  if (!input || !validDate(input.tradingDate) || input.session !== 'NIGHT' ||
      input.instrument !== 'KOSPI200_FUTURE' || input.market !== 'KRX') fail('IDENTITY_UNVERIFIED');
  if (input.contractVerified !== true || typeof input.contract !== 'string' ||
      !/^[A-Z0-9]{4,16}$/.test(input.contract) ||
      typeof input.contractMonth !== 'string' || !/^\d{4}-(03|06|09|12)$/.test(input.contractMonth)) {
    fail('CONTRACT_UNVERIFIED');
  }
  const value = priceValue(input.value);
  if (!Number.isFinite(value)) fail('PRICE_INVALID');
  if (input.priceType !== 'LAST_TRADE') fail('PRICE_TYPE_UNVERIFIED');
  if (input.source !== SOURCE || input.officialClose === true) fail('SOURCE_OR_FINALITY_INVALID');

  const observed = instant(input.observedAt), received = instant(input.receivedAt);
  if (!Number.isFinite(observed) || !Number.isFinite(received) || observed > received) fail('TIMESTAMP_INVALID');
  const open = kstTime(dateBefore(input.tradingDate), '18:00:00');
  const close = kstTime(input.tradingDate, '06:00:00');
  if (observed < open || observed > close) fail('WRONG_NIGHT_SESSION');
  if (received < close || received >= kstTime(input.tradingDate, '07:40:00')) fail('RECEIPT_OUTSIDE_CUTOFF');

  const record = {
    schemaVersion: 1, seriesId: SERIES, source: SOURCE, kind: KIND,
    tradingDate: input.tradingDate, sourceDate: input.tradingDate,
    market: 'KRX', session: 'NIGHT', instrument: 'KOSPI200_FUTURE',
    contract: input.contract, contractMonth: input.contractMonth, contractVerified: true,
    value, priceType: 'LAST_TRADE', status: 'REFERENCE', finality: null, officialClose: false,
    observedAt: new Date(observed).toISOString(), receivedAt: new Date(received).toISOString(),
    // Never write this value into KRX_OFFICIAL / NIGHT_FINAL or a stock Snapshot.
    storageKey: [SOURCE, SERIES, input.tradingDate, input.contract].join('|'),
  };
  return Object.freeze(record);
}

// Pure prospective GAS upsert. The eventual GAS writer must implement the same
// date+contract uniqueness, concurrency lock and readback, without modifying
// official MARKET_MASTER or historical price/snapshot sheets.
export function upsertNightReference(rows, candidate) {
  const normalized = buildNightReference(candidate);
  const result = Array.isArray(rows) ? rows.slice() : [];
  const indexes = result.flatMap((row, i) => row?.storageKey === normalized.storageKey ? [i] : []);
  if (indexes.length > 1) fail('DUPLICATE_STORED_KEY');
  if (!indexes.length) { result.push(normalized); return { rows: result, outcome: 'INSERTED' }; }
  const prior = buildNightReference(result[indexes[0]]);
  const oldTime = Date.parse(prior.receivedAt), newTime = Date.parse(normalized.receivedAt);
  if (newTime < oldTime) return { rows: result, outcome: 'STALE_IGNORED' };
  if (newTime === oldTime) {
    if (prior.value !== normalized.value || prior.observedAt !== normalized.observedAt) fail('CONFLICTING_SAME_RECEIPT');
    return { rows: result, outcome: 'DUPLICATE_IGNORED' };
  }
  result[indexes[0]] = normalized;
  return { rows: result, outcome: 'UPDATED' };
}

export function nightTelegramReference(rows, date) {
  if (!validDate(date)) fail('TARGET_DATE_INVALID');
  const candidates = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.tradingDate !== date || row?.source !== SOURCE) continue;
    try { candidates.push(buildNightReference(row)); } catch { continue; }
  }
  // Multiple contracts on a roll date are ambiguous without verified active-contract mapping.
  const contractKeys = [...new Set(candidates.map(x => x.contract))];
  if (contractKeys.length !== 1) return null;
  candidates.sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
  return candidates[0] || null;
}
export function formatNightTelegramLine(candidate, date) {
  const row = nightTelegramReference(candidate ? [candidate] : [], date);
  if (!row) return 'KOSPI200 야간선물: 당일 검증된 NH PLUG 참고값 미확보';
  return 'KOSPI200 야간선물 마지막 체결 참고: ' + row.value.toFixed(2) + 'pt'
    + ' (NH PLUG, ' + row.tradingDate + ', 계약 ' + row.contract
    + ', KRX 공식 종가·정산가 미확인)';
}
