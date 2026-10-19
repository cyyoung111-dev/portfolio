#!/usr/bin/env node
// Issue 507: non-mutating provenance probe for current/legacy code lineages.
// All GAS data and identifier joins stay inside the ephemeral Actions runner.
import assert from 'node:assert/strict';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {DATES} from './issue507-yearend-carry-readonly.mjs';
import {firstMissingCodes} from './issue507-missing-price-provenance-readonly.mjs';
const CODE=/^[A-Z0-9][A-Z0-9.-]{0,29}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const UNVERIFIED=/REALTIME|INDICATIVE|DAILY_CANDLE|UNVERIFIED_CLOSE|GOOGLEFINANCE|^TOSS$|^KRX_CARRY$|^KRX_OTP_CARRY$/i;
const normCode=raw=>{
  const s=String(raw||'').trim().toUpperCase();
  if(/^\d+$/.test(s))return s.padStart(6,'0');
  return CODE.test(s)?s:'';
};
const bounded=n=>{
  if(!Number.isSafeInteger(n)||n<0||n>1000000)throw Error('YEARBOUNDARY_LINEAGE_BAD_COUNT');
  return n;
};
export function findLedgerLineage(diag,tradesResponse){
  const missing=firstMissingCodes(diag);
  if(tradesResponse?.status!=='ok'||!Array.isArray(tradesResponse.trades) ||
    tradesResponse.trades.length>100000)
    throw Error('YEARBOUNDARY_LINEAGE_TRADE_SCHEMA');
  const rows=tradesResponse.trades.map(t=>{
    if(!t||typeof t.code!=='string'||typeof t.name!=='string'||
      typeof t.date!=='string'||typeof t.tradeType!=='string')
      throw Error('YEARBOUNDARY_LINEAGE_TRADE_SCHEMA');
    return {code:normCode(t.code),name:t.name.trim().replace(/\s+/g,' ').toUpperCase(),
      date:t.date.slice(0,10),type:t.tradeType};
  }).filter(t=>DATE.test(t.date));
  const codes=[...new Set(missing.map(m=>m.code).filter(Boolean))];
  const lineage={};
  for(const code of codes){
    const exact=rows.filter(t=>t.code===code);
    const names=new Set(exact.map(t=>t.name).filter(Boolean));
    const alias=rows.filter(t=>t.code && t.code!==code && names.has(t.name));
    const candidateCodes=[...new Set(alias.map(t=>t.code))].sort();
    // Human-readable name equality is only a candidate, never a confirmed
    // code replacement. Fail closed before requesting excessive candidates.
    if(candidateCodes.length>15)throw Error('YEARBOUNDARY_LINEAGE_TOO_MANY_CANDIDATES');
    lineage[code]={firstTradeDate:exact.map(t=>t.date).sort()[0]||'-',
      firstTradeBefore2026:exact.some(t=>t.date<'2026-01-01'),
      firstTradeBeforeFirstCurrentPrice:exact.some(t=>t.date<'2026-01-06'),
      currentCodeTradeCount:bounded(exact.length),
      sameNameDifferentCodeTradeCount:bounded(alias.length),
      candidateCodes};
  }
  return {missing,codes,lineage};
}
export function summarizeLedgerLineage(probe,priceResponse){
  if(priceResponse?.status!=='ok'||!priceResponse.prices||
    typeof priceResponse.prices!=='object'||Array.isArray(priceResponse.prices))
    throw Error('YEARBOUNDARY_LINEAGE_PRICE_SCHEMA');
  const allowed=new Set(probe.codes.concat(...probe.codes.map(x=>probe.lineage[x].candidateCodes)));
  for(const [code,series] of Object.entries(priceResponse.prices)){
    if(!allowed.has(code)||!Array.isArray(series)||series.length>20000)
      throw Error('YEARBOUNDARY_LINEAGE_UNSCOPED_PRICE');
    for(const item of series)
      if(!item||!DATE.test(item.date)||!(Number(item.price)>0)||typeof item.source!=='string')
        throw Error('YEARBOUNDARY_LINEAGE_PRICE_ROW');
  }
  const results=probe.missing.map(m=>{
    if(!m.code)return {date:m.date,state:'MISSING_CODE_UNAVAILABLE'};
    const x=probe.lineage[m.code];
    const candidates=x.candidateCodes;
    const historical=candidates.flatMap(code=>
      (priceResponse.prices[code]||[]).filter(r=>r.date<=m.date));
    const eligible=historical.filter(r=>r.source&&!UNVERIFIED.test(r.source));
    const lastEligible=eligible.map(r=>r.date).sort().at(-1)||'-';
    return {date:m.date,state:candidates.length
      ? (eligible.length?'NAME_MATCHED_LEGACY_PRICE_CANDIDATE':'NAME_MATCHED_OLD_CODE_NO_PRIOR_PRICE')
      : 'NO_NAME_MATCHED_PREDECESSOR_IN_LEDGER',
      currentCodeFirstTradeDate:x.firstTradeDate,
      currentCodeTradeCount:x.currentCodeTradeCount,
      currentCodeTradeBefore2026:x.firstTradeBefore2026,
      currentCodeTradeBeforeFirstPrice:x.firstTradeBeforeFirstCurrentPrice,
      nameMatchedOtherCodeCount:bounded(candidates.length),
      nameMatchedOtherCodeTradeCount:x.sameNameDifferentCodeTradeCount,
      eligiblePastPriceRowsForCandidates:bounded(eligible.length),
      lastCandidateEligibleSourceDate:lastEligible,
      replacementProven:false};
  });
  return {mode:'READ_ONLY',results,
    checkedDistinctCurrentCodes:bounded(probe.codes.length),
    sourceOfTruth:'TRADE_LEDGER',
    note:'Identical display names are NOT proof of an old-to-new code replacement',
    wroteTradeLedger:false,wroteSnapshot:false,wrotePriceHistory:false};
}
export async function readLive({url,token,fetchImpl=fetch}){
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())throw Error('YEARBOUNDARY_LINEAGE_TOKEN');
  async function get(action,opts={},credential=token){
    let response;
    try{response=await fetchImpl(endpoint,{method:'POST',redirect:'follow',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({action,...opts,accessToken:credential}),
      signal:AbortSignal.timeout(240000)});}
    catch{throw Error('YEARBOUNDARY_LINEAGE_NETWORK');}
    if(!response?.ok)throw Error('YEARBOUNDARY_LINEAGE_HTTP');
    try{return await response.json();}
    catch{throw Error('YEARBOUNDARY_LINEAGE_JSON');}
  }
  const wrong=token==='YEARBOUNDARY_LINEAGE_BAD_AUTH'?'YEARBOUNDARY_LINEAGE_BAD_AUTH_ALT':'YEARBOUNDARY_LINEAGE_BAD_AUTH';
  const denied=await get('getTrades',{},wrong);
  if(denied?.status!=='error'||denied.message!=='인증 실패')
    throw Error('YEARBOUNDARY_LINEAGE_AUTH_GUARD');
  const diag=await get('diagnoseSnapshotIntegrityRange',{dates:DATES.join(',')});
  const trade=await get('getTrades');
  const probe=findLedgerLineage(diag,trade);
  const requested=[...new Set(probe.codes.concat(...probe.codes.map(c=>probe.lineage[c].candidateCodes)))];
  const price=requested.length
    ? await get('getPriceHistory',{codes:requested.join(',')})
    : {status:'ok',dates:[],prices:{}};
  return summarizeLedgerLineage(probe,price);
}
export async function selfTest(){
  const diag={status:'ok',checkedDates:[...DATES],diagnostics:DATES.map(date=>({
    date,status:'SOURCE_INCOMPLETE',
    sourceDataErrors:['확정 원자료 부족으로 기존 Snapshot 보존: 0046Y0']
  }))};
  const trade={status:'ok',trades:[
    {date:'2025-02-12',code:'000460',name:'TEST ETF',tradeType:'buy'},
    {date:'2025-12-20',code:'0046Y0',name:'TEST ETF',tradeType:'buy'},
    {date:'2026-02-01',code:'0046Y0',name:'TEST ETF',tradeType:'sell'},
    {date:'2025-12-29',code:'123456',name:'UNRELATED',tradeType:'buy'}]};
  const probe=findLedgerLineage(diag,trade);
  assert.equal(probe.codes.length,1);
  assert.equal(probe.lineage['0046Y0'].firstTradeDate,'2025-12-20');
  assert.deepEqual(probe.lineage['0046Y0'].candidateCodes,['000460']);
  const prices={status:'ok',dates:['2025-12-30'],prices:{
    '000460':[{date:'2025-12-30',price:100,source:'KRX_CONFIRMED_CLOSE'}]}};
  const report=summarizeLedgerLineage(probe,prices);
  assert.equal(report.results[2].state,'NAME_MATCHED_LEGACY_PRICE_CANDIDATE');
  assert.equal(report.results[2].lastCandidateEligibleSourceDate,'2025-12-30');
  assert.equal(report.results[2].replacementProven,false);
  assert.equal(report.sourceOfTruth,'TRADE_LEDGER');
  assert.ok(!JSON.stringify(report).includes('000460'));
  assert.ok(!JSON.stringify(report).includes('0046Y0'));
  assert.ok(!JSON.stringify(report).includes('TEST ETF'));
  const unrelated={...trade,trades:trade.trades.filter(t=>t.code!=='000460')};
  const noCandidate=findLedgerLineage(diag,unrelated);
  assert.equal(summarizeLedgerLineage(noCandidate,{status:'ok',prices:{}}).results[2].state,
    'NO_NAME_MATCHED_PREDECESSOR_IN_LEDGER');
  assert.throws(()=>summarizeLedgerLineage(probe,{status:'ok',prices:{
    'SECRET_CODE':[{date:'2025-12-30',price:100,source:'KRX'}]}}),
    /YEARBOUNDARY_LINEAGE_UNSCOPED_PRICE/);
  const calls=[];
  const mock=async(_url,req)=>{
    const action=req.body.get('action');
    calls.push(action);
    const token=req.body.get('accessToken');
    const data=token!=='SYNTHETIC_TOKEN'?{status:'error',message:'인증 실패'}:
      action==='getTrades'?trade:
      action==='getPriceHistory'?prices:diag;
    return {ok:true,json:async()=>data};
  };
  const live=await readLive({url:'https://script.google.com/macros/s/TEST/exec',
    token:'SYNTHETIC_TOKEN',fetchImpl:mock});
  assert.deepEqual(calls,['getTrades','diagnoseSnapshotIntegrityRange','getTrades','getPriceHistory']);
  assert.equal(live.results[2].state,'NAME_MATCHED_LEGACY_PRICE_CANDIDATE');
  assert.ok(!JSON.stringify(live).includes('SYNTHETIC_TOKEN'));
  console.log('Issue #507 ledger-controlled code lineage READ ONLY: PASS');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    if(process.argv.includes('--self-test'))await selfTest();
    else console.log(JSON.stringify(await readLive({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN})));
  }catch(e){
    if(process.argv.includes('--self-test'))console.error(String(e?.stack||e).slice(0,1800));
    else {
      const s=String(e?.message||'');
      console.error(/^YEARBOUNDARY_LINEAGE_[A-Z_]+$/.test(s)?s:'YEARBOUNDARY_LINEAGE_UNKNOWN');
    }
    process.exitCode=1;
  }
}
