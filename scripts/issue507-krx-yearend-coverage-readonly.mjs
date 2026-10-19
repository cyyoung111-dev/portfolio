#!/usr/bin/env node
// Issue 507 — historical KRX official-source *aggregate* coverage, READ ONLY.
// Do not expose raw ledger rows, first missing code, KRX credentials, prices,
// personal account details or network errors in logs. Aggregate coverage is
// NOT proof that one particular ticker has an official historic close.
import assert from 'node:assert/strict';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {DATES} from './issue507-yearend-carry-readonly.mjs';
import {firstMissingCodes} from './issue507-missing-price-provenance-readonly.mjs';

const TRADE_DATES=Object.freeze(['2025-09-03','2025-12-30']);
const bounded=x=>{
  if(!Number.isSafeInteger(x)||x<0||x>100000)throw Error('ISSUE507_KRX_BAD_COUNT');
  return x;
};
const code=x=>String(x||'').trim().toUpperCase().padStart(/^\d+$/.test(String(x||'').trim())?6:0,'0');
export function summarizeCoverage(diagnosis, tradeResponse, replies) {
  const missing=firstMissingCodes(diagnosis);
  const codes=[...new Set(missing.map(x=>x.code).filter(Boolean))];
  if(tradeResponse?.status!=='ok'||!Array.isArray(tradeResponse.trades) ||
    !Array.isArray(replies)||replies.length!==TRADE_DATES.length)
    throw Error('ISSUE507_KRX_SOURCE_SCHEMA');
  const observations=TRADE_DATES.map((date,i)=>{
    const result=replies[i],c=result?.coverage;
    if(result?.status!=='ok'||!c||c.requestedDate!==date||c.mode!=='READ_ONLY')
      throw Error('ISSUE507_KRX_SOURCE_SCHEMA');
    const values=['expectedHeldCodes','officialExactDateCodes','missingCodes',
      'staleCodes','duplicateMasterCodes','orphanLedgerCodes'];
    for(const k of values)bounded(c[k]);
    if(c.officialExactDateCodes>c.expectedHeldCodes ||
       c.missingCodes>c.expectedHeldCodes ||
       c.officialExactDateCodes+c.missingCodes!==c.expectedHeldCodes)
      throw Error('ISSUE507_KRX_INCONSISTENT_COUNTS');
    const active=codes.map(target=>{
      const rows=tradeResponse.trades.filter(t=>code(t?.code)===target &&
        /^\d{4}-\d{2}-\d{2}$/.test(t.date||'') && t.date<=date);
      let held=0;
      for(const t of rows){
        const qty=Number(t.qty);
        if(!Number.isFinite(qty)||qty<0)throw Error('ISSUE507_KRX_INVALID_LEDGER');
        if(t.tradeType==='buy')held+=qty;
        if(t.tradeType==='sell')held=Math.max(0,held-qty);
      }
      return {priorTradeCount:bounded(rows.length),ledgerPositiveHolding:held>0.0001,
        firstLedgerTradeDate:rows.map(t=>t.date).sort()[0]||'-'};
    });
    const fullyCovered=c.expectedHeldCodes>0&&c.officialExactDateCodes===c.expectedHeldCodes &&
      c.duplicateMasterCodes===0&&c.orphanLedgerCodes===0;
    return {date,firstMissingCodeCount:bounded(codes.length),
      firstMissingCodeLedgerHistory:active,
      krxEligibleHeldCount:bounded(c.expectedHeldCodes),
      krxExactDateCloseCount:bounded(c.officialExactDateCodes),
      krxMissingCount:bounded(c.missingCodes),
      krxStaleCount:bounded(c.staleCodes),
      orphanLedgerCodeCount:bounded(c.orphanLedgerCodes),
      duplicateMasterCodeCount:bounded(c.duplicateMasterCodes),
      overallOfficialCoverage:fullyCovered?'FULL_AGGREGATE_COVERAGE':'INCOMPLETE_OR_UNVERIFIED',
      targetCodeExactPriceIndividuallyProven:false,
      noPriceWritten:true,noSnapshotWritten:true,noLedgerWritten:true};
  });
  return {mode:'READ_ONLY',observations,
    note:'KRX official aggregate coverage alone cannot certify one specific held code',
    overwriteAllowed:false};
}
export async function readLive({url,token,fetchImpl=fetch}){
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())throw Error('ISSUE507_KRX_AUTH_MISSING');
  async function request(action,more={},credential=token){
    let response;
    try{response=await fetchImpl(endpoint,{method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({action,...more,accessToken:credential}),
      signal:AbortSignal.timeout(240000),redirect:'follow'});}
    catch{throw Error('ISSUE507_KRX_NETWORK');}
    if(!response?.ok)throw Error('ISSUE507_KRX_HTTP');
    try{return await response.json();}
    catch{throw Error('ISSUE507_KRX_JSON');}
  }
  const invalid=token==='ISSUE507_KRX_INVALID'?'ISSUE507_KRX_INVALID2':'ISSUE507_KRX_INVALID';
  const denied=await request('getKrxHeldCloseCoverage',{date:TRADE_DATES[0]},invalid);
  if(denied?.status!=='error'||denied.message!=='인증 실패')
    throw Error('ISSUE507_KRX_AUTH_BROKEN');
  const diagnosis=await request('diagnoseSnapshotIntegrityRange',{dates:DATES.join(',')});
  const trades=await request('getTrades');
  const results=[];
  for(const date of TRADE_DATES)
    results.push(await request('getKrxHeldCloseCoverage',{date}));
  return summarizeCoverage(diagnosis,trades,results);
}
export async function selfTest(){
  const diag={status:'ok',checkedDates:[...DATES],diagnostics:DATES.map(date=>({
    date,status:'SOURCE_INCOMPLETE',
    sourceDataErrors:['확정 원자료 부족으로 기존 Snapshot 보존: PRIVATE_CODE']
  }))};
  const ledger={status:'ok',trades:[{date:'2025-09-03',code:'PRIVATE_CODE',
    qty:2,tradeType:'buy',name:'PRIVATE_ETF',acct:'PRIVATE_ACCT',price:100}]};
  const coverage=(date,total,confirmed)=>({status:'ok',coverage:{
    requestedDate:date,mode:'READ_ONLY',expectedHeldCodes:total,
    officialExactDateCodes:confirmed,missingCodes:total-confirmed,staleCodes:0,
    duplicateMasterCodes:0,orphanLedgerCodes:0}});
  const safe=summarizeCoverage(diag,ledger,[coverage(TRADE_DATES[0],10,8),
    coverage(TRADE_DATES[1],10,10)]);
  assert.equal(safe.mode,'READ_ONLY');
  assert.equal(safe.observations[1].overallOfficialCoverage,'FULL_AGGREGATE_COVERAGE');
  assert.equal(safe.observations[1].targetCodeExactPriceIndividuallyProven,false);
  assert.ok(!JSON.stringify(safe).includes('PRIVATE_CODE'));
  assert.ok(!JSON.stringify(safe).includes('PRIVATE_ACCT'));
  assert.ok(!JSON.stringify(safe).includes('PRIVATE_ETF'));
  assert.throws(()=>summarizeCoverage(diag,ledger,[coverage(TRADE_DATES[0],2,3),
    coverage(TRADE_DATES[1],10,10)]),/ISSUE507_KRX_INCONSISTENT_COUNTS/);
  const calls=[];
  const mock=async(_url,opts)=>{
    const action=opts.body.get('action'),date=opts.body.get('date');
    calls.push(action);
    return {ok:true,json:async()=>opts.body.get('accessToken')==='TEST_TOKEN'
      ? action==='getTrades'?ledger
        : action==='diagnoseSnapshotIntegrityRange'?diag
        : coverage(date,10,9)
      : {status:'error',message:'인증 실패'}};
  };
  const test=await readLive({url:'https://script.google.com/macros/s/TEST/exec',
    token:'TEST_TOKEN',fetchImpl:mock});
  assert.deepEqual(calls,['getKrxHeldCloseCoverage',
    'diagnoseSnapshotIntegrityRange','getTrades',
    'getKrxHeldCloseCoverage','getKrxHeldCloseCoverage']);
  assert.equal(test.observations.length,2);
  assert.ok(!JSON.stringify(test).includes('TEST_TOKEN'));
  console.log('Issue #507 official KRX yearend coverage read-only: PASS');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    if(process.argv.includes('--self-test'))await selfTest();
    else console.log(JSON.stringify(await readLive({
      url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN})));
  }catch(e){
    if(process.argv.includes('--self-test'))console.error(String(e?.stack||e).slice(0,1800));
    else {
      const raw=String(e?.message||'');
      console.error(/^ISSUE507_KRX_[A-Z_]+$/.test(raw)?raw:'ISSUE507_KRX_UNKNOWN');
    }
    process.exitCode=1;
  }
}
