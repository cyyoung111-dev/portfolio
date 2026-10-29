import assert from 'node:assert/strict';
import { diagnose } from './nhplug-readonly-diagnostic.mjs';

const key = 'dummy-key', secret = 'dummy-secret', token = 'dummy-token';
const makeResponse = (status, payload) => ({
  ok: status >= 200 && status < 300, status, json: async () => payload,
});
const quotePayload = (symbol, overrides = {}) => ({
  Output_0: {
    iem_cd: symbol,
    ...(symbol === '005930' || symbol === '069500'
      ? { stck_prpr: '71300' } : { trdprc: '521.32', trade_date: '20261028' }),
    ...overrides,
  },
});
const makeRequests = (overrides = {}) => {
  const requests = [];
  const request = async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/oauth2/token')) return makeResponse(200, { access_token: token });
    const symbol = JSON.parse(options.body).Input_0.iem_cd;
    return overrides[symbol] ?? makeResponse(200, quotePayload(symbol));
  };
  return { requests, request };
};
const run = async (request) => {
  const logs = [];
  const ok = await diagnose({ key, secret, request, log: x => logs.push(x), wait: async () => {} });
  assert.doesNotMatch(logs.join('\n'), /dummy-key|dummy-secret|dummy-token|https?:|Output_0/);
  return { ok, logs: logs.join('\n') };
};

// Happy path asserts actual contracts, no raw prices or credentials in logs.
{
  const { request, requests } = makeRequests();
  const { ok, logs } = await run(request);
  assert.equal(ok, true);
  assert.equal(requests.length, 5);
  assert.equal(new URL(requests[0].url).pathname, '/oauth2/token');
  assert.equal(requests[0].options.redirect, 'error');
  assert.deepEqual(requests.slice(1).map(x => new URL(x.url).pathname), [
    '/krstock/quote/v1/currentPrice', '/krstock/quote/v1/etfCurrent',
    '/gbstock/quote/v1/current', '/gbstock/quote/v1/current',
  ]);
  assert.deepEqual(requests.slice(1).map(x => JSON.parse(x.options.body).Input_0), [
    { iem_cd: '005930', market_cd: 'KRX' }, { iem_cd: '069500' },
    { iem_cd: 'AAPL' }, { iem_cd: 'SPY' },
  ]);
  assert.equal(requests[1].options.headers.authorization, `Bearer ${token}`);
  assert.match(logs, /US_ETF HTTP_200 PRICE_PRESENT_DATE_FORMAT_VALID_FRESHNESS_UNVERIFIED PREFLIGHT_PASS/);
  assert.match(logs, /QUOTE_PREFLIGHT PASS NIGHT_FUTURE_UNVERIFIED/);
  assert.match(logs, /KOSPI200_NIGHT_FUTURE NOT_RUN_CONTRACT_PENDING/);
}

// HTTP 200 is not success unless the specific instrument and positive quoted price match.
for (const [overrides, expected] of [
  [{ '005930': makeResponse(200, quotePayload('005930', { stck_prpr: '0' })) }, /KR_STOCK HTTP_200 PRICE_INVALID PREFLIGHT_FAIL/],
  [{ '069500': makeResponse(200, quotePayload('005930')) }, /KR_ETF HTTP_200 INSTRUMENT_UNVERIFIED PREFLIGHT_FAIL/],
  [{ AAPL: makeResponse(200, quotePayload('AAPL', { trdprc: 0 })) }, /US_STOCK HTTP_200 PRICE_INVALID PREFLIGHT_FAIL/],
  [{ SPY: makeResponse(200, quotePayload('SPY', { trade_date: '20260230' })) }, /US_ETF HTTP_200 TRADE_DATE_INVALID PREFLIGHT_FAIL/],
  [{ AAPL: makeResponse(200, { message: { code: 'ERROR' } }) }, /US_STOCK HTTP_200 INSTRUMENT_UNVERIFIED PREFLIGHT_FAIL/],
]) {
  const { ok, logs } = await run(makeRequests(overrides).request);
  assert.equal(ok, false);
  assert.match(logs, expected);
  assert.match(logs, /QUOTE_PREFLIGHT FAIL NIGHT_FUTURE_UNVERIFIED/);
}

// Stop on rate limiting; never issue another token in response to 429.
{
  const { request, requests } = makeRequests({ '069500': makeResponse(429, {}) });
  const { ok, logs } = await run(request);
  assert.equal(ok, false);
  assert.equal(requests.length, 3);
  assert.match(logs, /KR_ETF HTTP_429/);
}
{
  let calls = 0;
  const { ok, logs } = await run(async () => { calls++; throw new Error(secret); });
  assert.equal(ok, false);
  assert.equal(calls, 1);
  assert.match(logs, /AUTH NETWORK_OR_RESPONSE_ERROR/);
}
{
  const logs = [];
  assert.equal(await diagnose({ key: '', secret, log: x => logs.push(x) }), false);
  assert.match(logs.join('\n'), /AUTH MISSING_CREDENTIALS/);
}
{
  const logs = [];
  const ok = await diagnose({
    key, secret, request: async () => makeResponse(403, { message: secret }),
    log: x => logs.push(x), wait: async () => {},
  });
  assert.equal(ok, false);
  assert.match(logs.join('\n'), /AUTH FAILED HTTP_403/);
  assert.doesNotMatch(logs.join('\n'), /dummy/);
}
console.log('NH PLUG read-only quote preflight regression checks passed');
