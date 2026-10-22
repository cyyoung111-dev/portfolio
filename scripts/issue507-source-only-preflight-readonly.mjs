#!/usr/bin/env node
// Issue #507: non-mutating preflight for a future, separately authorized,
// verified KRX SOURCE-ONLY historical price import. NEVER append/overwrite.
// No price, trade, code, account, token or raw GAS error is printed.
import assert from 'node:assert/strict';
import { validateWebAppUrl } from './diagnose-krx-operational.mjs';
import { DATES } from './issue507-yearend-carry-readonly.mjs';
import { firstMissingCodes } from './issue507-missing-price-provenance-readonly.mjs';

export const SOURCE_DATES=Object.freeze(['2025-12-30','2026-01-02','2026-01-05']);
const TRUSTED=new Set(['KRX_OPENAPI','KRX_OTP']);
const MAX_HISTORY_ROWS=30000;
const ymd=/^\d{4}-\d{2}-\d{2}$/;
function count(x){
  if(!Number.isSafeInteger(x)||x<0||x>1000000)throw Error('ISSUE507_PREFLIGHT_BAD_COUNT');
  return x;
}
export function evaluate(input) {
  const {diagnosis,automation,priceHistory,trade,yearEndSnapshot,proofs}=input||{};
  const missing=firstMissingCodes(diagnosis);
  const codes=[...new Set(missing.map(x=>x.code).filter(Boolean))];
  if(codes.length!==1)throw Error('ISSUE507_PREFLIGHT_SCOPE');
  const code=codes[0];
  if(automation?.status!=='ok'||!['9.243','9.244'].includes(automation?.automation?.gasVersion))
    throw Error('ISSUE507_PREFLIGHT_GAS_VERSION');
  if(priceHistory?.status!=='ok'||!priceHistory.prices||typeof priceHistory.prices!=='object'
    ||Array.isArray(priceHistory.prices))
    throw Error('ISSUE507_PREFLIGHT_HISTORY_SCHEMA');
  const keys=Object.keys(priceHistory.prices);
  if(keys.some(k=>k!==code))throw Error('ISSUE507_PREFLIGHT_EXTRA_CODE');
  const rows=priceHistory.prices[code]||[];
  if(!Array.isArray(rows)||rows.length>MAX_HISTORY_ROWS)
    throw Error('ISSUE507_PREFLIGHT_HISTORY_SCOPE');
  for(const r of rows){
    if(!r||!ymd.test(r.date)||!Number.isFinite(Number(r.price))||
      !(Number(r.price)>0)||typeof r.source!=='string')
      throw Error('ISSUE507_PREFLIGHT_HISTORY_ROW');
  }
  if(trade?.status!=='ok'||!Array.isArray(trade.trades)||trade.trades.length>100000)
    throw Error('ISSUE507_PREFLIGHT_TRADE_SCHEMA');
  const relevant=trade.trades.filter(t=>t&&typeof t.code==='string'&&
    t.code.trim().toUpperCase()===code);
  if(!relevant.length)throw Error('ISSUE507_PREFLIGHT_NO_LEDGER');
  // Any split/reverse split across the 2025 year-end carry boundary
  // requires explicit corporate-action review; no unverified price carry.
  const actions=relevant.filter(t=>/^(split|reverse_split)$/i.test(String(t.tradeType||'')) &&
    String(t.date||'').slice(0,10)>'2025-12-30' &&
    String(t.date||'').slice(0,10)<='2026-01-01');
  if(yearEndSnapshot?.status!=='ok'||yearEndSnapshot.date!=='2026-01-01'||
      !Array.isArray(yearEndSnapshot.items))
    throw Error('ISSUE507_PREFLIGHT_SNAPSHOT_SCHEMA');
  const storedMatch=yearEndSnapshot.items.filter(x=>x&&
    String(x.code||'').trim().toUpperCase()===code);
  if(storedMatch.length>1)throw Error('ISSUE507_PREFLIGHT_DUPLICATE_STORED');
  if(!Array.isArray(proofs)||proofs.length!==SOURCE_DATES.length)
    throw Error('ISSUE507_PREFLIGHT_PROOF_SCOPE');
  const observations=SOURCE_DATES.map((date,index)=>{
    const p=proofs[index],e=p?.targetEvidence,c=p?.coverage;
    if(p?.status!=='ok'||c?.mode!=='READ_ONLY'||c.requestedDate!==date||
       !e||e.requested!==true||typeof e.eligibleHeldDomestic!=='boolean'||
       typeof e.exactDateConfirmed!=='boolean'||typeof e.usedDate!=='string'||
       !['KRX_OPENAPI','KRX_OTP','NOT_CONFIRMED'].includes(e.providerClass))
      throw Error('ISSUE507_PREFLIGHT_PROOF_SCHEMA');
    if(e.exactDateConfirmed&&(e.usedDate!==date||!e.eligibleHeldDomestic||
       !TRUSTED.has(e.providerClass)))throw Error('ISSUE507_PREFLIGHT_NOT_EXACT');
    const sameDate=rows.filter(r=>r.date===date);
    const hasManual=sameDate.some(r=>String(r.source||'').toUpperCase()==='MANUAL');
    const alreadyStored=sameDate.length>0;
    const reason=!e.exactDateConfirmed?'NOT_OFFICIALLY_CONFIRMED':
       alreadyStored?'EXISTING_HISTORY_PROTECTED':
       actions.length?'CORPORATE_ACTION_REVIEW_REQUIRED':'EXACT_SOURCE_AVAILABLE_FOR_SEPARATE_APPROVAL';
    return {date,confirmedExact:e.exactDateConfirmed,
      source:e.exactDateConfirmed?e.providerClass:'NOT_CONFIRMED',
      existingPositiveHistoryRows:count(sameDate.length),
      fullRawPriceHistoryDuplicateScanPerformed:false,
      existingManualProtected:hasManual,
      sourceOnlyEligibleForLaterApproval:reason==='EXACT_SOURCE_AVAILABLE_FOR_SEPARATE_APPROVAL',
      decision:reason};
  });
  const last=rows.map(r=>r.date).sort().at(0)||'-';
  const yearEnd=observations.find(x=>x.date==='2025-12-30');
  const heldBeforeYearEnd=relevant.some(t=>String(t.date||'').slice(0,10)<='2025-12-30');
  const ready=heldBeforeYearEnd&&!!(yearEnd?.sourceOnlyEligibleForLaterApproval)&&storedMatch.length===0;
  return {mode:'READ_ONLY',gasVersion:automation.automation.gasVersion,
    firstMissingDistinctCodes:codes.length,earliestCurrentCodePriceDate:last,
    codeHeldBeforeYearEnd:heldBeforeYearEnd,
    carryBoundaryCorporateActionFound:actions.length>0,
    targetAlreadyInJan01StoredSnapshot:storedMatch.length===1,
    observations,yearEndCarrySourceReady:ready,
    numericalPriceUsed:false,historyWritten:false,snapshotWritten:false,ledgerWritten:false,
    fullRawPriceHistoryDuplicateScanPerformed:false,
    originalSheetWriteApproved:false,
    next:'Source READINESS is not write permission. The production writer must scan ALL raw rows including zero/invalid prices under ScriptLock, preserve MANUAL, verify backup capacity and exact provider date; approve write separately.'};
}
// A non-atomic GAS read cannot be elevated to SOURCE-ONLY readiness if the
// underlying transaction ledger, price history or saved Snapshot changes while
// the 3 official-date KRX proofs are fetched. Compare complete response bodies
// only in memory; never include rows, codes, amounts, account details in logs.
export function assertSourceReadsUnchanged(before,after) {
  if(!Array.isArray(before)||!Array.isArray(after)||before.length!==3||after.length!==3)
    throw Error('ISSUE507_PREFLIGHT_SOURCE_SCOPE');
  if(before.some((x,i)=>!x||!after[i]||JSON.stringify(x)!==JSON.stringify(after[i])))
    throw Error('ISSUE507_PREFLIGHT_SOURCE_CHANGED');
  return true;
}
export async function readLive({url,token,fetchImpl=fetch}){
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())throw Error('ISSUE507_PREFLIGHT_AUTH_REQUIRED');
  async function get(action,args={},credential=token){
    let r;
    try{r=await fetchImpl(endpoint,{method:'POST',redirect:'follow',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({action,...args,accessToken:credential}),
      signal:AbortSignal.timeout(240000)});}
    catch{throw Error('ISSUE507_PREFLIGHT_NETWORK');}
    if(!r?.ok)throw Error('ISSUE507_PREFLIGHT_HTTP');
    try{return await r.json();}catch{throw Error('ISSUE507_PREFLIGHT_JSON');}
  }
  const bad=token==='ISSUE507_PREFLIGHT_BAD_AUTH'?'ISSUE507_PREFLIGHT_BAD_AUTH2':'ISSUE507_PREFLIGHT_BAD_AUTH';
  const rejected=await get('getKrxHeldCloseCoverage',{date:'2025-12-30'},bad);
  if(rejected?.status!=='error'||rejected.message!=='인증 실패')
    throw Error('ISSUE507_PREFLIGHT_AUTH_GUARD');
  const diagnosis=await get('diagnoseSnapshotIntegrityRange',{dates:DATES.join(',')});
  const codes=[...new Set(firstMissingCodes(diagnosis).map(x=>x.code).filter(Boolean))];
  if(codes.length!==1)throw Error('ISSUE507_PREFLIGHT_SCOPE');
  const [automation,priceHistory,trade,yearEndSnapshot]=await Promise.all([
    get('getAutomationStatus'),
    get('getPriceHistory',{codes:codes[0]}),
    get('getTrades'),
    get('getHistoryDetail',{date:'2026-01-01'})
  ]);
  const proofs=[];
  for(const date of SOURCE_DATES){
    proofs.push(await get('getKrxHeldCloseCoverage',{date,code:codes[0]}));
  }
  // A/B/A source sandwich: checks changes made during the expensive KRX
  // coverage calls. This does NOT replace an atomic ScriptLock/revision
  // check by the future, separately authorized GAS writer.
  const [latestPriceHistory,latestTrade,latestSnapshot]=await Promise.all([
    get('getPriceHistory',{codes:codes[0]}),
    get('getTrades'),
    get('getHistoryDetail',{date:'2026-01-01'})
  ]);
  assertSourceReadsUnchanged(
    [priceHistory,trade,yearEndSnapshot],
    [latestPriceHistory,latestTrade,latestSnapshot]);
  return {...evaluate({diagnosis,automation,priceHistory,trade,yearEndSnapshot,proofs}),
    sourceReadCoherenceChecked:true};
}
export async function selfTest(){
  const code='0046Y0';
  const diagnosis={status:'ok',checkedDates:[...DATES],
    diagnostics:DATES.map(date=>({date,status:'SOURCE_INCOMPLETE',
      sourceDataErrors:['확정 원자료 부족으로 기존 Snapshot 보존: '+code]}))};
  const automation={status:'ok',automation:{gasVersion:'9.243'}};
  const priceHistory={status:'ok',dates:['2026-01-06'],prices:{
    [code]:[{date:'2026-01-06',price:888,source:'KRX_CONFIRMED_CLOSE'}]}};
  const trade={status:'ok',trades:[{code,date:'2025-09-03',tradeType:'buy',name:'SYNTHETIC_NAME',acct:'SYNTHETIC_ACCOUNT',qty:2,price:100}]};
  const yearEndSnapshot={status:'ok',date:'2026-01-01',items:[]};
  const proofs=SOURCE_DATES.map(date=>({status:'ok',
    coverage:{mode:'READ_ONLY',requestedDate:date,expectedHeldCodes:30},
    targetEvidence:{requested:true,eligibleHeldDomestic:true,
      exactDateConfirmed:true,usedDate:date,providerClass:'KRX_OPENAPI'}}));
  // Supported deployed versions share this read-only endpoint contract.
  // Never accept future versions without checking their actual response schema.
  const currentlyDeployed=structuredClone(automation);
  currentlyDeployed.automation.gasVersion='9.244';
  assert.equal(evaluate({diagnosis,automation:currentlyDeployed,
    priceHistory,trade,yearEndSnapshot,proofs}).yearEndCarrySourceReady,true);
  const unknownVersion=structuredClone(automation);
  unknownVersion.automation.gasVersion='9.245';
  assert.throws(()=>evaluate({diagnosis,automation:unknownVersion,
    priceHistory,trade,yearEndSnapshot,proofs}),/ISSUE507_PREFLIGHT_GAS_VERSION/);
  const blankVersion=structuredClone(automation);
  blankVersion.automation.gasVersion='';
  assert.throws(()=>evaluate({diagnosis,automation:blankVersion,
    priceHistory,trade,yearEndSnapshot,proofs}),/ISSUE507_PREFLIGHT_GAS_VERSION/);
  const input={diagnosis,automation,priceHistory,trade,yearEndSnapshot,proofs};
  const ok=evaluate(input);
  assert.equal(ok.yearEndCarrySourceReady,true);
  assert.notEqual(ok.sourceReadCoherenceChecked,true,
    'pure evaluator does not independently prove source coherence');
  assert.equal(ok.observations.length,3);
  assert.equal(ok.earliestCurrentCodePriceDate,'2026-01-06');
  assert.ok(ok.observations.every(x=>x.sourceOnlyEligibleForLaterApproval));
  assert.equal(ok.historyWritten,false);
  for(const secret of [code,'SYNTHETIC_NAME','SYNTHETIC_ACCOUNT','888'])
    assert.ok(!JSON.stringify(ok).includes(secret));
  const stale=structuredClone(input);
  stale.proofs[0].targetEvidence={...stale.proofs[0].targetEvidence,
    exactDateConfirmed:false,usedDate:'',providerClass:'NOT_CONFIRMED'};
  assert.equal(evaluate(stale).yearEndCarrySourceReady,false);
  const existing=structuredClone(input);
  existing.priceHistory.prices[code].push({date:'2025-12-30',price:100,source:'MANUAL'});
  assert.equal(evaluate(existing).observations[0].decision,'EXISTING_HISTORY_PROTECTED');
  assert.equal(evaluate(existing).observations[0].existingManualProtected,true);
  const split=structuredClone(input);
  split.trade.trades.push({code,date:'2025-12-31',tradeType:'split'});
  assert.equal(evaluate(split).observations[0].decision,'CORPORATE_ACTION_REVIEW_REQUIRED');
  const drift=structuredClone(input);
  drift.trade.trades=[{code,date:'2026-01-02',tradeType:'buy'}];
  assert.equal(evaluate(drift).codeHeldBeforeYearEnd,false);
  assert.equal(evaluate(drift).yearEndCarrySourceReady,false);
  assert.equal(ok.observations[0].fullRawPriceHistoryDuplicateScanPerformed,false);
  assert.equal(ok.originalSheetWriteApproved,false);
  const future=structuredClone(input);
  future.proofs[0].targetEvidence.usedDate='2026-01-02';
  assert.throws(()=>evaluate(future),/ISSUE507_PREFLIGHT_NOT_EXACT/);
  const extra=structuredClone(input);
  extra.priceHistory.prices['WRONG_CODE']=[{date:'2025-12-30',price:1,source:'KRX'}];
  assert.throws(()=>evaluate(extra),/ISSUE507_PREFLIGHT_EXTRA_CODE/);
  const actions=[];
  const fetchImpl=async(_url,opts)=>{
    const action=opts.body.get('action'),date=opts.body.get('date');
    actions.push(action);
    const body=opts.body.get('accessToken')!=='SYNTHETIC_TOKEN'
      ? {status:'error',message:'인증 실패'}
      : action==='diagnoseSnapshotIntegrityRange'?diagnosis
      : action==='getAutomationStatus'?automation
      : action==='getPriceHistory'?priceHistory
      : action==='getTrades'?trade
      : action==='getHistoryDetail'?yearEndSnapshot
      : proofs.find(p=>p.coverage.requestedDate===date);
    return {ok:true,json:async()=>body};
  };
  const live=await readLive({url:'https://script.google.com/macros/s/TEST/exec',token:'SYNTHETIC_TOKEN',fetchImpl});
  assert.equal(live.yearEndCarrySourceReady,true);
  assert.equal(live.sourceReadCoherenceChecked,true);
  assert.deepEqual(actions,['getKrxHeldCloseCoverage','diagnoseSnapshotIntegrityRange',
    'getAutomationStatus','getPriceHistory','getTrades','getHistoryDetail',
    'getKrxHeldCloseCoverage','getKrxHeldCloseCoverage','getKrxHeldCloseCoverage',
    'getPriceHistory','getTrades','getHistoryDetail']);
  assert.ok(!JSON.stringify(live).includes('SYNTHETIC_TOKEN'));
  // Each of the three privileged source reads must fail closed if changed
  // midway through KRX validation; never print the sensitive changed value.
  for (const action of ['getPriceHistory','getTrades','getHistoryDetail']) {
    const seen={}, unstableFetch=async(_url,opts)=>{
      const name=opts.body.get('action'),date=opts.body.get('date');
      seen[name]=(seen[name]||0)+1;
      const value=opts.body.get('accessToken')!=='SYNTHETIC_TOKEN'
        ? {status:'error',message:'인증 실패'}
        : name==='diagnoseSnapshotIntegrityRange'?diagnosis
        : name==='getAutomationStatus'?automation
        : name==='getPriceHistory'?priceHistory
        : name==='getTrades'?trade
        : name==='getHistoryDetail'?yearEndSnapshot
        : proofs.find(p=>p.coverage.requestedDate===date);
      let response=value;
      if(name===action&&seen[name]===2) {
        response=structuredClone(value);
        if(name==='getPriceHistory')response.prices[code][0].price=999991;
        if(name==='getTrades')response.trades[0].qty=991;
        if(name==='getHistoryDetail')response.items.push({code,qty:991});
      }
      return {ok:true,json:async()=>response};
    };
    await assert.rejects(()=>readLive({url:'https://script.google.com/macros/s/TEST/exec',
      token:'SYNTHETIC_TOKEN',fetchImpl:unstableFetch}),
      /ISSUE507_PREFLIGHT_SOURCE_CHANGED/);
  }
  assert.throws(()=>assertSourceReadsUnchanged([trade],[trade]),
    /ISSUE507_PREFLIGHT_SOURCE_SCOPE/);
  assert.equal(assertSourceReadsUnchanged([priceHistory,trade,yearEndSnapshot],
    [structuredClone(priceHistory),structuredClone(trade),structuredClone(yearEndSnapshot)]),true);
  console.log('Issue #507 official KRX source-only preflight synthetic gates: PASS');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    if(process.argv.includes('--self-test'))await selfTest();
    else console.log(JSON.stringify(await readLive({
      url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN})));
  }catch(e){
    if(process.argv.includes('--self-test'))console.error(String(e?.stack||e).slice(0,1600));
    else {
      const code=String(e?.message||'');
      console.error(/^ISSUE507_PREFLIGHT_[A-Z_]+$/.test(code)?code:'ISSUE507_PREFLIGHT_UNKNOWN');
    }
    process.exitCode=1;
  }
}
