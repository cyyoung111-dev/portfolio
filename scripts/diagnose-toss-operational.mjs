#!/usr/bin/env node
// Observe live GAS -> Toss OAuth and resource responses. Never print secrets, URL, IP or response bodies.
// GAS may update diagnostic metadata and token cache, but does not write portfolio Sheets.
import fs from 'node:fs';

const endpointNames = ['exchangeRate','marketCalendarKR','marketCalendarUS','marketIndicatorPrices','marketIndicatorCandles'];
const safe = v => /^[A-Za-z0-9_-]{1,80}$/.test(String(v||'')) ? String(v) : 'UNSPECIFIED';
const httpStatus = v => v==null ? null : (Number.isInteger(Number(v)) && Number(v)>=100 && Number(v)<=599 ? Number(v) : null);

export function validateGasUrl(value) {
  let url;
  try { url=new URL(String(value||'')); } catch { throw Error('TOSS_DIAG_INVALID_GAS_URL'); }
  if (url.protocol!=='https:' || url.hostname!=='script.google.com'
      || !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname) || url.username || url.password
      || url.search || url.hash) throw Error('TOSS_DIAG_INVALID_GAS_URL');
  return url.href;
}

export function summarizeTossDiagnostic(data,expectedVersion) {
  if (!data || data.status!=='ok' || String(data.gasVersion)!==expectedVersion)
    throw Error('TOSS_DIAG_GAS_VERSION_OR_CONTRACT_MISMATCH');
  const oauth=data.oauth,smoke=data.priceSmoke,all=data.endpoints;
  if (!oauth || typeof oauth.ok!=='boolean' || !smoke || typeof smoke.ok!=='boolean'
      || !Array.isArray(all) || all.length!==endpointNames.length
      || new Set(all.map(x=>x?.name)).size!==endpointNames.length
      || !endpointNames.every(name=>all.some(x=>x?.name===name && typeof x.ok==='boolean')))
    throw Error('TOSS_DIAG_INVALID_RESPONSE');
  const endpoints=endpointNames.map(name=>{
    const row=all.find(x=>x.name===name);
    return {name,ok:row.ok,httpStatus:httpStatus(row.status),code:safe(row.code),providerCode:safe(row.providerCode),
      count:Number.isSafeInteger(Number(row.count))&&Number(row.count)>=0?Number(row.count):null};
  });
  const quoteValid=smoke.ok===true && smoke.validLastPrice===true
    && smoke.timestampPresent===true && httpStatus(smoke.status)===200
    && Number(smoke.resultCount)>0;
  const oauthValid=oauth.ok===true && ['CACHE','NETWORK'].includes(oauth.source);
  return {
    mode:'LIVE_GAS_TOSS_OBSERVATION',gasVersion:expectedVersion,
    oauth:{ok:oauth.ok,source:safe(oauth.source),httpStatus:httpStatus(oauth.status),
      code:safe(oauth.code),providerCode:safe(oauth.providerCode),
      ...(oauth.recovery?.attempted?{recoveryCode:safe(oauth.recovery.code)}:{})},
    prices005930:{ok:quoteValid,httpStatus:httpStatus(smoke.status),
      code:safe(smoke.code),providerCode:safe(smoke.providerCode),resultCount:Number(smoke.resultCount)||0,
      validPrice:smoke.validLastPrice===true,timestampPresent:smoke.timestampPresent===true},
    endpoints,coreHealthy:oauthValid&&quoteValid,
    allHealthy:oauthValid&&quoteValid&&endpoints.every(x=>x.ok)&&data.ok===true,
    freshOAuthConfirmed:!!data.freshOAuthTested&&oauth.source==='NETWORK'
  };
}

export async function runTossDiagnostic({url,token,expectedVersion,fetchImpl=fetch}) {
  const endpoint=validateGasUrl(url);
  if(typeof token!=='string'||!token.trim())throw Error('TOSS_DIAG_GAS_ACCESS_TOKEN_REQUIRED');
  const call=async accessToken=>{
    let res;
    try{res=await fetchImpl(endpoint,{
      method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({action:'diagnoseTossMarketData',accessToken}),
      redirect:'follow',signal:AbortSignal.timeout(90000)
    });}catch{throw Error('TOSS_DIAG_GAS_REQUEST_FAILED');}
    if(!res.ok)throw Error('TOSS_DIAG_GAS_HTTP_ERROR');
    try{return await res.json();}catch{throw Error('TOSS_DIAG_GAS_NON_JSON');}
  };
  const badToken=token==='TOSS_DIAG_DENY_PROBE_20261015'?'TOSS_DIAG_DENY_PROBE_ALTERNATE':'TOSS_DIAG_DENY_PROBE_20261015';
  const denied=await call(badToken);
  if(denied?.status!=='error'||denied?.message!=='인증 실패')
    throw Error('TOSS_DIAG_GAS_AUTH_BYPASS');
  const data=await call(token);
  if(data?.status==='error'&&data?.message==='인증 실패')
    throw Error('TOSS_DIAG_GAS_ACCESS_DENIED');
  return summarizeTossDiagnostic(data,expectedVersion);
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    const source=fs.readFileSync('src/gas/apps_script.gs','utf8');
    const version=source.match(/Google Apps Script\s+v(\d+\.\d+)/)?.[1];
    if(!version)throw Error('TOSS_DIAG_EXPECTED_VERSION_MISSING');
    const result=await runTossDiagnostic({
      url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,expectedVersion:version
    });
    console.log(JSON.stringify(result));
    if(!result.allHealthy)process.exitCode=1;
  }catch(e){
    const code=/^TOSS_DIAG_[A-Z0-9_]+$/.test(String(e?.message))?e.message:'TOSS_DIAG_UNEXPECTED_FAILURE';
    console.error(JSON.stringify({mode:'LIVE_GAS_TOSS_OBSERVATION',allHealthy:false,errorCode:code}));
    process.exitCode=1;
  }
}
