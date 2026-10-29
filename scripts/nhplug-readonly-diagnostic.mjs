import { pathToFileURL } from 'node:url';

const ORIGIN = 'https://api.nhplug.com:8443';
const QUOTES = [
  ['KR_STOCK', '/krstock/quote/v1/currentPrice', { iem_cd: '005930', market_cd: 'KRX' }],
  ['KR_ETF', '/krstock/quote/v1/currentPrice', { iem_cd: '069500', market_cd: 'KRX' }],
  ['US_STOCK', '/gbstock/quote/v1/current', { iem_cd: 'AAPL' }],
  ['US_ETF', '/gbstock/quote/v1/current', { iem_cd: 'SPY' }],
];

export async function diagnose({ key, secret, request = fetch, log = console.log, wait = ms => new Promise(r => setTimeout(r, ms)) }) {
  if (!key || !secret) { log('AUTH MISSING_CREDENTIALS'); return false; }
  const params = new URLSearchParams({ appkey: key, appsecretkey: secret, grant_type: 'client_credentials', scope: 'oob' });
  let response, data;
  try {
    response = await request(`${ORIGIN}/oauth2/token?${params}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    data = await response.json();
  } catch { log('AUTH NETWORK_OR_RESPONSE_ERROR'); return false; }
  if (!response.ok || typeof data?.access_token !== 'string' || !data.access_token) {
    log(`AUTH FAILED HTTP_${response.status}`); return false;
  }
  const token = data.access_token;
  log('AUTH TOKEN_RECEIVED');
  let allVerified = true;
  for (const [label, path, input] of QUOTES) {
    await wait(1000);
    try {
      response = await request(`${ORIGIN}${path}`, { method: 'POST', headers: { 'content-type': 'application/json; charset=UTF-8', 'x-client-id': key, 'x-client-secret': secret, authorization: `Bearer ${token}` }, body: JSON.stringify({ Input_0: input }), redirect: 'error', signal: AbortSignal.timeout(15000) });
      data = await response.json();
      const output = data?.Output_0;
      const rows = Array.isArray(output) ? output : [output];
      const populated = rows.some(x => x && typeof x === 'object' && Object.values(x).some(v => v !== null && v !== undefined && String(v).trim() !== ''));
      // HTTP 200 and populated output are only evidence of a response, not price validity.
      log(`${label} HTTP_${response.status} OUTPUT_${populated ? 'PRESENT' : 'EMPTY'} PRICE_UNVERIFIED`);
      allVerified = false;
      if (!response.ok) break;
    } catch { log(`${label} NETWORK_OR_RESPONSE_ERROR`); allVerified = false; break; }
  }
  log('KOSPI200_NIGHT_FUTURE NOT_RUN_SPEC_UNCONFIRMED');
  return allVerified;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ok = await diagnose({ key: process.env.NHPLUG_APP_KEY, secret: process.env.NHPLUG_APP_SECRET });
  if (!ok) process.exitCode = 1;
}
