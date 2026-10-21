#!/usr/bin/env node
// Issue #507: three-day code-lineage triage, STRICT READ ONLY.
// All identifiers, raw ledger rows, quantities, prices and GAS tokens remain
// inside the ephemeral GitHub runner. Only date-level counts leave this process.
import assert from 'node:assert/strict';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {validateInventory,assessBatch} from './issue507-supervised-repair-dryrun-readonly.mjs';

export const TARGET_DATES=Object.freeze(['2026-01-08','2026-01-09','2026-01-17']);
const DIGEST=/^[0-9a-f]{64}$/;
const fail=reason=>{throw Error('ISSUE507_THREE_DAY_'+reason);};
function guard(ok,reason){if(!ok)fail(reason);}
function normCode(raw){
  const x=String(raw??'').trim().toUpperCase();
  if(/^\d+$/.test(x))return x.padStart(6,'0');
  return /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/.test(x)&&x.length<=30&&/[A-Z]/.test(x)?x:'';
}
function id(row){return normCode(row?.[1])||String(row?.[2]??'').trim();}
const bounded=v=>{guard(Number.isSafeInteger(v)&&v>=0&&v<=1000000,'COUNT');return v;};
function pctNumber(v,digits){
  const p=10**digits;
  return Math.round((Number(v)||0)*p)/p;
}
function qtyCost(row){return JSON.stringify([pctNumber(row[3],8),pctNumber(row[5],0)]);}
function intersectCount(sets){
  return bounded([...sets[0]].filter(k=>sets.slice(1).every(s=>s.has(k))).length);
}
function classSource(row){
  const s=String(row?.[10]??'').toUpperCase().trim();
  if(s==='MANUAL')return 'MANUAL';
  // A carried NAV is historical/indicative evidence, NOT a fresh published
  // NAV. Preserve missing-input state as an independent blocker.
  if(s.startsWith('FUND_NAV_CARRY_INPUT_REQUIRED'))return 'FUND_NAV_CARRY_INPUT_REQUIRED';
  if(s.startsWith('FUND_NAV_CARRY'))return 'FUND_NAV_CARRY';
  if(s==='FUND_NAV')return 'FUND_NAV_PUBLISHED_CLAIM_UNVERIFIED';
  if(s.includes('CARRY'))return 'CARRY_UNCONFIRMED';
  if(s.includes('KRX')||s.includes('TOSS')||s.includes('CONFIRMED'))return 'CONFIRMED_CLAIM_UNVERIFIED';
  if(s==='PRICE_HISTORY')return 'PRICE_HISTORY_UNVERIFIED';
  return 'OTHER_UNVERIFIED';
}
function sourceCounts(rows){
  const counts={};
  for(const row of rows){
    const family=classSource(row);
    counts[family]=bounded((counts[family]||0)+1);
  }
  return counts;
}
export function summarizeThreeDays(payload){
  guard(payload?.status==='ok'&&Array.isArray(payload.checkedDates)
    &&payload.checkedDates.join('|')===TARGET_DATES.join('|')
    &&Array.isArray(payload.diagnostics)
    &&payload.diagnostics.length===TARGET_DATES.length
    &&DIGEST.test(payload.strictSourceDigest||'')
    &&typeof payload.integritySourceRevision==='string'
    &&payload.integritySourceRevision.length>0,'SCHEMA');
  // Reuse the already validated, production-compatible qty/cost, source-error
  // and duplicate classification oracle. Never print its private input.
  const batch=assessBatch(payload,TARGET_DATES);
  const missingSets=[],duplicateSets=[],mismatchSets=[],out=[];
  payload.diagnostics.forEach((day,index)=>{
    const date=TARGET_DATES[index],assessed=batch.days[index];
    guard(day.date===date&&day.sourceDataErrors.length===0,'SOURCE_INCOMPLETE');
    const expected=new Map(day.expectedRows.map(r=>[id(r),r]));
    const stored=new Map();
    day.storedRows.forEach(r=>{
      const k=id(r);guard(k,'MISSING_ID');
      if(!stored.has(k))stored.set(k,[]);
      stored.get(k).push(r);
    });
    const missing=new Set([...expected.keys()].filter(k=>!stored.has(k)));
    const duplicate=new Set([...stored].filter(([,rows])=>rows.length>1).map(([k])=>k));
    const mismatches=new Set([...expected].filter(([k,row])=>
      stored.has(k)&&!stored.get(k).some(sr=>qtyCost(sr)===qtyCost(row))).map(([k])=>k));
    const onlyEvaluation=new Set([...expected].filter(([k,row])=>
      stored.has(k)&&stored.get(k).some(sr=>qtyCost(sr)===qtyCost(row))
      &&!stored.get(k).some(sr=>JSON.stringify(sr.slice(0,11))===JSON.stringify(row.slice(0,11)))).map(([k])=>k));
    guard(missing.size===assessed.missingExpectedRows
      &&duplicate.size===assessed.duplicateGroups
      &&assessed.expectedRowsWithAnyStoredQtyCostCandidate+
          mismatches.size+missing.size===assessed.expectedRows,'DRIFT');
    missingSets.push(missing);duplicateSets.push(duplicate);mismatchSets.push(mismatches);
    out.push({date,
      expectedRows:bounded(assessed.expectedRows),
      storedRows:bounded(assessed.storedRows),
      missingCodes:bounded(missing.size),
      duplicateGroups:bounded(duplicate.size),
      existingWithNoQtyCostCandidate:bounded(mismatches.size),
      existingWithQtyCostCandidate:bounded(assessed.expectedRowsWithAnyStoredQtyCostCandidate),
      valuationOrSourceOnlyCodes:bounded(onlyEvaluation.size),
      duplicateReasons:assessed.duplicateReasons,
      expectedSourceClaims:sourceCounts(day.expectedRows),
      storedSourceClaims:sourceCounts(day.storedRows),
      writeAllowed:false});
  });
  return {mode:'ISSUE507_THREE_DAY_CODE_LINEAGE_READ_ONLY',gasVersionChecked:'9.244',
    targetDates:TARGET_DATES,days:out,
    sameMissingCodeAllThree:intersectCount(missingSets),
    sameDuplicateCodeAllThree:intersectCount(duplicateSets),
    sameNoQtyCostCandidateAllThree:intersectCount(mismatchSets),
    allSourcePriceClaimsIndependentlyVerified:false,
    sourceAtCopyVerified:false,allowedToRestore:false,allowedToDelete:false,
    writesPerformed:0,note:'Code joins and row amounts are private to the runner; aggregate source family names are only existing labels, not verified historical prices.'};
}

