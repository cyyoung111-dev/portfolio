#!/usr/bin/env node
// READ-ONLY production KRX diagnostics. Does not change GAS/Sheet properties or data.
// Print only market name, status, row counts and schema status; never raw API responses.
const MARKETS = Object.freeze(['KOSPI', 'KOSDAQ', 'ETF']);
const PARSE_STATUSES = new Set(['ROWS', 'EMPTY', 'NON_JSON', 'UNEXPECTED_SCHEMA', 'NOT_PARSED']);
export function parseDates(value) {
  const dates = String(value || '').split(',').map(date => date.trim());
  if (dates.some(date => !date) || dates.length < 1 || dates.length > 7
      || new Set(dates).size !== dates.length)
    throw new Error('KRX_DIAG_INVALID_DATES');
  for (const date of dates) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + 'T00:00:00Z') : null;
    if (!day || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date)
      throw new Error('KRX_DIAG_INVALID_DATE');
  }
  return dates;
}
export function validateWebAppUrl(value) {
  let url;
  try { url = new URL(String(value || '')); }
  catch { throw new Error('KRX_DIAG_INVALID_WEB_APP_URL'); }
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com'
      || url.username || url.password
      || !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname) || url.search || url.hash)
    throw new Error('KRX_DIAG_INVALID_WEB_APP_URL');
  return url.href;
}
export function summarizeKrxSource(data, date) {
  if (!data || data.status !== 'ok' || data.requestedDate !== date
      || typeof data.keyConfigured !== 'boolean')
    throw new Error('KRX_DIAG_INVALID_SOURCE_RESPONSE');
  const configured = data.keyConfigured;
  const networkStatus = !configured ? 'NOT_CONFIGURED'
    : data.networkStatus === 'RECEIVED' ? 'RECEIVED'
    : data.networkStatus === 'FETCH_FAILED' ? 'FETCH_FAILED' : 'UNAVAILABLE';
  const incoming = data.markets;
  if (!Array.isArray(incoming) || incoming.length > MARKETS.length
      || (!configured && incoming.length !== 0)
      || (networkStatus === 'RECEIVED' && incoming.length !== MARKETS.length))
    throw new Error('KRX_DIAG_INVALID_MARKET_LIST');
  const validateMeta = (item, requireMarket = true) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
        || (requireMarket && !MARKETS.includes(item.market)))
      throw new Error('KRX_DIAG_INVALID_MARKET_RESPONSE');
    const httpStatus = Number(item.httpStatus), rows = Number(item.rows);
    const exact = item.exactDateRows === undefined ? null : Number(item.exactDateRows);
    const parseStatus = String(item.parseStatus || '');
    if (!Number.isInteger(httpStatus) || httpStatus < 0 || httpStatus > 599
        || !Number.isInteger(rows) || rows < 0
        || (exact !== null && (!Number.isInteger(exact) || exact < 0 || exact > rows))
        || !PARSE_STATUSES.has(parseStatus))
      throw new Error('KRX_DIAG_INVALID_MARKET_RESPONSE');
    return { market:item.market, httpStatus, rows,
      ...(exact === null ? {} : { exactDateRows:exact }), parseStatus };
  };
  const byMarket = new Map();
  for (const item of incoming) {
    if (!item || !MARKETS.includes(item.market) || byMarket.has(item.market))
      throw new Error('KRX_DIAG_INVALID_MARKET_LIST');
    byMarket.set(item.market,validateMeta(item));
  }
  const markets = MARKETS.map(name=>byMarket.get(name)
    || { market:name,httpStatus:0,rows:0,parseStatus:'NOT_PARSED' });
  const credentialSource = ['krx_auth_key','krx_api_key','NONE'].includes(data.credentialSource)
    ? data.credentialSource : 'UNKNOWN';
  const alternativeConfigured = typeof data.alternativeConfigured === 'boolean'
    ? data.alternativeConfigured : null;
  const rawAlt = Array.isArray(data.alternateProbes) ? data.alternateProbes : [];
  if (rawAlt.length > MARKETS.length) throw new Error('KRX_DIAG_INVALID_MARKET_LIST');
  const altByMarket = new Map();
  for (const item of rawAlt) {
    if (!item || !MARKETS.includes(item.market) || altByMarket.has(item.market))
      throw new Error('KRX_DIAG_INVALID_MARKET_LIST');
    const meta=validateMeta(item);
    if (typeof item.hasRows !== 'boolean'
        || item.hasRows !== (Number(meta.exactDateRows||0)>0))
      throw new Error('KRX_DIAG_INVALID_MARKET_RESPONSE');
    altByMarket.set(meta.market,{...meta,hasRows:item.hasRows});
  }
  const legacy = data.alternateProbe;
  const alternateProbe = rawAlt.length
    ? (altByMarket.get(rawAlt[0].market) || null)
    : (legacy && typeof legacy === 'object'
      && Number.isInteger(Number(legacy.httpStatus))
      && Number(legacy.httpStatus)>=0 && Number(legacy.httpStatus)<=599
      && typeof legacy.hasRows === 'boolean'
      ? {market:MARKETS.includes(legacy.market)?legacy.market:'',httpStatus:Number(legacy.httpStatus),
        hasRows:legacy.hasRows} : null);
  const alternateProbes = MARKETS.filter(name=>altByMarket.has(name))
    .map(name=>altByMarket.get(name));
  // Legacy GAS cannot prove BAS_DD matches the requested day. Fail closed
  // instead of treating generic row counts from an earlier day as exact-date data.
  const reachableMarkets = markets.map(market=>{
    const alt=altByMarket.get(market.market);
    const primary=market.httpStatus===200 && market.parseStatus==='ROWS'
      && Number(market.exactDateRows || 0) > 0;
    const alternate=!!alt && alt.httpStatus===200 && alt.parseStatus==='ROWS'
      && alt.exactDateRows > 0;
    return {market:market.market,primary,alternate,reachable:primary||alternate};
  });
  const stored=data.storedCoverage;
  let storedCoverage=null;
  if (stored && typeof stored==='object' && !Array.isArray(stored)) {
    const status=String(stored.status||'');
    if (!['OK','READ_FAILED','SHEET_MISSING','MASTER_EMPTY'].includes(status))
      throw new Error('KRX_DIAG_INVALID_SOURCE_RESPONSE');
    storedCoverage={status};
    if (status==='OK') {
      const fields=['expectedHeldCodes','expectedStock','expectedEtf','priceHistoryRows',
        'officialExactDateCodes','nonOfficialHeldCodes','missingOfficialCodes',
        'snapshotRows','snapshotHeldCodes','missingSnapshotCodes'];
      for (const field of fields) {
        const value=Number(stored[field]);
        if (!Number.isSafeInteger(value)||value<0)
          throw new Error('KRX_DIAG_INVALID_SOURCE_RESPONSE');
        storedCoverage[field]=value;
      }
      if (typeof stored.queuedForBackfill !== 'boolean'
          || storedCoverage.expectedStock+storedCoverage.expectedEtf!==storedCoverage.expectedHeldCodes
          || storedCoverage.officialExactDateCodes+storedCoverage.missingOfficialCodes!==storedCoverage.expectedHeldCodes
          || storedCoverage.snapshotHeldCodes+storedCoverage.missingSnapshotCodes!==storedCoverage.expectedHeldCodes)
        throw new Error('KRX_DIAG_INVALID_SOURCE_RESPONSE');
      storedCoverage.queuedForBackfill=stored.queuedForBackfill;
    }
  }
  // A live KRX API can return exact-date rows while the actual held-stock
  // price history and Snapshot are missing. This is a full operational gate,
  // not a mere API reachability probe; missing/legacy coverage fails closed.
  const coverageHealthy = !!storedCoverage && storedCoverage.status === 'OK'
    && storedCoverage.missingOfficialCodes === 0
    && storedCoverage.missingSnapshotCodes === 0
    && storedCoverage.queuedForBackfill === false;
  const healthy = configured && networkStatus === 'RECEIVED'
    && reachableMarkets.every(item=>item.reachable) && coverageHealthy;
  return {date,keyConfigured:configured,networkStatus,markets,
    credentialSource,alternativeConfigured,alternateProbe,alternateProbes,
    reachableMarkets,storedCoverage,healthy};
}
// Read-only close verification complements market HTTP/schema checks: an
// HTTP-200 OutBlock_1 can still fail code matching or close-date validation.
export function summarizeOfficialCloses(data, date) {
  if (!data || data.status !== 'ok' || data.requestedDate !== date
      || !data.closes || typeof data.closes !== 'object' || Array.isArray(data.closes))
    throw new Error('KRX_DIAG_INVALID_STOCK_RESPONSE');
  const requestedCodes = ['005930','000660'];
  const closes = requestedCodes.map(code => {
    const item = data.closes[code];
    if (!item) return { code, confirmed:false };
    const price = Number(item.price);
    const valid = item.code === code && item.requestedDate === date
      && item.usedDate === date && Number.isFinite(price) && price > 0
      && item.source === 'KRX_OFFICIAL'
      && ['KRX','KRX_OTP'].includes(item.providerSource);
    return { code, confirmed:valid, ...(valid ? { price, providerSource:item.providerSource } : {}) };
  });
  return { requestedDate:date, closes, healthy:closes.every(item => item.confirmed) };
}
export function buildSafeRequest(action, date, token) {
  if (!['getAutomationStatus', 'getKrxSourceDiagnostics', 'getKrxOfficialStockCloses'].includes(action))
    throw new Error('KRX_DIAG_FORBIDDEN_ACTION');
  const payload = new URLSearchParams({ action });
  if (date) payload.set('date', parseDates(date)[0]);
  if (action === 'getKrxOfficialStockCloses') {
    if (!date) throw new Error('KRX_DIAG_INVALID_DATE');
    payload.set('codes','005930,000660'); // read-only, fixed sampling scope
  }
  if (token) payload.set('accessToken', token);
  return payload;
}
export async function readGasAction(url, action, date, token, fetchImpl = fetch) {
  const body = buildSafeRequest(action, date, token);
  let response;
  try {
    response = await fetchImpl(validateWebAppUrl(url), {
      method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body, redirect:'follow', signal:AbortSignal.timeout(30000),
    });
  } catch { throw new Error('KRX_DIAG_FETCH_FAILED'); }
  if (!response.ok) throw new Error('KRX_DIAG_GAS_HTTP_' + response.status);
  try { return await response.json(); }
  catch { throw new Error('KRX_DIAG_GAS_NON_JSON'); }
}
export async function runDiagnosis({ url, token, dates, fetchImpl = fetch }) {
  const checkedDates = parseDates(dates);
  // Operational diagnostics are intentionally authenticated even if a GAS
  // deployment accidentally becomes public. Never run with a missing secret.
  if (typeof token !== 'string' || !token.trim())
    throw new Error('KRX_DIAG_GAS_ACCESS_TOKEN_NOT_CONFIGURED');
  // getSettings is NOT read-only: it may settle a pending code-delete
  // transaction. getAutomationStatus is a read-only, versioned route.
  const settings = await readGasAction(url,'getAutomationStatus','',token,fetchImpl);
  if (settings && settings.status === 'error'
      && String(settings.message || '') === '인증 실패')
    throw new Error('KRX_DIAG_GAS_ACCESS_DENIED');
  if (!settings || settings.status !== 'ok'
      || !/^\d+\.\d+$/.test(String(settings.gasVersion || '')))
    throw new Error('KRX_DIAG_GAS_VERSION_UNAVAILABLE');
  // Probe with an intentionally incorrect non-secret token. Public GAS
  // deployments must fail instead of claiming authenticated diagnostics.
  const invalidToken = token === 'KRX_READ_ONLY_AUTH_PROBE_20261014'
    ? 'KRX_READ_ONLY_AUTH_PROBE_20261014_ALT' : 'KRX_READ_ONLY_AUTH_PROBE_20261014';
  const negative = await readGasAction(url,'getAutomationStatus','',invalidToken,fetchImpl);
  if (!negative || negative.status !== 'error'
      || String(negative.message || '') !== '인증 실패')
    throw new Error('KRX_DIAG_GAS_AUTHENTICATION_DISABLED');
  const reports = [];
  for (const date of checkedDates) {
    try {
      const data = await readGasAction(url,'getKrxSourceDiagnostics',date,token,fetchImpl);
      const source = summarizeKrxSource(data,date);
      let stockCloses;
      try {
        const closeData = await readGasAction(url,'getKrxOfficialStockCloses',date,token,fetchImpl);
        stockCloses = summarizeOfficialCloses(closeData,date);
      } catch {
        // Do not leak the raw response when GAS provider fallback fails.
        stockCloses = { requestedDate:date, closes:[], healthy:false, errorCode:'KRX_DIAG_STOCK_CHECK_FAILED' };
      }
      reports.push({ ...source, stockCloses, healthy:source.healthy && stockCloses.healthy });
    } catch (error) {
      // The live KRX dates are independent. Report a sanitized per-day GAS
      // transport/schema failure and continue inspecting the other dates.
      // Never log the exception text, token, URL, or original response body.
      const code = String(error && error.message || '');
      const allowCode = /^KRX_DIAG_GAS_HTTP_[1-5][0-9]{2}$/.test(code)
        || ['KRX_DIAG_FETCH_FAILED','KRX_DIAG_GAS_NON_JSON',
            'KRX_DIAG_INVALID_SOURCE_RESPONSE','KRX_DIAG_INVALID_MARKET_LIST',
            'KRX_DIAG_INVALID_MARKET_RESPONSE'].includes(code);
      reports.push({
        date,
        keyConfigured:null,
        networkStatus:code.startsWith('KRX_DIAG_INVALID_') ? 'INVALID_RESPONSE' : 'GAS_REQUEST_FAILED',
        markets:MARKETS.map(market=>({market,httpStatus:0,rows:0,parseStatus:'NOT_PARSED'})),
        errorCode:allowCode?code:'KRX_DIAG_UNKNOWN_ERROR',
        healthy:false,
      });
    }
  }
  return { mode:'READ_ONLY', gasVersion:String(settings.gasVersion), reports,
    healthy:reports.every(item => item.healthy) };
}
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  try {
    const argIndex = process.argv.indexOf('--dates');
    const dates = argIndex >= 0 ? process.argv[argIndex+1] : '2026-10-07,2026-10-08';
    const report = await runDiagnosis({
      url:process.env.GAS_WEB_APP_URL,
      token:process.env.GAS_ACCESS_TOKEN,
      dates,
    });
    console.log(JSON.stringify(report)); // no raw body, token, URL or credentials
    if (!report.healthy) process.exitCode = 1;
  } catch (error) {
    // Only known constant diagnostic error codes are displayed.
    const code = /^KRX_DIAG_[A-Z0-9_]+$/.test(error.message) ? error.message : 'KRX_DIAG_UNKNOWN_ERROR';
    console.error(code);
    process.exitCode = 1;
  }
}
