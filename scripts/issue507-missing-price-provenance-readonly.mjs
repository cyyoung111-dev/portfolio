#!/usr/bin/env node
// #507: privately correlate *first* missing code in the 4 year-boundary days
// with existing price history. Never log code, name, amount, raw source error,
// token, endpoint URL or a full provider response.
import assert from 'node:assert/strict';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {DATES,classifySourceGaps} from './issue507-yearend-carry-readonly.mjs';

const ERROR_CODE=/확정 원자료 부족으로 기존 Snapshot 보존:\s*([A-Za-z0-9._-]+)/;
const CODE=/^[A-Z0-9][A-Z0-9.-]{0,29}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const DISALLOWED=/REALTIME|INDICATIVE|DAILY_CANDLE|UNVERIFIED_CLOSE|GOOGLEFINANCE|^TOSS$|^KRX_CARRY$|^KRX_OTP_CARRY$/i;
const classCode=s=>/^F\d{5}$/.test(s)?'FUND_CODE':
  /^[0-9][0-9A-Z]{5}$/.test(s)?'KOREAN_FORMAT_CODE':
  /^[A-Z]{1,5}(?:[.-][A-Z]{1,2})?$/.test(s)?'LETTER_TICKER_CODE':'OTHER_CODE';
const classSource=s=>{
  s=String(s||'').toUpperCase();
  if(s==='MANUAL')return 'MANUAL';
  if(s.includes('KRX'))return 'KRX_FAMILY';
  if(s.includes('TOSS'))return 'TOSS_FAMILY';
  if(s.includes('YAHOO'))return 'YAHOO_FAMILY';
  if(s.includes('FUND_NAV'))return 'FUND_NAV_FAMILY';
  return s?'OTHER_SOURCE':'SOURCE_BLANK';
};
const safeCount=n=>{
  if(!Number.isSafeInteger(n)||n<0||n>1000000)throw Error('YEARBOUNDARY_COVERAGE_BAD_COUNT');
  return n;
};
export function firstMissingCodes(response) {
  if(response?.status!=='ok'||!Array.isArray(response.diagnostics) ||
      !Array.isArray(response.checkedDates)||response.diagnostics.length!==DATES.length ||
      DATES.some(d=>!response.checkedDates.includes(d)))
    throw Error('YEARBOUNDARY_COVERAGE_DIAG_SCHEMA');
  const found=[];
  for(const date of DATES) {
    const diag=response.diagnostics.find(x=>x?.date===date);
    if(!diag||!Array.isArray(diag.sourceDataErrors)||typeof diag.status!=='string')
      throw Error('YEARBOUNDARY_COVERAGE_DIAG_SCHEMA');
    const kinds=classifySourceGaps(diag.sourceDataErrors);
    const match=diag.sourceDataErrors.map(s=>typeof s==='string'?s.match(ERROR_CODE):null).find(Boolean);
    const code=match?.[1]?.toUpperCase()||'';
    if(code&&!CODE.test(code))throw Error('YEARBOUNDARY_COVERAGE_BAD_CODE');
    found.push({date,status:diag.status,kinds,code});
  }
  return found;
}
function safeSeries(data,codes) {
  if(data?.status!=='ok'||!data.prices||typeof data.prices!=='object' ||
     Array.isArray(data.prices)||!Array.isArray(data.dates))
    throw Error('YEARBOUNDARY_COVERAGE_PRICE_SCHEMA');
  const permitted=new Set(codes);
  const series={};
  for(const [code,rows] of Object.entries(data.prices)){
    // The server must only return the targeted codes, including legacy aliases
    // normalized to the requested canonical key.
    if(!permitted.has(code)||!Array.isArray(rows)||rows.length>20000)
      throw Error('YEARBOUNDARY_COVERAGE_PRICE_SCOPE');
    series[code]=rows.map(item=>{
      if(!item||!DATE.test(item.date)||!(Number(item.price)>0)||
          typeof item.source!=='string'||!Number.isFinite(Number(item.price)))
        throw Error('YEARBOUNDARY_COVERAGE_PRICE_ROW');
      return {date:item.date,source:item.source};
    }).sort((a,b)=>a.date.localeCompare(b.date));
  }
  return series;
}
export function summarizeCoverage(diagnosis,priceResponse) {
  const missing=firstMissingCodes(diagnosis);
  const codes=[...new Set(missing.map(x=>x.code).filter(Boolean))];
  const all=safeSeries(priceResponse,codes);
  const results=missing.map(x=>{
    if(!x.code)return {date:x.date,sourceErrorTypes:x.kinds,
      missingAssetClass:'UNCLASSIFIED',state:'FIRST_CODE_NOT_AVAILABLE'};
    const rows=all[x.code]||[];
    const past=rows.filter(r=>r.date<=x.date);
    const future=rows.filter(r=>r.date>x.date);
    const usable=past.filter(r=>r.source && !DISALLOWED.test(r.source));
    const latestPast=past.at(-1), latestUsable=usable.at(-1), earliestFuture=future[0];
    let state;
    if(!rows.length)state='NO_POSITIVE_PRICE_HISTORY';
    else if(!past.length)state='FUTURE_ONLY';
    else if(!usable.length)state='PAST_PRICE_WITHOUT_VERIFIED_SOURCE';
    else state='PRIOR_PRICE_CANDIDATE_REQUIRES_MATCH_REVIEW';
    return {date:x.date,sourceErrorTypes:x.kinds,
      missingAssetClass:classCode(x.code),state,
      historicalPriceRows:safeCount(rows.length),
      pricesOnOrBeforeDate:safeCount(past.length),
      eligibleSourceRowsOnOrBeforeDate:safeCount(usable.length),
      lastPastPriceDate:latestPast?.date||'-',
      lastEligibleSourceDate:latestUsable?.date||'-',
      lastEligibleSourceFamily:latestUsable?classSource(latestUsable.source):'-',
      firstLaterPriceDate:earliestFuture?.date||'-',
      futurePriceUsed:false};
  });
  return {mode:'READ_ONLY',evaluationDates:DATES,firstMissingChecks:results,
    uniqueMissingCodeCount:safeCount(codes.length),
    originalRowsAltered:false,pricesAltered:false,
    note:'Only FIRST missing code per date; a price candidate is NOT proof of validity'};
}
export async function readLive({url,token,fetchImpl=fetch}){
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())
    throw Error('YEARBOUNDARY_COVERAGE_AUTH_MISSING');
  async function request(action,options={},credential=token){
    let res;
    try{
      res=await fetchImpl(endpoint,{method:'POST',redirect:'follow',
        headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
        body:new URLSearchParams({action,...options,accessToken:credential}),
        signal:AbortSignal.timeout(240000)});
    }catch{throw Error('YEARBOUNDARY_COVERAGE_NETWORK');}
    if(!res?.ok)throw Error('YEARBOUNDARY_COVERAGE_HTTP');
    try{return await res.json();}
    catch{throw Error('YEARBOUNDARY_COVERAGE_JSON');}
  }
  const bad=token==='YEARBOUNDARY_BAD_AUTH'?'YEARBOUNDARY_BAD_AUTH2':'YEARBOUNDARY_BAD_AUTH';
  const denied=await request('getPriceHistory',{codes:'000001'},bad);
  if(denied?.status!=='error'||denied.message!=='인증 실패')
    throw Error('YEARBOUNDARY_COVERAGE_AUTH_GUARD');
  const diagnosis=await request('diagnoseSnapshotIntegrityRange',{dates:DATES.join(',')});
  const missing=firstMissingCodes(diagnosis);
  const codes=[...new Set(missing.map(x=>x.code).filter(Boolean))];
  if(!codes.length)return summarizeCoverage(diagnosis,{status:'ok',dates:[],prices:{}});
  // The API scans one sheet but returns only requested canonical codes.
  const prices=await request('getPriceHistory',{codes:codes.join(',')});
  return summarizeCoverage(diagnosis,prices);
}
export async function selfTest(){
  const diag={status:'ok',checkedDates:[...DATES],diagnostics:DATES.map((date,i)=>({
    date,status:'SOURCE_INCOMPLETE',
    sourceDataErrors:['확정 원자료 부족으로 기존 Snapshot 보존: '+(i===3?'000002':'0046Y0')]
  }))};
  const prices={status:'ok',dates:['2025-12-30','2026-01-02'],prices:{
    '0046Y0':[{date:'2025-12-30',price:135,source:'KRX_CONFIRMED_CLOSE'},
      {date:'2026-01-02',price:138,source:'KRX_CONFIRMED_CLOSE'}],
    '000002':[{date:'2026-01-02',price:115,source:'MANUAL'}]
  }};
  const a=summarizeCoverage(diag,prices);
  assert.equal(a.uniqueMissingCodeCount,2);
  assert.equal(a.firstMissingChecks[2].lastEligibleSourceDate,'2025-12-30');
  assert.equal(a.firstMissingChecks[2].lastEligibleSourceFamily,'KRX_FAMILY');
  assert.equal(a.firstMissingChecks[2].state,'PRIOR_PRICE_CANDIDATE_REQUIRES_MATCH_REVIEW');
  assert.equal(a.firstMissingChecks[3].state,'PRIOR_PRICE_CANDIDATE_REQUIRES_MATCH_REVIEW');
  assert.ok(!JSON.stringify(a).includes('0046Y0'));
  assert.ok(!JSON.stringify(a).includes('000002'));
  const b=summarizeCoverage(diag,{status:'ok',dates:[],prices:{}});
  assert.equal(b.firstMissingChecks[0].state,'NO_POSITIVE_PRICE_HISTORY');
  const future={status:'ok',dates:['2026-01-05'],prices:{'0046Y0':[
    {date:'2026-01-05',price:777,source:'KRX_CONFIRMED_CLOSE'}]}};
  const f=summarizeCoverage({...diag,diagnostics:diag.diagnostics.map(z=>({
    ...z,sourceDataErrors:[diag.diagnostics[0].sourceDataErrors[0]]}))},future);
  assert.equal(f.firstMissingChecks[2].state,'FUTURE_ONLY');
  assert.equal(f.firstMissingChecks[2].firstLaterPriceDate,'2026-01-05');
  assert.ok(f.firstMissingChecks.every(x=>x.futurePriceUsed===false));
  const unverified=summarizeCoverage(diag,{status:'ok',dates:['2025-12-30'],
    prices:{'0046Y0':[{date:'2025-12-30',price:10,source:'TOSS'}]}});
  assert.equal(unverified.firstMissingChecks[2].state,'PAST_PRICE_WITHOUT_VERIFIED_SOURCE');
  assert.throws(()=>summarizeCoverage(diag,{status:'ok',dates:[],prices:{
    '000999':[{date:'2025-12-30',price:1,source:'MANUAL'}]}}),
  /YEARBOUNDARY_COVERAGE_PRICE_SCOPE/);
  const calls=[];
  const mockFetch=async(_url,req)=>{
    calls.push({action:req.body.get('action'),code:req.body.get('codes'),secret:req.body.get('accessToken')});
    if(req.body.get('accessToken')!=='SYNTHETIC_CREDENTIAL')
      return {ok:true,json:async()=>({status:'error',message:'인증 실패'})};
    return {ok:true,json:async()=>req.body.get('action')==='getPriceHistory'?prices:diag};
  };
  const live=await readLive({url:'https://script.google.com/macros/s/TEST/exec',
    token:'SYNTHETIC_CREDENTIAL',fetchImpl:mockFetch});
  assert.equal(live.uniqueMissingCodeCount,2);
  assert.deepEqual(calls.map(x=>x.action),
    ['getPriceHistory','diagnoseSnapshotIntegrityRange','getPriceHistory']);
  assert.equal(calls[2].code,'0046Y0,000002');
  assert.ok(!JSON.stringify(live).includes('SYNTHETIC_CREDENTIAL'));
  console.log('Issue #507 confirmed history existence and alias-scope READ ONLY: PASS');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    if(process.argv.includes('--self-test'))await selfTest();
    else console.log(JSON.stringify(await readLive({
      url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN})));
  }catch(e){
    // Never emit raw API source errors, account data or credentials.
    if(process.argv.includes('--self-test'))
      console.error(String(e?.stack||e).slice(0,1800));
    else {
      const s=String(e?.message||'');
      console.error(/^YEARBOUNDARY_COVERAGE_[A-Z_]+$/.test(s)?s:'YEARBOUNDARY_COVERAGE_UNKNOWN');
    }
    process.exitCode=1;
  }
}