// Additional triage: determine whether the six recurring qty/cost mismatches
// can be explained by a ledger trade in the *interval*. Presence of a trade
// is context, not proof: this probe does not reconstruct lots or price basis.
export function analyzePersistentQtyCost(payload,tradesResponse){
  const baseline=summarizeThreeDays(payload);
  guard(tradesResponse?.status==='ok'&&Array.isArray(tradesResponse.trades)
    &&tradesResponse.trades.length<=100000,'TRADE_SCHEMA');
  const maps=payload.diagnostics.map(day=>{
    const expected=new Map(day.expectedRows.map(r=>[id(r),r]));
    const stored=new Map();
    day.storedRows.forEach(r=>{
      const k=id(r);
      if(!stored.has(k))stored.set(k,[]);
      stored.get(k).push(r);
    });
    const mismatch=new Map([...expected].filter(([k,row])=>
      stored.has(k)&&!stored.get(k).some(sr=>qtyCost(sr)===qtyCost(row))));
    return {expected,stored,mismatch};
  });
  const persistent=new Set([...maps[0].mismatch.keys()]
    .filter(k=>maps.slice(1).every(m=>m.mismatch.has(k))));
  const lastOnly=new Set([...maps[2].mismatch.keys()]
    .filter(k=>!persistent.has(k)));
  const categories={QTY_ONLY_DRIFT:0,COST_ONLY_DRIFT:0,QTY_AND_COST_DRIFT:0,
    DIFFERENT_ROWS_MATCH_FIELDS_SEPARATELY:0};
  const changed={ledgerQtyAcrossDates:0,ledgerCostAcrossDates:0,
    storedQtyCandidateAcrossDates:0,storedCostCandidateAcrossDates:0};
  for(const k of persistent){
    const perDay=maps.map(m=>{
      const er=m.expected.get(k),candidates=m.stored.get(k);
      guard(er&&candidates?.length,'CODE_JOIN');
      const q=pctNumber(er[3],8),cost=pctNumber(er[5],0);
      const anyQ=candidates.some(r=>pctNumber(r[3],8)===q);
      const anyCost=candidates.some(r=>pctNumber(r[5],0)===cost);
      const label=anyQ?(anyCost?'DIFFERENT_ROWS_MATCH_FIELDS_SEPARATELY':'COST_ONLY_DRIFT')
        :anyCost?'QTY_ONLY_DRIFT':'QTY_AND_COST_DRIFT';
      return {q,cost,label,
        storedQty:JSON.stringify([...new Set(candidates.map(r=>pctNumber(r[3],8)))].sort((a,b)=>a-b)),
        storedCost:JSON.stringify([...new Set(candidates.map(r=>pctNumber(r[5],0)))].sort((a,b)=>a-b))};
    });
    for(const v of perDay)categories[v.label]=bounded(categories[v.label]+1);
    if(new Set(perDay.map(x=>x.q)).size>1)changed.ledgerQtyAcrossDates++;
    if(new Set(perDay.map(x=>x.cost)).size>1)changed.ledgerCostAcrossDates++;
    if(new Set(perDay.map(x=>x.storedQty)).size>1)changed.storedQtyCandidateAcrossDates++;
    if(new Set(perDay.map(x=>x.storedCost)).size>1)changed.storedCostCandidateAcrossDates++;
  }
  const tradeWindows={
    preOrOnJan08:0,jan09:0,jan10Through17:0,postJan17:0,
    codesTradedJan09:0,codesTradedJan10Through17:0,
    codesWithoutTradesJan09Through17:0
  };
  // Production _buildSnapshotRowsFromTradeAndPriceHistory() maps historical
  // blank-code trades by exact (trimmed) name via master+dated ledger names.
  // We have no master identity endpoint in this audit: take the union of
  // *observed* diagnostic expected names and explicit coded trade names,
  // and treat colliding/unmapped names as unresolved rather than "no trades".
  const nameCandidates=new Map();
  const rememberName=(name,c)=>{
    const value=String(name??'').trim(),code=normCode(c);
    if(!value||!code)return;
    if(!nameCandidates.has(value))nameCandidates.set(value,new Set());
    nameCandidates.get(value).add(code);
  };
  for(const day of payload.diagnostics)
    for(const r of day.expectedRows)rememberName(r[2],r[1]);
  for(const t of tradesResponse.trades){
    guard(t&&typeof t.code==='string'&&typeof t.name==='string'
      &&typeof t.date==='string'&&typeof t.tradeType==='string','TRADE_ROW');
    if(normCode(t.code))rememberName(t.name,t.code);
  }
  const tradedJan09=new Set(),tradedLater=new Set();
  let codeLessMapped=0,codeLessRelevantMapped=0,
    codeLessRelevantUnresolved=0,codeLessRelevantAmbiguous=0,
    ignoredUnsupportedTypeRowsInWindow=0,ignoredNoEffectRowsInWindow=0;
  for(const t of tradesResponse.trades){
    const date=t.date.slice(0,10);
    // Validate all ledger dates so malformed code-less records cannot quietly
    // bypass diagnostic lineage accuracy.
    guard(/^\d{4}-\d{2}-\d{2}$/.test(date)
      &&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date,'TRADE_DATE');
    const relevantWindow=date>'2026-01-08'&&date<='2026-01-17';
    // Mirror production _applyHoldingTrade: blank names/types skip, and only
    // buy/sell/split/reverse_split mutate its holdings reducer. A zero-quantity
    // buy/sell and a non-positive split ratio also cannot change holdings.
    // Even accepted rows are only *potential* contributors, not proof of
    // realized position/cost changes (which requires lot replay).
    const type=t.tradeType.trim();
    const supported=['buy','sell','split','reverse_split'].includes(type);
    const effectPossible=!!t.name.trim()&&(type==='buy'||type==='sell'
      ? Number(t.qty)>0 : Number(t.ratio)>0);
    if(!supported||!t.name.trim()){
      if(relevantWindow)ignoredUnsupportedTypeRowsInWindow++;
      continue;
    }
    if(!effectPossible){
      if(relevantWindow)ignoredNoEffectRowsInWindow++;
      continue;
    }
    const explicit=normCode(t.code);
    const aliases=nameCandidates.get(t.name.trim());
    const ambiguous=!explicit&&aliases?.size>1;
    const mapped=!explicit&&aliases?.size===1?[...aliases][0]:'';
    const resolved=explicit||mapped;
    if(!explicit&&mapped)codeLessMapped++;
    if(relevantWindow&&!explicit&&mapped&&persistent.has(mapped))codeLessRelevantMapped++;
    if(relevantWindow&&!explicit&&!mapped){
      codeLessRelevantUnresolved++;
      if(ambiguous)codeLessRelevantAmbiguous++;
    }
    if(!persistent.has(resolved))continue;
    if(date<='2026-01-08')tradeWindows.preOrOnJan08++;
    else if(date==='2026-01-09'){tradeWindows.jan09++;tradedJan09.add(resolved);}
    else if(date<='2026-01-17'){tradeWindows.jan10Through17++;tradedLater.add(resolved);}
    else tradeWindows.postJan17++;
  }
  Object.keys(tradeWindows).forEach(k=>{tradeWindows[k]=bounded(tradeWindows[k]);});
  tradeWindows.codesTradedJan09=bounded(tradedJan09.size);
  tradeWindows.codesTradedJan10Through17=bounded(tradedLater.size);
  // An unrelated code-less trade cannot imply a trade in a monitored code.
  // But if any unmappable blank-code trade falls in the audited interval,
  // code-level proof of ABSENCE is not available without master mapping.
  const noMatchedTrade=bounded([...persistent]
    .filter(k=>!tradedJan09.has(k)&&!tradedLater.has(k)).length);
  // Missing a raw matched trade is NOT proof that the master would not map
  // another historical name to this code. Never certify transaction absence.
  tradeWindows.codesWithoutTradesJan09Through17=null;
  tradeWindows.codesWithNoMatchedTradeEvidenceJan09Through17=noMatchedTrade;
  tradeWindows.codeLessMappedAllDates=bounded(codeLessMapped);
  tradeWindows.codeLessMappedToPersistentCodesJan09Through17=bounded(codeLessRelevantMapped);
  tradeWindows.unresolvedCodeLessTradesJan09Through17=bounded(codeLessRelevantUnresolved);
  tradeWindows.ambiguousNameCodeTradesJan09Through17=bounded(codeLessRelevantAmbiguous);
  tradeWindows.ignoredUnsupportedTypeRowsJan09Through17=bounded(ignoredUnsupportedTypeRowsInWindow);
  tradeWindows.ignoredNonEffectiveRowsJan09Through17=bounded(ignoredNoEffectRowsInWindow);
  // No private codes/dates of individual trades/amounts are ever returned.
  return {mode:'ISSUE507_PERSISTENT_QTY_COST_PRIVATE_LEDGER_TRIAGE',
    recurringMissingQtyCostCodes:bounded(persistent.size),
    jan17ExtraMismatchCodes:bounded(lastOnly.size),
    categoryCountsAcrossThreeDates:categories,
    crossDateChangedCodeCounts:changed,
    privateLedgerTradeActivity:tradeWindows,
    ledgerTradeAbsenceCertified:false,
    nameResolutionMatchesProductionMasterCertified:false,
    ledgerTransactionPresenceIsNotCausality:true,
    categoryIsBasedOnNumericPrecisionQty8Cost0:true,
    verifiedLedgerLotReconstruction:false,verifiedHistoricalCorporateActions:false,
    independentPriceVerification:false,restoreAllowed:false,deleteAllowed:false,
    writesPerformed:0,sourceDigestStableWithinCall:false,
    note:'This report only distinguishes qty/cost drift and whether trades exist; it does not approve price substitution or any Snapshot mutations.'};
}

