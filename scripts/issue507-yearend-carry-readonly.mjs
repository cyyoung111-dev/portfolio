#!/usr/bin/env node
// #507: explain year-boundary carry without mutating prices, holdings or Snapshot.
// All live output is fixed dates + non-sensitive aggregates; NEVER print raw GAS
// source errors, trade rows, product codes, amounts, identifiers, tokens or URLs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

export const DATES=Object.freeze(['2025-12-30','2025-12-31','2026-01-01','2026-01-02']);
const STATES=new Set(['VALID','PARTIAL','MISMATCH','CONFLICT',
  'SOURCE_INCOMPLETE','NO_SNAPSHOT','PRICE_SUSPICIOUS']);
const ASOF=/^\d{4}-\d{2}-\d{2}$/;
const count=(n)=>{if(!Number.isSafeInteger(n)||n<0||n>1000000)
  throw Error('YEARBOUNDARY_BAD_COUNT');return n;};
// Convert potentially identifying GAS exception text to an allowlisted class.
// Only the *shape* of the first missing source code is disclosed. The raw
// identifier, name, provider and prices NEVER leave the Actions runner.
export function classifyMissingAssetClasses(errors) {
  if(!Array.isArray(errors))throw Error('YEARBOUNDARY_BAD_SOURCE_ERRORS');
  const found=new Set();
  for(const raw of errors){
    if(typeof raw!=='string')throw Error('YEARBOUNDARY_BAD_SOURCE_ERROR');
    const match=raw.match(/확정 원자료 부족으로 기존 Snapshot 보존:\s*([A-Za-z0-9._-]+)/);
    if(!match) {found.add('UNCLASSIFIED');continue;}
    const code=match[1].toUpperCase();
    if(/^F[0-9]{5}$/.test(code))found.add('FUND_CODE');
    else if(/^[0-9][0-9A-Z]{5}$/.test(code))found.add('KOREAN_FORMAT_CODE');
    else if(/^[A-Z]{1,5}(?:[.-][A-Z]{1,2})?$/.test(code))found.add('LETTER_TICKER_CODE');
    else found.add('UNCLASSIFIED');
  }
  return [...found].sort();
}
export function classifySourceGaps(errors) {
  if(!Array.isArray(errors))throw Error('YEARBOUNDARY_BAD_SOURCE_ERRORS');
  const classes=new Set();
  for(const raw of errors){
    if(typeof raw!=='string')throw Error('YEARBOUNDARY_BAD_SOURCE_ERROR');
    if(/:FX_[A-Z]{3}\b|환율/.test(raw))classes.add('FX');
    else if(/NAV 충돌|펀드.*충돌/.test(raw))classes.add('FUND_NAV_CONFLICT');
    else if(/확정 원자료 부족|확정 평가자료 부족|PRICE|가격/.test(raw))
      classes.add('PRICE_OR_FUND_NAV');
    else classes.add('OTHER');
  }
  return [...classes].sort();
}
export function summarizeLive(response) {
  if(response?.status!=='ok'||!Array.isArray(response.checkedDates)
    ||!Array.isArray(response.diagnostics)||response.checkedDates.length!==DATES.length
    ||response.diagnostics.length!==DATES.length
    ||new Set(response.checkedDates).size!==DATES.length
    ||DATES.some(d=>!response.checkedDates.includes(d)))
    throw Error('YEARBOUNDARY_RESPONSE_INVALID');
  const out=[];
  for(const d of DATES){
    const x=response.diagnostics.find(z=>z?.date===d);
    if(!x||!STATES.has(x.status)||!ASOF.test(x.date)
      ||!Array.isArray(x.expectedRows)||!Array.isArray(x.sourceDataErrors)
      ||!Array.isArray(x.foreignFxStates)||!Array.isArray(x.fundNavStates)
      ||!Array.isArray(x.itemComparisons))
      throw Error('YEARBOUNDARY_DIAGNOSTIC_SCHEMA');
    const expectedRows=count(x.expectedRowCount),storedRows=count(x.storedRowCount);
    if(expectedRows!==x.expectedRows.length)throw Error('YEARBOUNDARY_EXPECTED_COUNT');
    let priceCarry=0,fundCarry=0,otherCarry=0,unverifiedFuture=0;
    for(const row of x.expectedRows){
      if(!Array.isArray(row)||row[0]!==d||typeof row[10]!=='string')
        throw Error('YEARBOUNDARY_ROW_SCHEMA');
      const source=row[10];
      if(source.startsWith('FUND_NAV_CARRY@'))fundCarry++;
      else if(source.includes('_CARRY@'))priceCarry++;
      else if(source.includes('CARRY'))otherCarry++;
      const marker=source.match(/_CARRY@(\d{4}-\d{2}-\d{2})/);
      if(marker && marker[1]>d)unverifiedFuture++;
    }
    const fxCarry=x.foreignFxStates.filter(q=>q?.sourceDate && q.sourceDate<d).length;
    const fxFuture=x.foreignFxStates.filter(q=>q?.sourceDate && q.sourceDate>d).length;
    const fundFuture=x.fundNavStates.filter(q=>q?.sourceDate && q.sourceDate>d).length;
    if(unverifiedFuture+fxFuture+fundFuture>0)throw Error('YEARBOUNDARY_FUTURE_VALUE');
    out.push({date:d,status:x.status,expectedRows,storedRows,
      sourceErrorCount:count(x.sourceDataErrors.length),
      sourceErrorTypes:classifySourceGaps(x.sourceDataErrors),
      missingAssetClasses:classifyMissingAssetClasses(x.sourceDataErrors),
      priceCarryCount:priceCarry,fundNavCarryCount:fundCarry,
      otherCarryCount:otherCarry,fxCarryCount:fxCarry,
      fundNavObservedCount:count(x.fundNavStates.length),
      fxObservedCount:count(x.foreignFxStates.length),
      yearBoundaryValidated:expectedRows>0 && x.status==='VALID'});
  }
  return {mode:'READ_ONLY',asOfDates:DATES,diagnostics:out,
    newYear:out.find(x=>x.date==='2026-01-01'),
    allValid:out.every(x=>x.status==='VALID'),
    sourceGapsPreserved:out.some(x=>x.status==='SOURCE_INCOMPLETE'),
    historicalDataRewritten:false};
}
export async function readLive({url,token,fetchImpl=fetch}) {
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())throw Error('YEARBOUNDARY_TOKEN_MISSING');
  const invalid=token==='YEARBOUNDARY_BAD_AUTH'?'YEARBOUNDARY_BAD_AUTH_ALT':'YEARBOUNDARY_BAD_AUTH';
  async function fetchRange(accessToken){
    let res;
    try{res=await fetchImpl(endpoint,{method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({action:'diagnoseSnapshotIntegrityRange',
        dates:DATES.join(','),accessToken}),
      redirect:'follow',signal:AbortSignal.timeout(240000)});}
    catch{throw Error('YEARBOUNDARY_NETWORK_ERROR');}
    if(!res?.ok)throw Error('YEARBOUNDARY_HTTP_ERROR');
    try{return await res.json();}
    catch{throw Error('YEARBOUNDARY_JSON_ERROR');}
  }
  const denied=await fetchRange(invalid);
  if(denied?.status!=='error'||denied?.message!=='인증 실패')
    throw Error('YEARBOUNDARY_AUTH_DISABLED');
  return summarizeLive(await fetchRange(token));
}
function productionFixture() {
  const gas=fs.readFileSync('src/gas/apps_script.gs','utf8');
  const names=['_applyHoldingTrade','_snapshotHoldingState','_buildHoldingsByRequestedDate',
    '_fundUnitsAtDate','_applyFundUnitLifecycleToSnapshotHoldings','_indexedLatest',
    '_indexedFundEvaluation','_buildIndexedSnapshotRows','_dedupeSnapshotRows'];
  const source=names.map(name=>{
    const m=gas.match(new RegExp('function '+name+'\\([\\s\\S]*?\\n}','m'));
    assert.ok(m,'real GAS function not found: '+name);
    return m[0];
  }).join('\n');
  const ctx=vm.createContext({
    CONFIG:{TIMEZONE:'Asia/Seoul'},
    _cleanCode:x=>String(x||'').trim().toUpperCase(),
    _normalizeDate:x=>String(x||'').slice(0,10),
    _isFundCode:x=>/^F\d{5}$/.test(x),
    Utilities:{formatDate:(v)=>v.toISOString().slice(0,10)}
  });
  vm.runInContext(source,ctx);
  return ctx;
}
export function testProductionCarry() {
  const ctx=productionFixture();
  const trades=[
    ['2025-12-29','buy','TEST','국내','000001',5,100,'주식'],
    ['2025-12-29','buy','TEST','해외','AAPL',2,20,'주식'],
    ['2025-12-29','buy','TEST','펀드','F00001',1,1000,'펀드'],
    ['2026-01-01','buy','TEST','국내','000001',1,120,'주식'],
    ['2026-01-02','sell','TEST','국내','000001',1,130,'주식']
  ];
  const buildContext=(ledger)=>{
    const holdings=ctx._buildHoldingsByRequestedDate(ledger,DATES,{});
    const series={
      '000001':[{date:'2025-12-30',price:110,source:'KRX'},
        {date:'2026-01-02',price:130,source:'KRX'}],
      AAPL:[{date:'2025-12-30',price:25,source:'YAHOO'},
        {date:'2026-01-02',price:30,source:'YAHOO'}]
    };
    const exact={};
    Object.entries(series).forEach(([code,items])=>
      items.forEach(v=>{exact[v.date+'|'+code]=v;}));
    return {holdingsByRequestedDate:holdings,
      positivePriceSeriesByCode:series,priceExactByDateCode:exact,
      manualPriceSeriesByCode:{},
      fundConfigs:[{code:'F00001',units:1000,startDate:'2025-01-01',provider:'X'}],
      fundNavSeriesByCode:{F00001:[
        {date:'2025-12-31',sourceDate:'2025-12-31',valueDate:'2025-12-31',nav:1050,provider:'X'},
        {date:'2026-01-02',sourceDate:'2026-01-02',valueDate:'2026-01-02',nav:1100,provider:'X'}]},
      fundNavConflictsByCode:{},currencyByCode:{AAPL:'USD'},
      fxSeriesByCurrency:{USD:[{date:'2025-12-30',rate:1400},
        {date:'2026-01-02',rate:1420}]},metrics:{fxLookupCount:0,fundNavLookupCount:0}};
  };
  let context=buildContext(trades);
  const d31=ctx._buildIndexedSnapshotRows(context,'2025-12-31');
  const d01=ctx._buildIndexedSnapshotRows(context,'2026-01-01');
  const d02=ctx._buildIndexedSnapshotRows(context,'2026-01-02');
  const get=(rows,code)=>rows.find(r=>r[1]===code);
  assert.equal(get(d31,'000001')[3],5);
  assert.equal(get(d01,'000001')[3],6,'new-year trade changes holdings');
  assert.equal(get(d01,'000001')[5],620,'cost is ledger-derived, not previous Snapshot');
  assert.equal(get(d01,'000001')[7],660,'last confirmed 2025 close is carried');
  assert.equal(get(d01,'000001')[10],'KRX_CARRY@2025-12-30');
  assert.equal(get(d02,'000001')[10],'KRX','2026-01-02 actual close supersedes carry');
  assert.equal(get(d01,'AAPL')[7],70000,'2025 FX and USD close are both carried');
  assert.equal(get(d01,'AAPL')[10],'YAHOO_CARRY@2025-12-30');
  assert.equal(get(d01,'F00001')[7],1050,'year-end NAV carried, not future NAV');
  assert.equal(get(d01,'F00001')[10],'FUND_NAV_CARRY@2025-12-31');
  assert.equal(get(d02,'F00001')[10],'FUND_NAV');
  // Recompute from CHANGED trade ledger: only Jan 1 and after are affected.
  const modified=trades.map(x=>x.slice());modified[3][5]=2;
  context=buildContext(modified);
  const revised31=ctx._buildIndexedSnapshotRows(context,'2025-12-31');
  const revised01=ctx._buildIndexedSnapshotRows(context,'2026-01-01');
  assert.equal(get(revised31,'000001')[3],5);
  assert.equal(get(revised01,'000001')[3],7);
  assert.equal(get(revised01,'000001')[5],740);
  assert.equal(get(revised01,'000001')[10],'KRX_CARRY@2025-12-30');
  // A 2026-01-02 quotation must NOT leak backwards to Jan 1.
  context=buildContext(trades);
  context.positivePriceSeriesByCode['000001']=
    [{date:'2026-01-02',price:130,source:'KRX'}];
  delete context.priceExactByDateCode['2025-12-30|000001'];
  assert.throws(()=>ctx._buildIndexedSnapshotRows(context,'2026-01-01'),
    /확정 원자료 부족/);
  // No historical fund NAV should never be replaced with future NAV.
  context=buildContext(trades);
  context.fundNavSeriesByCode.F00001=context.fundNavSeriesByCode.F00001.slice(1);
  assert.throws(()=>ctx._buildIndexedSnapshotRows(context,'2026-01-01'),
    /확정 원자료 부족/);
  return true;
}
export async function selfTest(){
  assert.equal(testProductionCarry(),true);
  const mock=d=>({date:d,status:'SOURCE_INCOMPLETE',expectedRowCount:0,
    storedRowCount:2,expectedRows:[],sourceDataErrors:['PRIVATE CODE'],
    foreignFxStates:[],fundNavStates:[],itemComparisons:[]});
  const report=summarizeLive({status:'ok',checkedDates:[...DATES],
    diagnostics:DATES.map(mock)});
  assert.equal(report.newYear.status,'SOURCE_INCOMPLETE');
  assert.equal(report.sourceGapsPreserved,true);
  assert.deepEqual(classifySourceGaps(['확정 원자료 부족: CODE_SECRET:FX_USD']),['FX']);
  assert.deepEqual(classifySourceGaps(['펀드 확정 NAV 충돌: FUND_SECRET']),['FUND_NAV_CONFLICT']);
  assert.deepEqual(classifySourceGaps(['확정 원자료 부족: STOCK_SECRET']),['PRICE_OR_FUND_NAV']);
  assert.deepEqual(classifySourceGaps(['ACCOUNT_PRIVATE_TOKEN']),['OTHER']);
  assert.deepEqual(classifySourceGaps([]),[]);
  assert.ok(!JSON.stringify(classifySourceGaps(['계좌번호 12345:FX_USD'])).includes('12345'));
  assert.deepEqual(report.newYear.sourceErrorTypes,['OTHER']);
  assert.deepEqual(classifyMissingAssetClasses([
    '확정 원자료 부족으로 기존 Snapshot 보존: F00001']),['FUND_CODE']);
  assert.deepEqual(classifyMissingAssetClasses([
    '확정 원자료 부족으로 기존 Snapshot 보존: 0046Y0']),['KOREAN_FORMAT_CODE']);
  assert.deepEqual(classifyMissingAssetClasses([
    '확정 원자료 부족으로 기존 Snapshot 보존: AAPL']),['LETTER_TICKER_CODE']);
  assert.deepEqual(classifyMissingAssetClasses([
    '확정 원자료 부족으로 기존 Snapshot 보존: BRK-B']),['LETTER_TICKER_CODE']);
  assert.deepEqual(classifyMissingAssetClasses(['OTHER NONPUBLIC ERROR']),['UNCLASSIFIED']);
  assert.deepEqual(classifyMissingAssetClasses([
    '확정 원자료 부족으로 기존 Snapshot 보존: SECRET_LONG_ACCOUNT']),['UNCLASSIFIED']);
  assert.ok(!JSON.stringify(classifyMissingAssetClasses([
    '확정 원자료 부족으로 기존 Snapshot 보존: SECRET_ACCOUNT'])).includes('SECRET_ACCOUNT'));
  assert.ok(!JSON.stringify(report).includes('PRIVATE CODE'));
  await assert.rejects(()=>readLive({
    url:'https://script.google.com/macros/s/example/exec',token:'REAL_SECRET',
    fetchImpl:async(_u,o)=>({ok:true,json:async()=>o.body.get('accessToken')==='REAL_SECRET'
      ? {status:'ok',checkedDates:[...DATES],diagnostics:DATES.map(mock)}
      : {status:'error',message:'인증 실패'}})
  }).then(z=>{assert.equal(z.newYear.storedRows,2);throw Error('PASS')}),/PASS/);
  assert.throws(()=>summarizeLive({status:'ok',checkedDates:[...DATES],
    diagnostics:DATES.map((d,i)=>({...mock(d),expectedRowCount:i===2?1:0}))}),
    /YEARBOUNDARY_EXPECTED_COUNT/);
  console.log('Issue #507 2025/2026 year-boundary carry production GAS VM: PASS');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    if(process.argv.includes('--self-test'))await selfTest();
    else console.log(JSON.stringify(await readLive({
      url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN})));
  }catch(e){
    const code=String(e?.message||'');
    // Only the synthetic self-test is permitted to show assertion diagnostics.
    // Live probe errors remain fixed non-sensitive codes.
    if(process.argv.includes('--self-test'))console.error(String(e?.stack||e).slice(0,1400));
    else console.error(/^YEARBOUNDARY_[A-Z_]+$/.test(code)?code:'YEARBOUNDARY_UNKNOWN_ERROR');
    process.exitCode=1;
  }
}
