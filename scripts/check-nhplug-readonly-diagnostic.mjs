import assert from 'node:assert/strict';
import { diagnose, safeOverseasShape, parseUSMaster } from './nhplug-readonly-diagnostic.mjs';

const key = 'dummy-key', secret = 'dummy-secret', token = 'dummy-token';
const makeResponse = (status, payload) => ({
  ok: status >= 200 && status < 300, status, json: async () => payload,
});
const header = '@record 164\nchar sGIC[15]; /* @0 */\nchar sNationCode[3]; /* @95 */\nchar sSymbol[12]; /* @98 */';
function masterRow(symbol,gic,country='USA') {
  const b=Buffer.alloc(164,32);b.write(gic,0,'ascii');b.write(country,95,'ascii');b.write(symbol,98,'ascii');b[163]=10;return b;
}
const master=Buffer.concat([masterRow('AAPL','USAAAPL'),masterRow('QQQ','USAQQQ')]);
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
    if (url.endsWith('/m_gtsstock.h')) return {ok:true,text:async()=>header};
    if (url.endsWith('/m_gtsstock.mst')) return {ok:true,headers:{get:()=>String(master.length)},arrayBuffer:async()=>master};
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

assert.equal(safeOverseasShape({Output_0:{iem_cd:secret,trdprc:secret},message:{rsp_cd:'IGW40301',rsp_msg:secret}},'AAPL'), 'OUTPUT_OBJECT ID_FIELD_YES ID_MATCH_NO ID_FORMAT_OTHER PRICE_FIELD_YES PRICE_POSITIVE_NO DATE_FIELD_NO DATE_VALID_NO CODE_GATEWAY');
assert.equal(safeOverseasShape({Output_0:[secret],error_code:secret}), 'OUTPUT_ARRAY ID_FIELD_NO ID_MATCH_UNKNOWN ID_FORMAT_NONSTRING PRICE_FIELD_NO PRICE_POSITIVE_NO DATE_FIELD_NO DATE_VALID_NO CODE_OTHER');
assert.match(safeOverseasShape({Output_0:{iem_cd:' AAPL  '}},'AAPL'), /ID_FORMAT_PADDED/);
assert.match(safeOverseasShape({Output_0:{iem_cd:'aapl'}},'AAPL'), /ID_FORMAT_CASE_OR_PADDING/);
assert.match(safeOverseasShape({Output_0:{iem_cd:'   ',trdprc:'42.1',trade_date:'20261028'}},'AAPL'), /ID_FORMAT_BLANK .*PRICE_POSITIVE_YES .*DATE_VALID_YES/);
assert.match(safeOverseasShape({Output_0:{iem_cd:'0000'}},'AAPL'), /ID_FORMAT_ZEROS/);
assert.match(safeOverseasShape({Output_0:{iem_cd:'AB1234567890123'}},'AAPL'), /ID_FORMAT_ALNUM15/);
assert.doesNotMatch(safeOverseasShape({Output_0:{[secret]:secret},message:{rsp_cd:secret}}), /dummy/);
assert.equal(parseUSMaster(master,header,['AAPL']).get('AAPL'),'USAAAPL');
const pyHeader=`@record 164\n("sGIC",15),\n("name1",40),\n("name2",40),\n("sNationCode",3),\n("sSymbol",12),\n("remaining",54),`;
assert.equal(parseUSMaster(master,pyHeader,['AAPL','QQQ']).get('QQQ'),'USAQQQ');
assert.equal(parseUSMaster(master,pyHeader.replace('("name1",40)','("name1",39)'),['AAPL']),null);
assert.equal(parseUSMaster(master,pyHeader.replace('("name2",40)','("sGIC",40)'),['AAPL']),null);
assert.equal(parseUSMaster(Buffer.concat([master,masterRow('AAPL','USAOTHER')]),header,['AAPL']).has('AAPL'),false);
assert.equal(parseUSMaster(master,header.replace('@98','@99'),['AAPL']),null);
assert.equal(parseUSMaster(master.subarray(0,master.length-1),header,['AAPL']),null);
{
  const {ok,logs} = await run(makeRequests({
    AAPL:makeResponse(200,quotePayload('AAPL',{iem_cd:'USAAAPL'})),
    QQQ:makeResponse(200,quotePayload('QQQ',{iem_cd:'USAQQQ'})),
  }).request);
  assert.equal(ok,true);
  assert.match(logs,/US_STOCK IDENTITY_PUBLIC_MASTER/);
  assert.match(logs,/US_ETF IDENTITY_PUBLIC_MASTER/);
}
{
  const {ok,logs} = await run(makeRequests({AAPL:makeResponse(200,quotePayload('AAPL',{iem_cd:'USAOTHER'}))}).request);
  assert.equal(ok,false);
  assert.match(logs,/US_STOCK IDENTITY_MISMATCH/);
}
{
  const {ok, logs} = await run(makeRequests({AAPL:makeResponse(200,{message:{rsp_cd:'IGW40301',rsp_msg:secret}})}).request);
  assert.equal(ok,false);
  assert.match(logs,/US_STOCK RESPONSE_SHAPE OUTPUT_MISSING ID_FIELD_NO ID_MATCH_UNKNOWN ID_FORMAT_NONSTRING PRICE_FIELD_NO PRICE_POSITIVE_NO DATE_FIELD_NO DATE_VALID_NO CODE_GATEWAY/);
}
{
  const {ok,logs} = await run(makeRequests({AAPL:makeResponse(200,quotePayload(' AAPL '))}).request);
  assert.equal(ok,false);
  assert.match(logs,/US_STOCK RESPONSE_SHAPE .* ID_FORMAT_PADDED/);
  assert.match(logs,/US_STOCK HTTP_200 INSTRUMENT_UNVERIFIED PREFLIGHT_FAIL/);
}

