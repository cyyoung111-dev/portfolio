import { pathToFileURL } from 'node:url';

// Restricted to the official live NH PLUG API. No orders, accounts, GAS or writes.
const ORIGIN = 'https://api.nhplug.com:8443';
const QUOTES = [
  ['KR_STOCK', '/krstock/quote/v1/currentPrice', { iem_cd: '005930', market_cd: 'KRX' }, 'stck_prpr'],
  ['KR_ETF', '/krstock/quote/v1/etfCurrent', { iem_cd: '069500' }, 'stck_prpr'],
  ['US_STOCK', '/gbstock/quote/v1/current', { iem_cd: 'AAPL' }, 'trdprc'],
  ['US_ETF', '/gbstock/quote/v1/current', { iem_cd: 'SPY' }, 'trdprc'],
];

function positivePrice(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))) return false;
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function validYYYYMMDD(value) {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return false;
  const y = Number(value.slice(0, 4)), m = Number(value.slice(4, 6)), d = Number(value.slice(6, 8));
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() + 1 === m && parsed.getUTCDate() === d;
}

// Only fixed labels are emitted; never print server fields or response text.
export function safeOverseasShape(data, expected) {
  const output = data?.Output_0;
  const shape = output === null || output === undefined ? 'MISSING' : Array.isArray(output) ? 'ARRAY' : typeof output === 'object' ? 'OBJECT' : 'OTHER';
  const object = shape === 'OBJECT' ? output : null;
  const has = name => object && Object.prototype.hasOwnProperty.call(object, name) ? 'YES' : 'NO';
  const code = data?.message?.rsp_cd ?? data?.rsp_cd ?? data?.error_code;
  const codeClass = typeof code !== 'string' ? 'ABSENT' : /^IGW\d{5}$/.test(code) ? 'GATEWAY' : /^\d{5}$/.test(code) ? 'BUSINESS' : 'OTHER';
  const idMatch = has('iem_cd') === 'NO' || typeof expected !== 'string' ? 'UNKNOWN' : object.iem_cd === expected ? 'YES' : 'NO';
  let format = 'OTHER';
  if (typeof object?.iem_cd !== 'string') format = 'NONSTRING';
  else if (object.iem_cd.length === 0) format = 'EMPTY';
  else if (object.iem_cd.trim().length === 0) format = 'BLANK';
  else if (typeof expected === 'string' && object.iem_cd === expected) format = 'EXACT';
  else if (typeof expected === 'string' && object.iem_cd.trim() === expected) format = 'PADDED';
  else if (typeof expected === 'string' && object.iem_cd.trim().toUpperCase() === expected) format = 'CASE_OR_PADDING';
  else if (/^0+$/.test(object.iem_cd.trim())) format = 'ZEROS';
  else if (/^[A-Z0-9]{15}$/.test(object.iem_cd.trim())) format = 'ALNUM15';
  const priceValid = positivePrice(object?.trdprc) ? 'YES' : 'NO';
  const dateValid = validYYYYMMDD(object?.trade_date) ? 'YES' : 'NO';
  return `OUTPUT_${shape} ID_FIELD_${has('iem_cd')} ID_MATCH_${idMatch} ID_FORMAT_${format} PRICE_FIELD_${has('trdprc')} PRICE_POSITIVE_${priceValid} DATE_FIELD_${has('trade_date')} DATE_VALID_${dateValid} CODE_${codeClass}`;
}

export async function diagnose({ key, secret, request = fetch, log = console.log, wait = ms => new Promise(r => setTimeout(r, ms)) }) {
  if (!key || !secret) { log('AUTH MISSING_CREDENTIALS'); return false; }

  // NH's official token contract uses URL query parameters in a POST request.
  // Never print request URLs, credentials, raw responses, or the issued token.
  const params = new URLSearchParams({ appkey: key, appsecretkey: secret, grant_type: 'client_credentials', scope: 'oob' });
  let response, data;
  try {
    response = await request(`${ORIGIN}/oauth2/token?${params}`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    data = await response.json();
  } catch { log('AUTH NETWORK_OR_RESPONSE_ERROR'); return false; }

  if (!response.ok || typeof data?.access_token !== 'string' || !data.access_token) {
    log(`AUTH FAILED HTTP_${response.status}`); return false;
  }
  const token = data.access_token;
  log('AUTH TOKEN_RECEIVED');

  let allVerified = true;
  for (const [label, path, input, priceField] of QUOTES) {
    await wait(1000); // keep well below the observed per-second rate limit
    try {
      response = await request(`${ORIGIN}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=UTF-8',
          'x-client-id': key, 'x-client-secret': secret, authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ Input_0: input }),
        redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      data = await response.json();
      const output = data?.Output_0;
      const instrumentValid = output && !Array.isArray(output) && typeof output === 'object'
        && output.iem_cd === input.iem_cd;
      const priceValid = instrumentValid && positivePrice(output[priceField]);
      // Overseas current-price payload specifies trade_date; verify format only, not freshness.
      const dateValid = label.startsWith('KR_') || (priceValid && validYYYYMMDD(output.trade_date));
      const state = !instrumentValid ? 'INSTRUMENT_UNVERIFIED'
        : !priceValid ? 'PRICE_INVALID'
        : !dateValid ? 'TRADE_DATE_INVALID'
        : label.startsWith('KR_') ? 'PRICE_PRESENT_DATE_UNVERIFIED'
        : 'PRICE_PRESENT_DATE_FORMAT_VALID_FRESHNESS_UNVERIFIED';
      const verified = response.ok && instrumentValid && priceValid && dateValid;
      log(`${label} HTTP_${response.status} ${state} ${verified ? 'PREFLIGHT_PASS' : 'PREFLIGHT_FAIL'}`);
      if (label.startsWith('US_') && !verified) log(`${label} RESPONSE_SHAPE ${safeOverseasShape(data, input.iem_cd)}`);
      if (!verified) allVerified = false;
      if (response.status === 429 || response.status === 401) break; // no forced token reissue
    } catch {
      log(`${label} NETWORK_OR_RESPONSE_ERROR`);
      allVerified = false;
      break;
    }
  }
  log('KOSPI200_NIGHT_FUTURE NOT_RUN_CONTRACT_PENDING');
  log(`QUOTE_PREFLIGHT ${allVerified ? 'PASS' : 'FAIL'} NIGHT_FUTURE_UNVERIFIED`);
  return allVerified; // quote preflight ONLY; never declares the night future or closes validated
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ok = await diagnose({ key: process.env.NHPLUG_APP_KEY, secret: process.env.NHPLUG_APP_SECRET });
  if (!ok) process.exitCode = 1;
}

