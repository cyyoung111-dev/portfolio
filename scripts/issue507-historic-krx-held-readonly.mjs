#!/usr/bin/env node
// Issue #507: check official KRX coverage of the historical ledger-held universe.
// Does NOT certify an individual missing code or mutate historic Sheets.
import assert from 'node:assert/strict';
import {runCoverage} from './diagnose-krx-held-coverage.mjs';

export const TARGET_DATES=Object.freeze(['2025-09-03','2025-12-30','2026-01-02']);
const safeCount=n=>{
  if(!Number.isSafeInteger(n)||n<0||n>1000000)
    throw new Error('ISSUE507_HIST_KRX_BAD_COUNT');
  return n;
};
export function summarizeHistoricalCoverage(payload){
  if(payload?.mode!=='READ_ONLY'||payload.coverageContract!=='KRX_HELD_V1'||
    !Array.isArray(payload.results)||payload.results.length!==TARGET_DATES.length ||
    payload.results.some((x,i)=>x.date!==TARGET_DATES[i]))
    throw new Error('ISSUE507_HIST_KRX_BAD_REPORT');
  const results=payload.results.map(r=>{
    if(r.errorCode){
      if(r.errorCode!=='KRX_HELD_DIAG_DATE_FAILED')
        throw new Error('ISSUE507_HIST_KRX_BAD_ERROR');
      return {date:r.date,state:'OFFICIAL_COVERAGE_UNAVAILABLE',
        exactDateConfirmed:false};
    }
    if(!r.market||typeof r.ready!=='boolean')throw new Error('ISSUE507_HIST_KRX_BAD_SHAPE');
    const expected=safeCount(r.expected),exact=safeCount(r.exact),
      missing=safeCount(r.missing),stale=safeCount(r.stale),
      orphan=safeCount(r.orphanLedger),duplicate=safeCount(r.duplicateMaster);
    if(exact>expected||missing!==expected-exact||stale>missing)
      throw new Error('ISSUE507_HIST_KRX_BAD_TOTAL');
    for(const key of ['STOCK','ETF']){
      const g=r.market[key];
      if(!g||safeCount(g.expected)<safeCount(g.confirmed))
        throw new Error('ISSUE507_HIST_KRX_BAD_MARKET');
    }
    const state=orphan?'LEDGER_CODE_NOT_IN_MASTER'
      :duplicate?'DUPLICATE_MASTER'
      :!expected?'NO_KRX_ELIGIBLE_HOLDINGS'
      :r.ready?'ALL_HELD_KRX_CODES_EXACT_CLOSE'
      :stale?'HISTORIC_KRX_STALE_OR_INCOMPLETE'
      :'HISTORIC_KRX_INCOMPLETE';
    return {date:r.date,state,expectedHeldKrxCodes:expected,
      exactDateConfirmedCodes:exact,missingCodes:missing,staleCodes:stale,
      orphanLedgerCodes:orphan,duplicateMasterCodes:duplicate,
      stockCoverage:{expected:safeCount(r.market.STOCK.expected),
        confirmed:safeCount(r.market.STOCK.confirmed)},
      etfCoverage:{expected:safeCount(r.market.ETF.expected),
        confirmed:safeCount(r.market.ETF.confirmed)},
      exactDateConfirmed:r.ready};
  });
  return {mode:'READ_ONLY',asOfDates:TARGET_DATES,results,
    allHistoricHeldKrxCodesConfirmed:results.every(x=>x.exactDateConfirmed),
    firstMissingCodeDirectlyVerified:false,
    historicalPriceHistoryModified:false,snapshotModified:false,
    limitation:'Aggregate ledger-held KRX market coverage is not a direct proof for the single missing code'};
}
export async function runHistoricCoverage({url,token,fetchImpl=fetch}){
  return summarizeHistoricalCoverage(await runCoverage({
    url,token,dates:TARGET_DATES.join(','),fetchImpl
  }));
}
export async function selfTest(){
  const one=(date,config={})=>({
    date,expected:3,exact:3,missing:0,stale:0,
    duplicateMaster:0,orphanLedger:0,
    market:{STOCK:{expected:2,confirmed:2},ETF:{expected:1,confirmed:1}},
    ready:true,...config
  });
  const report={mode:'READ_ONLY',coverageContract:'KRX_HELD_V1',
    results:TARGET_DATES.map(d=>one(d))};
  const ok=summarizeHistoricalCoverage(report);
  assert.equal(ok.allHistoricHeldKrxCodesConfirmed,true);
  assert.equal(ok.firstMissingCodeDirectlyVerified,false);
  assert.deepEqual(ok.results.map(r=>r.state),TARGET_DATES.map(()=>'ALL_HELD_KRX_CODES_EXACT_CLOSE'));
  const partial=summarizeHistoricalCoverage({...report,
    results:[one(TARGET_DATES[0],{expected:3,exact:2,missing:1,stale:1,
      ready:false,market:{STOCK:{expected:2,confirmed:1},ETF:{expected:1,confirmed:1}}}),
      one(TARGET_DATES[1]),one(TARGET_DATES[2])]});
  assert.equal(partial.results[0].state,'HISTORIC_KRX_STALE_OR_INCOMPLETE');
  assert.equal(partial.allHistoricHeldKrxCodesConfirmed,false);
  const orphan=summarizeHistoricalCoverage({...report,results:[
    one(TARGET_DATES[0],{orphanLedger:1,ready:false}),
    one(TARGET_DATES[1]),one(TARGET_DATES[2])]});
  assert.equal(orphan.results[0].state,'LEDGER_CODE_NOT_IN_MASTER');
  const errors=summarizeHistoricalCoverage({...report,results:[
    {date:TARGET_DATES[0],errorCode:'KRX_HELD_DIAG_DATE_FAILED'},
    one(TARGET_DATES[1]),one(TARGET_DATES[2])]});
  assert.equal(errors.results[0].state,'OFFICIAL_COVERAGE_UNAVAILABLE');
  const secret={...report,token:'private-access-token',raw:{code:'0046Y0',price:987654}};
  const sanitized=summarizeHistoricalCoverage(secret);
  assert.ok(!JSON.stringify(sanitized).includes('0046Y0'));
  assert.ok(!JSON.stringify(sanitized).includes('987654'));
  assert.ok(!JSON.stringify(sanitized).includes('private-access-token'));
  assert.throws(()=>summarizeHistoricalCoverage({...report,results:[
    {...report.results[0],date:'2025-09-04'},...report.results.slice(1)
  ]}),/ISSUE507_HIST_KRX_BAD_REPORT/);
  const seen=[];
  const fetchImpl=async(_url,request)=>{
    const p=request.body;seen.push({action:p.get('action'),date:p.get('date')});
    const data=p.get('accessToken')!=='SYNTHETIC_TOKEN'
      ? {status:'error',message:'인증 실패'} :
      {status:'ok',coverage:{
        requestedDate:p.get('date'),mode:'READ_ONLY',
        expectedHeldCodes:3,officialExactDateCodes:3,missingCodes:0,
        staleCodes:0,duplicateMasterCodes:0,orphanLedgerCodes:0,
        market:{STOCK:{expected:2,confirmed:2},ETF:{expected:1,confirmed:1}},
        ready:true,internalSecret:'must-not-print'
      }};
    return {ok:true,json:async()=>data};
  };
  const live=await runHistoricCoverage({
    url:'https://script.google.com/macros/s/example/exec',
    token:'SYNTHETIC_TOKEN',fetchImpl});
  assert.equal(live.results.length,3);
  assert.equal(seen.length,4);
  assert.ok(seen.every(x=>x.action==='getKrxHeldCloseCoverage'));
  assert.ok(!JSON.stringify(live).includes('must-not-print'));
  console.log('Issue #507 historical KRX read-only coverage self-test PASS');
}
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    if(process.argv.includes('--self-test'))await selfTest();
    else console.log(JSON.stringify(await runHistoricCoverage({
      url:process.env.GAS_WEB_APP_URL,
      token:process.env.GAS_ACCESS_TOKEN
    })));
  }catch(err){
    if(process.argv.includes('--self-test'))console.error(String(err?.stack||err).slice(0,1700));
    else{
      const x=String(err?.message||'');
      console.error(/^ISSUE507_HIST_KRX_[A-Z_]+$/.test(x)?x:'ISSUE507_HIST_KRX_READ_ERROR');
    }
    process.exitCode=1;
  }
}