async function request(url,token,action,args,fetchImpl){
  let res;
  try{
    res=await fetchImpl(url,{method:'POST',redirect:'follow',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({action,...args,accessToken:token}),
      signal:AbortSignal.timeout(240000)});
  }catch{fail('NETWORK');}
  guard(res?.ok===true,'HTTP');
  try{return await res.json();}catch{fail('JSON');}
}
export async function runReadonly({url,token,fetchImpl=fetch}){
  const endpoint=validateWebAppUrl(url);
  guard(typeof token==='string'&&token.trim().length>0,'TOKEN');
  const bad=token==='ISSUE507_INVALID_ONE'?'ISSUE507_INVALID_TWO':'ISSUE507_INVALID_ONE';
  const denied=await request(endpoint,bad,'getAutomationStatus',{},fetchImpl);
  guard(denied?.status==='error'&&denied.message==='인증 실패','AUTH');
  const before=validateInventory(await request(endpoint,token,'getAutomationStatus',{},fetchImpl));
  guard(TARGET_DATES.every(d=>before.dates.includes(d)),'NOT_DEFERRED');
  const args={dates:TARGET_DATES.join(','),strictReadonly:'1'};
  const first=await request(endpoint,token,'diagnoseSnapshotIntegrityRange',args,fetchImpl);
  const summary=summarizeThreeDays(first);
  // Trade-history read is private to the runner and never logged.
  const trades=await request(endpoint,token,'getTrades',{},fetchImpl);
  const persistent=analyzePersistentQtyCost(first,trades);
  const second=await request(endpoint,token,'diagnoseSnapshotIntegrityRange',args,fetchImpl);
  // Validate both actual responses; do not echo raw source digests.
  summarizeThreeDays(second);
  guard(first.strictSourceDigest===second.strictSourceDigest
    &&first.integritySourceRevision===second.integritySourceRevision,'SOURCE_CHANGED');
  const after=validateInventory(await request(endpoint,token,'getAutomationStatus',{},fetchImpl));
  guard(before.dates.join('|')===after.dates.join('|')
    &&before.cursor===after.cursor&&before.pendingFrom===after.pendingFrom,'QUEUE_CHANGED');
  return {...summary,recurringQtyCostTriage:{...persistent,
      sourceDigestStableWithinCall:true},sourceStableWithinThisRead:true,
    queueStableWithinThisRead:true,crossRunSourceStabilityCertified:false};
}
function fixtureDay(date){
  const row=(c,qty,evalAmount,source='KRX')=>
    [date,c,'SYNTH',qty,10,qty*10,evalAmount,evalAmount,evalAmount-qty*10,0,source,''];
  const a=row('000001',1,21), b=row('000001',1,22);
  const c=row('000003',3,50), missing=row('000002',2,35);
  // Expected ledger rows and stored Snapshot must not share references:
  // otherwise mutation tests silently change both source and target.
  return {date,status:'CONFLICT',expectedRows:[a.slice(),missing.slice(),c.slice()],
    storedRows:[a,b,c],sourceDataErrors:[],
    duplicateKeys:[date+'|000001'],missingCodes:['000002'],unexpectedCodes:[],
    duplicateSummary:{groups:1,exactDuplicate:0,singleExpectedMatch:0,
      manualProtected:0,unresolvedConflict:1,sourceIncomplete:0}};
}
export async function selfTest(){
  const d='a'.repeat(64),dates=TARGET_DATES;
  const data={status:'ok',checkedDates:dates,diagnostics:dates.map(fixtureDay),
    strictSourceDigest:d,integritySourceRevision:'1'};
  const result=summarizeThreeDays(data);
  assert.equal(result.sameMissingCodeAllThree,1);
  assert.equal(result.sameDuplicateCodeAllThree,1);
  assert.equal(result.days[0].expectedRows,3);
  assert.equal(result.days[0].missingCodes,1);
  assert.equal(result.days[0].duplicateGroups,1);
  assert.equal(result.days[0].existingWithNoQtyCostCandidate,0);
  assert.equal(result.days[0].existingWithQtyCostCandidate,2);
  assert.equal(result.allowedToRestore,false);
  // Production GAS source labels: carry is NOT the same as published NAV.
  const carried=structuredClone(data);
  carried.diagnostics.forEach(d=>{
    d.expectedRows[0][10]='FUND_NAV_CARRY@2026-01-07';
    d.storedRows[0][10]='FUND_NAV_CARRY_INPUT_REQUIRED';
    d.storedRows[1][10]='FUND_NAV';
    d.expectedRows[1][10]='PRICE_HISTORY';
    d.storedRows[2][10]='KRX_CONFIRMED_CLOSE';
  });
  const sourceClassified=summarizeThreeDays(carried);
  assert.equal(sourceClassified.days[0].expectedSourceClaims.FUND_NAV_CARRY,1);
  assert.equal(sourceClassified.days[0].storedSourceClaims.FUND_NAV_CARRY_INPUT_REQUIRED,1);
  assert.equal(sourceClassified.days[0].storedSourceClaims.FUND_NAV_PUBLISHED_CLAIM_UNVERIFIED,1);
  assert.equal(sourceClassified.days[0].storedSourceClaims.CONFIRMED_CLAIM_UNVERIFIED,1);
  assert.equal(sourceClassified.days[0].storedSourceClaims.FUND_NAV_CARRY,undefined);
  assert.equal(sourceClassified.days[0].storedSourceClaims.CARRY_UNCONFIRMED,undefined);
  assert.ok(!JSON.stringify(result).includes('000001'));
  assert.ok(!JSON.stringify(result).includes('SYNTH'));
  const drift=structuredClone(data);drift.diagnostics[1].missingCodes=[];
  assert.throws(()=>summarizeThreeDays(drift),/DRIFT/);

  const qtyCostDrift=structuredClone(data);
  qtyCostDrift.diagnostics.forEach(day=>{
    // Separate original ledger expected from an *older* Snapshot record.
    day.storedRows[2][3]=2;
    day.storedRows[2][5]=20;
  });
  // On 01-17 another stored code mismatches without being a three-day issue.
  qtyCostDrift.diagnostics[2].storedRows[0][3]=2;
  qtyCostDrift.diagnostics[2].storedRows[1][3]=2;
  const tradeFixture={status:'ok',trades:[
    {date:'2025-12-30',code:'000003',name:'SYNTH',tradeType:'buy',qty:1},
    {date:'2026-01-09',code:'000003',name:'SYNTH',tradeType:'sell',qty:1},
    {date:'2026-01-11',code:'000003',name:'SYNTH',tradeType:'buy',qty:1},
    {date:'2026-01-20',code:'000003',name:'SYNTH',tradeType:'buy',qty:1},
    {date:'2026-01-10',code:'123456',name:'OTHER',tradeType:'buy',qty:1}
  ]};
  const qResult=analyzePersistentQtyCost(qtyCostDrift,tradeFixture);
  assert.equal(qResult.recurringMissingQtyCostCodes,1);
  assert.equal(qResult.jan17ExtraMismatchCodes,1);
  assert.equal(qResult.categoryCountsAcrossThreeDates.QTY_AND_COST_DRIFT,3);
  assert.equal(qResult.privateLedgerTradeActivity.codesTradedJan09,1);
  assert.equal(qResult.privateLedgerTradeActivity.codesTradedJan10Through17,1);
  assert.equal(qResult.privateLedgerTradeActivity.postJan17,1);
  assert.equal(qResult.privateLedgerTradeActivity.codesWithoutTradesJan09Through17,null);
  assert.equal(qResult.privateLedgerTradeActivity.codesWithNoMatchedTradeEvidenceJan09Through17,0);
  // Review regression: GAS ignores unknown/empty types, empty names, zero
  // quantity buy/sell, and non-positive split ratios (they change no holdings).
  const ignore=structuredClone(tradeFixture);
  ignore.trades.push(
    {date:'2026-01-09',code:'000003',name:'SYNTH',tradeType:''},
    {date:'2026-01-09',code:'000003',name:'SYNTH',tradeType:'dividend',qty:1},
    {date:'2026-01-10',code:'000003',name:'',tradeType:'buy',qty:1},
    {date:'2026-01-10',code:'000003',name:'SYNTH',tradeType:'buy',qty:0},
    {date:'2026-01-10',code:'000003',name:'SYNTH',tradeType:'split',ratio:0},
    {date:'2026-01-10',code:'000003',name:'SYNTH',tradeType:'reverse_split',ratio:0}
  );
  const ignored=analyzePersistentQtyCost(qtyCostDrift,ignore);
  assert.equal(ignored.privateLedgerTradeActivity.jan09,1);
  assert.equal(ignored.privateLedgerTradeActivity.jan10Through17,1);
  assert.equal(ignored.privateLedgerTradeActivity.ignoredUnsupportedTypeRowsJan09Through17,3);
  assert.equal(ignored.privateLedgerTradeActivity.ignoredNonEffectiveRowsJan09Through17,3);
  const split=structuredClone(ignore);
  split.trades.push({date:'2026-01-10',code:'000003',name:'SYNTH',tradeType:'split',ratio:2});
  assert.equal(analyzePersistentQtyCost(qtyCostDrift,split).privateLedgerTradeActivity.jan10Through17,2);
  // If GAS sees a blank-code transaction by recognized name it must count.
  // Give the recurring code an unambiguous expected name.
  const named=structuredClone(qtyCostDrift);
  named.diagnostics.forEach(day=>{
    day.expectedRows[2][2]='UNIQUE_LEDGER_NAME';
    day.storedRows[2][2]='UNIQUE_LEDGER_NAME';
  });
  const codedByName=structuredClone(tradeFixture);
  codedByName.trades.push({date:'2026-01-09',code:'',name:'UNIQUE_LEDGER_NAME',tradeType:'buy',qty:1});
  const resolvedNames=analyzePersistentQtyCost(named,codedByName);
  assert.equal(resolvedNames.privateLedgerTradeActivity.codeLessMappedToPersistentCodesJan09Through17,1);
  assert.equal(resolvedNames.privateLedgerTradeActivity.jan09,2);
  assert.equal(resolvedNames.privateLedgerTradeActivity.codesTradedJan09,1);
  assert.equal(resolvedNames.ledgerTradeAbsenceCertified,false);
  assert.equal(resolvedNames.privateLedgerTradeActivity.codesWithNoMatchedTradeEvidenceJan09Through17,0);
  // Ambiguous or unknown names must NOT produce a false "no trade" claim.
  const unknown=structuredClone(codedByName);
  unknown.trades.push({date:'2026-01-10',code:'',name:'UNKNOWN_LEDGER_NAME',tradeType:'buy',qty:1});
  const uncertain=analyzePersistentQtyCost(named,unknown);
  assert.equal(uncertain.privateLedgerTradeActivity.unresolvedCodeLessTradesJan09Through17,1);
  assert.equal(uncertain.privateLedgerTradeActivity.codesWithoutTradesJan09Through17,null);
  assert.equal(uncertain.ledgerTradeAbsenceCertified,false);
  // Same display name with multiple explicitly coded instruments is ambiguous.
  const aliasAmbiguous=structuredClone(unknown);
  aliasAmbiguous.trades.push({date:'2026-01-09',code:'999999',name:'UNIQUE_LEDGER_NAME',tradeType:'buy',qty:1});
  aliasAmbiguous.trades.push({date:'2026-01-10',code:'',name:'UNIQUE_LEDGER_NAME',tradeType:'buy',qty:1});
  const ambiguousResult=analyzePersistentQtyCost(named,aliasAmbiguous);
  assert.equal(ambiguousResult.privateLedgerTradeActivity.ambiguousNameCodeTradesJan09Through17,2);
  assert.equal(ambiguousResult.ledgerTradeAbsenceCertified,false);
  assert.equal(qResult.verifiedLedgerLotReconstruction,false);
  assert.equal(qResult.restoreAllowed,false);
  assert.ok(!JSON.stringify(qResult).includes('000003'));
  assert.ok(!JSON.stringify(qResult).includes('SYNTH'));
  const malformedTrades=structuredClone(tradeFixture);
  malformedTrades.trades[0].tradeType=null;
  assert.throws(()=>analyzePersistentQtyCost(qtyCostDrift,malformedTrades),/TRADE_ROW/);
  const status={status:'ok',gasVersion:'9.244',automation:{
    gasVersion:'9.244',tradeSnapshotDeferredDates:dates,
    tradeSnapshotDeferredCount:3,tradeSnapshotDeferredOldestDate:dates[0],
    tradeSnapshotDeferredCursor:'',pendingTradeSnapshotRebuildFrom:''}};
  const calls=[];
  const stub=async(_url,options)=>{
    const action=options.body.get('action'),t=options.body.get('accessToken');
    calls.push(action);
    return {ok:true,json:async()=>t!=='TEST_TOKEN'
      ?{status:'error',message:'인증 실패'}
      :action==='getAutomationStatus'?status:action==='getTrades'?tradeFixture:data};
  };
  const live=await runReadonly({url:'https://script.google.com/macros/s/TEST/exec',
    token:'TEST_TOKEN',fetchImpl:stub});
  assert.equal(live.sourceStableWithinThisRead,true);
  assert.equal(live.queueStableWithinThisRead,true);
  assert.deepEqual(calls,['getAutomationStatus','getAutomationStatus',
    'diagnoseSnapshotIntegrityRange','getTrades','diagnoseSnapshotIntegrityRange','getAutomationStatus']);
  const mutated=structuredClone(data);mutated.strictSourceDigest='b'.repeat(64);
  let countCalls=0;
  const changed=async(_url,options)=>{
    const action=options.body.get('action'),token=options.body.get('accessToken');
    const response=token!=='TEST_TOKEN'?{status:'error',message:'인증 실패'}
      :action==='getAutomationStatus'?status:action==='getTrades'?tradeFixture:
        ++countCalls===1?data:mutated;
    return {ok:true,json:async()=>response};
  };
  await assert.rejects(runReadonly({url:'https://script.google.com/macros/s/TEST/exec',
    token:'TEST_TOKEN',fetchImpl:changed}),/SOURCE_CHANGED/);
  console.log('ISSUE507_THREE_DAY_CODE_LINEAGE_CONTRACT_PASS');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    if(process.argv.includes('--self-test'))await selfTest();
    else console.log(JSON.stringify(await runReadonly({
      url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN})));
  }catch(e){
    if(process.argv.includes('--self-test'))console.error(String(e?.stack||e).slice(0,1200));
    else console.error(/^ISSUE507_THREE_DAY_[A-Z_]+$/.test(String(e?.message||''))
      ?String(e.message):'ISSUE507_THREE_DAY_UNKNOWN');
    process.exitCode=1;
  }
}