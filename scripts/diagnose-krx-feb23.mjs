import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

// Read-only: presence proof plus existing historical-price response; never persist prices.
export async function diagnose({url,token,fetchImpl=fetch}) {
  const endpoint=validateWebAppUrl(url), date='2026-02-23';
  if(typeof token!=='string'||!token.trim())throw Error('AUTH_REQUIRED');
  async function request(key) {
    const response=await fetchImpl(endpoint,{method:'POST',redirect:'follow',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({action:'getKrxHeldCloseCoverage',date,code:'102970',accessToken:key}),
      signal:AbortSignal.timeout(240000)});
    if(!response.ok)throw Error('HTTP_ERROR');
    return response.json();
  }
  const bad=token==='DENIED_PROBE'?'DENIED_PROBE_2':'DENIED_PROBE';
  const denied=await request(bad);
  if(denied?.status!=='error'||denied.message!=='인증 실패')throw Error('AUTH_GUARD');
  const result=await request(token), t=result?.targetEvidence;
  if(result?.status!=='ok'||result.coverage?.mode!=='READ_ONLY'||result.coverage.requestedDate!==date||
    !t||t.requested!==true||typeof t.eligibleHeldDomestic!=='boolean'||typeof t.exactDateConfirmed!=='boolean'||
    !['KRX_OPENAPI','KRX_OTP','NOT_CONFIRMED'].includes(t.providerClass)||
    (t.exactDateConfirmed&&(!t.eligibleHeldDomestic||t.usedDate!==date||t.providerClass==='NOT_CONFIRMED'))||
    (!t.exactDateConfirmed&&(t.usedDate||t.providerClass!=='NOT_CONFIRMED')))throw Error('BAD_EVIDENCE');
  if(!t.exactDateConfirmed)throw Error('OFFICIAL_NOT_READY');
  const historicalUrl=new URL(endpoint);
  historicalUrl.search=new URLSearchParams({date,allCodes:'102970',accessToken:token});
  const historical=await fetchImpl(historicalUrl.href,{redirect:'follow',signal:AbortSignal.timeout(240000)});
  if(!historical.ok)throw Error('HISTORICAL_HTTP');
  const payload=await historical.json(), row=payload?.prices?.['102970'];
  if(payload?.status!=='ok'||payload.date!==date||!row||row.usedDate!==date||
    !['KRX','KRX_OTP'].includes(row.source)||typeof row.price!=='number'||
    !Number.isFinite(row.price)||row.price<=0)throw Error('HISTORICAL_UNCONFIRMED');
  // Read the uncached production ledger-based graph detail; never log holdings.
  const response=await fetchImpl(endpoint,{method:'POST',redirect:'follow',
    headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
    body:new URLSearchParams({action:'getHistorySourceDetail',date,accessToken:token}),
    signal:AbortSignal.timeout(240000)});
  if(!response.ok)throw Error('GRAPH_HTTP');
  const detail=await response.json();
  if(detail?.status!=='ok'||detail.date!==date||detail.sourceMode!=='SOURCE_RECOMPUTED'||
    !Array.isArray(detail.items)||!detail.items.length)throw Error('GRAPH_REBUILD_FAILED');
  const targets=detail.items.filter(item=>item?.code==='102970');
  if(targets.length!==1||targets[0].evalUnit!==row.price||
    !['KRX','KRX_OTP'].includes(targets[0].source))throw Error('GRAPH_OFFICIAL_PRICE_MISMATCH');
  return {mode:'READ_ONLY',date,confirmed:true,price:row.price,source:row.source,sourceDate:row.usedDate,
    graphDateRecomputed:true,graphOfficialPriceMatches:true};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 if(process.argv.includes('--self-test')){
  const fetchImpl=async (_url,opts)=>({ok:true,json:async()=>!opts.body
    ? {status:'ok',date:'2026-02-23',prices:{'102970':{price:100,usedDate:'2026-02-23',source:'KRX'}}}
    : opts.body.get('action')==='getHistorySourceDetail'
    ? {status:'ok',date:'2026-02-23',sourceMode:'SOURCE_RECOMPUTED',items:[{code:'102970',evalUnit:100,source:'KRX'}]}
    : opts.body.get('accessToken')==='secret'
    ? {status:'ok',coverage:{mode:'READ_ONLY',requestedDate:'2026-02-23'},targetEvidence:{requested:true,eligibleHeldDomestic:true,exactDateConfirmed:true,usedDate:'2026-02-23',providerClass:'KRX_OPENAPI'}}
    : {status:'error',message:'인증 실패'}});
  const x=await diagnose({url:'https://script.google.com/macros/s/AKfycbTest/exec',token:'secret',fetchImpl});
  assert.equal(x.price,100);assert.equal(x.confirmed,true);assert.equal(x.date,'2026-02-23');assert.equal(x.graphDateRecomputed,true);assert.equal(x.graphOfficialPriceMatches,true);
  for(const change of [{evalUnit:99},{source:'KRX_CARRY@2026-02-11'}]){
    const badFetch=async(u,o)=>o.body?.get('action')==='getHistorySourceDetail'
      ? {ok:true,json:async()=>({status:'ok',date:'2026-02-23',sourceMode:'SOURCE_RECOMPUTED',items:[{code:'102970',evalUnit:100,source:'KRX',...change}]})}
      : fetchImpl(u,o);
    await assert.rejects(()=>diagnose({url:'https://script.google.com/macros/s/AKfycbTest/exec',token:'secret',fetchImpl:badFetch}),/GRAPH_OFFICIAL_PRICE_MISMATCH/);
  }
  console.log('공식 종가 및 실제 그래프 재계산 응답 계약 PASS');
 }else{
  try{console.log(JSON.stringify(await diagnose({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN})));}
  catch{console.error('DIAGNOSTIC_FAILED');process.exitCode=1;}
 }
}