// Happy path asserts actual contracts, no raw prices or credentials in logs.
{
  const { request, requests } = makeRequests();
  const { ok, logs } = await run(request);
  assert.equal(ok, true);
  assert.equal(requests.length, 7);
  assert.equal(new URL(requests[0].url).pathname, '/oauth2/token');
  assert.equal(requests[0].options.redirect, 'error');
  const apiCalls = requests.filter(x => x.options.method === 'POST').slice(1);
  assert.deepEqual(apiCalls.map(x => new URL(x.url).pathname), [
    '/krstock/quote/v1/currentPrice', '/krstock/quote/v1/etfCurrent',
    '/gbstock/quote/v1/current', '/gbstock/quote/v1/current',
  ]);
  assert.deepEqual(apiCalls.map(x => JSON.parse(x.options.body).Input_0), [
    { iem_cd: '005930', market_cd: 'KRX' }, { iem_cd: '069500' },
    { iem_cd: 'AAPL' }, { iem_cd: 'QQQ' },
  ]);
  assert.equal(apiCalls[0].options.headers.authorization, `Bearer ${token}`);
  assert.ok(requests.filter(x => x.options.method === 'GET').every(x => !x.options.headers));
  assert.match(logs, /US_ETF HTTP_200 PRICE_PRESENT_DATE_FORMAT_VALID_FRESHNESS_UNVERIFIED PREFLIGHT_PASS/);
  assert.match(logs, /QUOTE_PREFLIGHT PASS NIGHT_FUTURE_UNVERIFIED/);
  assert.match(logs, /KOSPI200_NIGHT_FUTURE NOT_RUN_CONTRACT_PENDING/);
}

// HTTP 200 is not success unless the specific instrument and positive quoted price match.
for (const [overrides, expected] of [
  [{ '005930': makeResponse(200, quotePayload('005930', { stck_prpr: '0' })) }, /KR_STOCK HTTP_200 PRICE_INVALID PREFLIGHT_FAIL/],
  [{ '069500': makeResponse(200, quotePayload('005930')) }, /KR_ETF HTTP_200 INSTRUMENT_UNVERIFIED PREFLIGHT_FAIL/],
  [{ AAPL: makeResponse(200, quotePayload('AAPL', { trdprc: 0 })) }, /US_STOCK HTTP_200 PRICE_INVALID PREFLIGHT_FAIL/],
  [{ QQQ: makeResponse(200, quotePayload('QQQ', { trade_date: '20260230' })) }, /US_ETF HTTP_200 TRADE_DATE_INVALID PREFLIGHT_FAIL/],
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
  assert.equal(requests.length, 5);
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


