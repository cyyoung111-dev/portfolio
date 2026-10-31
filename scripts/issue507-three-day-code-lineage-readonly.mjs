#!/usr/bin/env node
// Issue #507: three-day code-lineage triage, STRICT READ ONLY.
// All identifiers, raw ledger rows, quantities, prices and GAS tokens remain
// inside the ephemeral GitHub runner. Only date-level counts leave this process.
import assert from 'node:assert/strict';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {validateInventory,assessBatch} from './issue507-supervised-repair-dryrun-readonly.mjs';

export const TARGET_DATES=Object.freeze(['2026-01-08','2026-01-09','2026-01-17']);
export const BASELINE_DATES=Object.freeze(['2026-01-06','2026-01-07']);
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
export function summarizeThreeDays(payload,verifiedGasVersion=null){
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
  return {mode:'ISSUE507_THREE_DAY_CODE_LINEAGE_READ_ONLY',gasVersionChecked:verifiedGasVersion,
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
    ignoredUnsupportedTypeRowsInWindow=0,ignoredNoEffectRowsInWindow=0,
    nonstandardNegativeQtyRowsInWindow=0;
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
    // Production can actually apply negative buy/sell quantities as written;
    // they are abnormal inputs, not harmless zero-effect rows.
    const quantity=Number(t.qty??0),ratio=Number(t.ratio??0);
    guard(Number.isFinite(quantity)&&Number.isFinite(ratio),'TRADE_NUMERIC');
    const effectPossible=!!t.name.trim()&&(type==='buy'||type==='sell'
      ? quantity!==0 : ratio>0);
    if(relevantWindow&&(type==='buy'||type==='sell')&&quantity<0)
      nonstandardNegativeQtyRowsInWindow++;
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
  tradeWindows.negativeQtyPotentialMutationRowsJan09Through17=bounded(nonstandardNegativeQtyRowsInWindow);
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


// A source-complete prior-date Snapshot is needed to infer whether the same
// six qty/cost mismatches predate January 8. This read-only comparison NEVER
// infers historical causation, price validity, or a restorable baseline.
export function comparePriorBaseline(threeDay,baseline){
  summarizeThreeDays(threeDay);
  guard(baseline?.status==='ok'&&Array.isArray(baseline.checkedDates)
    &&baseline.checkedDates.join('|')===BASELINE_DATES.join('|')
    &&Array.isArray(baseline.diagnostics)
    &&baseline.diagnostics.length===BASELINE_DATES.length
    &&DIGEST.test(baseline.strictSourceDigest||'')
    &&typeof baseline.integritySourceRevision==='string'
    &&baseline.integritySourceRevision.length>0,'BASELINE_SCHEMA');
  const mismatches=threeDay.diagnostics.map(day=>{
    const exp=new Map(day.expectedRows.map(r=>[id(r),r])),stored=new Map();
    for(const r of day.storedRows){
      const k=id(r);guard(k,'BASELINE_ID');
      if(!stored.has(k))stored.set(k,[]);
      stored.get(k).push(r);
    }
    return new Set([...exp].filter(([k,row])=>stored.has(k)
      &&!stored.get(k).some(v=>qtyCost(v)===qtyCost(row))).map(([k])=>k));
  });
  const persistent=[...mismatches[0]]
    .filter(k=>mismatches.slice(1).every(set=>set.has(k)));
  const days=baseline.diagnostics.map((d,i)=>{
    guard(d?.date===BASELINE_DATES[i]&&Array.isArray(d.expectedRows)
      &&Array.isArray(d.storedRows)&&Array.isArray(d.sourceDataErrors)
      &&typeof d.status==='string','BASELINE_DAY_SCHEMA');
    // Source-incomplete results cannot establish a pre-existing mismatch.
    if(d.sourceDataErrors.length||d.status==='SOURCE_INCOMPLETE')
      return {date:BASELINE_DATES[i],status:'SOURCE_UNVERIFIABLE',
        checkedRecurringCodes:bounded(persistent.length),
        matchedQtyCost:null,mismatchedQtyCost:null,missingExpected:null,
        missingStored:null,missingBoth:null,priceProven:false};
    if(d.status==='NO_SNAPSHOT'||d.storedRows.length===0)
      return {date:BASELINE_DATES[i],status:'STORED_SNAPSHOT_UNAVAILABLE',
        checkedRecurringCodes:bounded(persistent.length),
        matchedQtyCost:null,mismatchedQtyCost:null,missingExpected:null,
        missingStored:null,missingBoth:null,priceProven:false};
    const expected=new Map();
    for(const r of d.expectedRows){
      const k=id(r);guard(k&&!expected.has(k),'BASELINE_EXPECTED_ID');
      expected.set(k,r);
    }
    const stored=new Map();
    for(const r of d.storedRows){
      const k=id(r);guard(k,'BASELINE_STORED_ID');
      if(!stored.has(k))stored.set(k,[]);
      stored.get(k).push(r);
    }
    const counts={matchedQtyCost:0,mismatchedQtyCost:0,missingExpected:0,
      missingStored:0,missingBoth:0};
    for(const k of persistent){
      const e=expected.get(k),v=stored.get(k);
      if(!e&&!v)counts.missingBoth++;
      else if(!e)counts.missingExpected++;
      else if(!v)counts.missingStored++;
      else if(v.some(r=>qtyCost(r)===qtyCost(e)))counts.matchedQtyCost++;
      else counts.mismatchedQtyCost++;
    }
    guard(Object.values(counts).reduce((a,b)=>a+b,0)===persistent.length,'BASELINE_COUNTS');
    return {date:BASELINE_DATES[i],status:'ASSESSED',checkedRecurringCodes:bounded(persistent.length),
      ...Object.fromEntries(Object.entries(counts).map(([k,v])=>[k,bounded(v)])),
      priceProven:false};
  });
  return {mode:'ISSUE507_JAN06_07_PRIOR_BASELINE_READONLY',days,
    recurringCodesCompared:bounded(persistent.length),
    earliestDivergenceDateProven:false,independentSourcePriceVerification:false,
    sourceAtHistoricalWriteVerified:false,canRecoverFromPriorSnapshot:false,
    restoreAllowed:false,deleteAllowed:false,writesPerformed:0,
    note:'Historical expected values are derived from the CURRENT ledger, not from a dated saved ledger version. Mismatch does not prove when the ledger was edited.'};
}


// The January 6 -> January 7 boundary is the first observed mismatch in the
// current-ledger-vs-stored comparison; this is NOT proof of mutation time.
// All per-code quantities, costs, trade names and identifiers remain in memory.
export function analyzeJan07Transition(threeDay,baseline,tradesResponse){
  const checked=comparePriorBaseline(threeDay,baseline);
  guard(tradesResponse?.status==='ok'&&Array.isArray(tradesResponse.trades)
    &&tradesResponse.trades.length<=100000,'TRANSITION_TRADES_SCHEMA');
  if(checked.days.some(d=>d.status!=='ASSESSED')){
    return {mode:'ISSUE507_JAN07_TRANSITION_READ_ONLY',state:'BASELINE_NOT_ASSESSABLE',
      baselineStatuses:checked.days.map(d=>d.status),
      possibleLedgerTradeRowsJan07:null,matchingCodesWithTradesJan07:null,
      restoreAllowed:false,deleteAllowed:false,writesPerformed:0};
  }
  const rowsForDay=d=>{
    const expected=new Map(),stored=new Map();
    for(const row of d.expectedRows){
      const key=id(row);guard(key&&!expected.has(key),'TRANSITION_EXPECTED_KEY');
      expected.set(key,row);
    }
    for(const row of d.storedRows){
      const key=id(row);guard(key,'TRANSITION_STORED_KEY');
      if(!stored.has(key))stored.set(key,[]);
      stored.get(key).push(row);
    }
    return {expected,stored};
  };
  const later=threeDay.diagnostics.map(rowsForDay);
  const recurring=[...later[0].expected].filter(([key,row])=>
    later.every(item=>item.expected.has(key)&&item.stored.has(key)
      &&!item.stored.get(key).some(r=>qtyCost(r)===qtyCost(item.expected.get(key)))))
    .map(([key])=>key);
  const prior=baseline.diagnostics.map(rowsForDay),compared=new Set(),ambiguous=new Set();
  // The keys below are never emitted; they only join source/stored drift and
  // potential 01/07 trade membership within this single private runner.
  const comparisonPatternByKey=new Map();
  const counts={commonCodes:bounded(recurring.length),comparableCodes:0,
    missingEitherBaselineCode:0,multipleStoredCandidates:0,
    matchedJan06:0,mismatchedJan07:0,
    expectedQtyChanged:0,expectedCostChanged:0,
    storedQtyChanged:0,storedCostChanged:0,
    expectedQtyChangedStoredUnchanged:0,expectedCostChangedStoredUnchanged:0,
    jan07QtyMismatch:0,jan07CostMismatch:0,jan07BothMismatch:0,
    jan07StoredEqualsJan06Expected:0,jan07ExpectedEqualsJan06Stored:0};
  for(const key of recurring){
    const e0=prior[0].expected.get(key),e1=prior[1].expected.get(key);
    const s0=prior[0].stored.get(key),s1=prior[1].stored.get(key);
    if(!e0||!e1||!s0||!s1){counts.missingEitherBaselineCode++;continue;}
    if(s0.length!==1||s1.length!==1){
      counts.multipleStoredCandidates++;
      ambiguous.add(key);
      continue;
    }
    compared.add(key);counts.comparableCodes++;
    const [v0,v1]=[s0[0],s1[0]];
    const eq=(a,b,col,n)=>pctNumber(a[col],n)===pctNumber(b[col],n);
    const q=(a,b)=>eq(a,b,3,8),cost=(a,b)=>eq(a,b,5,0);
    const expectedQChanged=!q(e0,e1),expectedCChanged=!cost(e0,e1);
    const storedQChanged=!q(v0,v1),storedCChanged=!cost(v0,v1);
    comparisonPatternByKey.set(key,{
      ledgerChanged:expectedQChanged||expectedCChanged,
      storedChanged:storedQChanged||storedCChanged
    });
    if(q(e0,v0)&&cost(e0,v0))counts.matchedJan06++;
    if(!q(e1,v1)||!cost(e1,v1))counts.mismatchedJan07++;
    if(expectedQChanged)counts.expectedQtyChanged++;
    if(expectedCChanged)counts.expectedCostChanged++;
    if(storedQChanged)counts.storedQtyChanged++;
    if(storedCChanged)counts.storedCostChanged++;
    if(expectedQChanged&&!storedQChanged)counts.expectedQtyChangedStoredUnchanged++;
    if(expectedCChanged&&!storedCChanged)counts.expectedCostChangedStoredUnchanged++;
    if(!q(e1,v1))counts.jan07QtyMismatch++;
    if(!cost(e1,v1))counts.jan07CostMismatch++;
    if(!q(e1,v1)&&!cost(e1,v1))counts.jan07BothMismatch++;
    if(q(v1,e0)&&cost(v1,e0))counts.jan07StoredEqualsJan06Expected++;
    if(q(e1,v0)&&cost(e1,v0))counts.jan07ExpectedEqualsJan06Stored++;
  }
  // The GAS master code table is not exposed here. Name matches are therefore
  // only candidates; mapped activity must never certify absence of a trade.
  const names=new Map();
  const associate=(name,code)=>{
    const label=String(name??'').trim(),resolved=normCode(code);
    if(!label||!resolved)return;
    if(!names.has(label))names.set(label,new Set());
    names.get(label).add(resolved);
  };
  for(const d of [...baseline.diagnostics,...threeDay.diagnostics])
    for(const r of d.expectedRows)associate(r[2],r[1]);
  for(const t of tradesResponse.trades){
    guard(t&&typeof t.code==='string'&&typeof t.name==='string'
      &&typeof t.date==='string'&&typeof t.tradeType==='string',
      'TRANSITION_TRADE_ROW');
    if(normCode(t.code))associate(t.name,t.code);
  }
  const involved=new Set(),tradeActivity={validPotentialRows:0,
    buyRows:0,sellRows:0,splitRows:0,reverseSplitRows:0,
    codeLessMappedRows:0,nameOnlyIdentityRows:0,
    unresolvedCodeLessRows:0,ambiguousCodeLessRows:0,
    ignoredInvalidTypeOrNameRows:0,ignoredNonEffectiveRows:0,
    negativeQuantityRows:0};
  for(const t of tradesResponse.trades){
    const date=t.date.slice(0,10);
    guard(/^\d{4}-\d{2}-\d{2}$/.test(date)
      &&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date,
      'TRANSITION_DATE');
    if(date!=='2026-01-07')continue;
    const type=t.tradeType.trim();
    if(!['buy','sell','split','reverse_split'].includes(type)||!t.name.trim()){
      tradeActivity.ignoredInvalidTypeOrNameRows++;
      continue;
    }
    const qty=Number(t.qty??0),ratio=Number(t.ratio??0);
    guard(Number.isFinite(qty)&&Number.isFinite(ratio),'TRANSITION_NUMERIC');
    if(type==='buy'||type==='sell'?qty===0:ratio<=0){
      tradeActivity.ignoredNonEffectiveRows++;
      continue;
    }
    if((type==='buy'||type==='sell')&&qty<0)tradeActivity.negativeQuantityRows++;
    const label=t.name.trim(),explicit=normCode(t.code),candidates=names.get(label);
    const mapped=!explicit&&candidates?.size===1?[...candidates][0]:'';
    // GAS _applyHoldingTrade uses 'code || name': when BOTH expected position
    // and ledger trade have no code, the exact trimmed name is the identity.
    // Only fall back to that name when no coded alias exists; if any name->code
    // candidate exists but does not match our audited position, retain
    // uncertainty instead of asserting a fabricated trade match.
    const nameOnly=!explicit&&!candidates?.size&&compared.has(label)?label:'';
    const resolved=explicit||mapped||nameOnly;
    if(!resolved){
      tradeActivity.unresolvedCodeLessRows++;
      if(candidates?.size>1)tradeActivity.ambiguousCodeLessRows++;
      continue;
    }
    if(!compared.has(resolved)){
      // The audited position is still keyed by this un-coded name, yet a
      // separate coded alias points elsewhere. Its trade identity is unknown
      // without the GAS master; do not silently classify it as unrelated.
      if(!explicit&&compared.has(label)){
        tradeActivity.unresolvedCodeLessRows++;
        tradeActivity.ambiguousCodeLessRows++;
      }
      continue;
    }
    if(mapped)tradeActivity.codeLessMappedRows++;
    if(nameOnly)tradeActivity.nameOnlyIdentityRows++;
    involved.add(resolved);
    tradeActivity.validPotentialRows++;
    const kind={buy:'buyRows',sell:'sellRows',split:'splitRows',
      reverse_split:'reverseSplitRows'}[type];
    tradeActivity[kind]++;
  }
  // Cross-check the change pattern and Jan 07 trade membership on the SAME
  // private identity. A match is only evidence of an applicable trade row;
  // it is not proof that the production lot/cost state changed.
  const cohorts={
    ledgerStableStoredChanged:0,ledgerChangedStoredChanged:0,
    ledgerStableStoredStable:0,ledgerChangedStoredStable:0,
    ledgerStableStoredChangedWithTradeEvidence:0,
    ledgerStableStoredChangedWithoutMatchedTradeEvidence:0,
    ledgerChangedStoredChangedWithTradeEvidence:0,
    ledgerChangedStoredChangedWithoutMatchedTradeEvidence:0,
    ledgerChangedStoredStableWithTradeEvidence:0,
    ledgerChangedStoredStableWithoutMatchedTradeEvidence:0,
    ledgerStableStoredStableWithTradeEvidence:0,
    ledgerStableStoredStableWithoutMatchedTradeEvidence:0
  };
  for(const [key,pattern] of comparisonPatternByKey){
    const classification=pattern.ledgerChanged
      ?(pattern.storedChanged?'ledgerChangedStoredChanged':'ledgerChangedStoredStable')
      :(pattern.storedChanged?'ledgerStableStoredChanged':'ledgerStableStoredStable');
    cohorts[classification]++;
    cohorts[classification+(involved.has(key)?'WithTradeEvidence':'WithoutMatchedTradeEvidence')]++;
  }
  guard(['ledgerStableStoredChanged','ledgerChangedStoredChanged',
    'ledgerStableStoredStable','ledgerChangedStoredStable']
    .reduce((total,k)=>total+cohorts[k],0)===counts.comparableCodes,
    'TRANSITION_COHORT_PARTITION');
  for(const label of ['ledgerStableStoredChanged','ledgerChangedStoredChanged',
    'ledgerStableStoredStable','ledgerChangedStoredStable'])
    guard(cohorts[label]===cohorts[label+'WithTradeEvidence']+
      cohorts[label+'WithoutMatchedTradeEvidence'],'TRANSITION_COHORT_DRIFT');
  for(const key of Object.keys(cohorts))cohorts[key]=bounded(cohorts[key]);
  for(const key of Object.keys(counts))counts[key]=bounded(counts[key]);
  for(const key of Object.keys(tradeActivity))
    tradeActivity[key]=bounded(tradeActivity[key]);
  return {mode:'ISSUE507_JAN07_TRANSITION_READ_ONLY',state:'ASSESSED',
    counts,cohorts,tradeActivity,matchingCodesWithTradesJan07:bounded(involved.size),
    comparableCodesWithNoMatchedTradeEvidence:bounded(compared.size-involved.size),
    ledgerTradeAbsenceCertified:false,masterNameCodeMappingVerified:false,
    historicalWriteRevisionVerified:false,independentPriceVerified:false,
    tradePresenceEstablishesCausality:false,
    restoreAllowed:false,deleteAllowed:false,writesPerformed:0,
    note:'Observed current-ledger-versus-stored boundary only. An unmatched trade is not proven absent; no historical ledger revision or independent valuation has been certified.'};
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
  const summary=summarizeThreeDays(first,before.gasVersion);
  // Trade-history read is private to the runner and never logged.
  const trades=await request(endpoint,token,'getTrades',{},fetchImpl);
  const persistent=analyzePersistentQtyCost(first,trades);
  // Read exactly two preceding trading days. Reuses GAS strict snapshot
  // source digest, which covers the full source, independent of date scope.
  const prior=await request(endpoint,token,'diagnoseSnapshotIntegrityRange',
    {dates:BASELINE_DATES.join(','),strictReadonly:'1'},fetchImpl);
  const priorSummary=comparePriorBaseline(first,prior);
  const jan07Transition=analyzeJan07Transition(first,prior,trades);
  const second=await request(endpoint,token,'diagnoseSnapshotIntegrityRange',args,fetchImpl);
  // Validate both actual responses; do not echo raw source digests.
  summarizeThreeDays(second);
  guard(first.strictSourceDigest===prior.strictSourceDigest
    &&first.strictSourceDigest===second.strictSourceDigest
    &&first.integritySourceRevision===prior.integritySourceRevision
    &&first.integritySourceRevision===second.integritySourceRevision,'SOURCE_CHANGED');
  const after=validateInventory(await request(endpoint,token,'getAutomationStatus',{},fetchImpl));
  guard(before.dates.join('|')===after.dates.join('|')
    &&before.cursor===after.cursor&&before.pendingFrom===after.pendingFrom
    &&before.gasVersion===after.gasVersion,'QUEUE_CHANGED');
  return {...summary,recurringQtyCostTriage:{...persistent,
      sourceDigestStableWithinCall:true},
    jan06Jan07Baseline:{...priorSummary,strictSourceDigestStableWithinCall:true},
    jan07Transition,
    sourceStableWithinThisRead:true,
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
  // Production reducer does not reject negative qty: preserve as potentially
  // mutating malformed ledger evidence rather than silently dropping it.
  const negative=structuredClone(split);
  negative.trades.push({date:'2026-01-10',code:'000003',name:'SYNTH',tradeType:'buy',qty:-1});
  const negativeResult=analyzePersistentQtyCost(qtyCostDrift,negative);
  assert.equal(negativeResult.privateLedgerTradeActivity.negativeQtyPotentialMutationRowsJan09Through17,1);
  assert.equal(negativeResult.privateLedgerTradeActivity.jan10Through17,3);
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

  const baseline={status:'ok',checkedDates:BASELINE_DATES,
    diagnostics:BASELINE_DATES.map(fixtureDay),
    strictSourceDigest:d,integritySourceRevision:'1'};
  const reconstructed=structuredClone(baseline);
  // Repeated mismatch on 01/06, but matching qty+cost on 01/07.
  reconstructed.diagnostics[0].storedRows[2][3]=2;
  reconstructed.diagnostics[0].storedRows[2][5]=20;
  const priorProbe=comparePriorBaseline(qtyCostDrift,reconstructed);
  assert.equal(priorProbe.recurringCodesCompared,1);
  assert.equal(priorProbe.days[0].mismatchedQtyCost,1);
  assert.equal(priorProbe.days[1].matchedQtyCost,1);
  assert.equal(priorProbe.earliestDivergenceDateProven,false);
  const incomplete=structuredClone(reconstructed);
  incomplete.diagnostics[0].sourceDataErrors=['PRIVATE_PRICE_SOURCE_INCOMPLETE'];
  const unverifiableBaseline=comparePriorBaseline(qtyCostDrift,incomplete);
  assert.equal(unverifiableBaseline.days[0].status,'SOURCE_UNVERIFIABLE');
  assert.equal(unverifiableBaseline.days[0].mismatchedQtyCost,null);
  assert.ok(!JSON.stringify(priorProbe).includes('000003'));
  assert.ok(!JSON.stringify(priorProbe).includes('SYNTH'));
  const wrongDates=structuredClone(reconstructed);
  wrongDates.checkedDates=['2026-01-06','2026-01-08'];
  assert.throws(()=>comparePriorBaseline(qtyCostDrift,wrongDates),/BASELINE_SCHEMA/);

  // Boundary regression: 01-06 match, 01-07 current expected changed after
  // a possible effective 01-07 buy, but the stored row remains at 01-06 basis.
  const transition=structuredClone(baseline);
  const b7=transition.diagnostics[1];
  b7.expectedRows[2][3]=4;b7.expectedRows[2][5]=40;
  const withJan07Trade=structuredClone(tradeFixture);
  withJan07Trade.trades.push({date:'2026-01-07',code:'000003',name:'SYNTH',
    tradeType:'buy',qty:1,price:10});
  const evidence=analyzeJan07Transition(qtyCostDrift,transition,withJan07Trade);
  assert.equal(evidence.counts.commonCodes,1);
  assert.equal(evidence.counts.comparableCodes,1);
  assert.equal(evidence.counts.matchedJan06,1);
  assert.equal(evidence.counts.mismatchedJan07,1);
  assert.equal(evidence.counts.expectedQtyChanged,1);
  assert.equal(evidence.counts.expectedCostChanged,1);
  assert.equal(evidence.counts.storedQtyChanged,0);
  assert.equal(evidence.counts.storedCostChanged,0);
  assert.equal(evidence.counts.jan07BothMismatch,1);
  assert.equal(evidence.counts.jan07StoredEqualsJan06Expected,1);
  assert.equal(evidence.tradeActivity.buyRows,1);
  assert.equal(evidence.matchingCodesWithTradesJan07,1);
  assert.equal(evidence.cohorts.ledgerChangedStoredStable,1);
  assert.equal(evidence.cohorts.ledgerChangedStoredStableWithTradeEvidence,1);
  assert.equal(evidence.cohorts.ledgerStableStoredChanged,0);
  assert.equal(evidence.ledgerTradeAbsenceCertified,false);
  assert.equal(evidence.restoreAllowed,false);
  assert.ok(!JSON.stringify(evidence).includes('000003'));
  assert.ok(!JSON.stringify(evidence).includes('SYNTH'));
  // Review regression: _applyHoldingTrade preserves exact name as the
  // identity when both expected holding and original trade lack a code.
  const nameOnlyThree=structuredClone(qtyCostDrift);
  const nameOnlyPrior=structuredClone(transition);
  for(const day of [...nameOnlyThree.diagnostics,...nameOnlyPrior.diagnostics]){
    day.expectedRows[2][1]='';
    day.expectedRows[2][2]='UNIQUE_NAME_ONLY';
    day.storedRows[2][1]='';
    day.storedRows[2][2]='UNIQUE_NAME_ONLY';
  }
  const nameOnlyLedger={status:'ok',trades:[
    {date:'2026-01-07',code:'',name:'UNIQUE_NAME_ONLY',tradeType:'buy',qty:1,price:10}
  ]};
  const nameOnlyProbe=analyzeJan07Transition(nameOnlyThree,nameOnlyPrior,nameOnlyLedger);
  assert.equal(nameOnlyProbe.counts.comparableCodes,1);
  assert.equal(nameOnlyProbe.matchingCodesWithTradesJan07,1);
  assert.equal(nameOnlyProbe.tradeActivity.validPotentialRows,1);
  assert.equal(nameOnlyProbe.tradeActivity.nameOnlyIdentityRows,1);
  assert.equal(nameOnlyProbe.tradeActivity.unresolvedCodeLessRows,0);
  assert.ok(!JSON.stringify(nameOnlyProbe).includes('UNIQUE_NAME_ONLY'));
  // Ambiguous name associated with a DIFFERENT explicitly coded instrument
  // must not override current expected name-only identity.
  const aliasCollision=structuredClone(nameOnlyLedger);
  aliasCollision.trades.push({date:'2026-01-01',code:'999999',
    name:'UNIQUE_NAME_ONLY',tradeType:'buy',qty:1,price:10});
  const collided=analyzeJan07Transition(nameOnlyThree,nameOnlyPrior,aliasCollision);
  assert.equal(collided.matchingCodesWithTradesJan07,0);
  assert.equal(collided.tradeActivity.nameOnlyIdentityRows,0);
  assert.equal(collided.tradeActivity.unresolvedCodeLessRows,1);
  assert.equal(collided.tradeActivity.ambiguousCodeLessRows,1);
  assert.equal(collided.comparableCodesWithNoMatchedTradeEvidence,1);
  assert.equal(collided.cohorts.ledgerChangedStoredStableWithoutMatchedTradeEvidence,1);
  assert.equal(collided.ledgerTradeAbsenceCertified,false);
  // On January 7 a stored-only mutation creates divergence without any
  // observed effective ledger trade: do not claim historical causality.
  const storeOnly=structuredClone(baseline);
  storeOnly.diagnostics[1].storedRows[2][3]=1;
  storeOnly.diagnostics[1].storedRows[2][5]=10;
  const noJan07Trade=analyzeJan07Transition(qtyCostDrift,storeOnly,tradeFixture);
  assert.equal(noJan07Trade.counts.expectedQtyChanged,0);
  assert.equal(noJan07Trade.counts.storedQtyChanged,1);
  assert.equal(noJan07Trade.matchingCodesWithTradesJan07,0);
  assert.equal(noJan07Trade.cohorts.ledgerStableStoredChanged,1);
  assert.equal(noJan07Trade.cohorts.ledgerStableStoredChangedWithoutMatchedTradeEvidence,1);
  assert.equal(noJan07Trade.cohorts.ledgerStableStoredChangedWithTradeEvidence,0);
  assert.equal(noJan07Trade.ledgerTradeAbsenceCertified,false);
  // A same-code ledger trade can coincide with stale-expected/stored-only
  // drift: record overlap without claiming the trade CAUSED the stored change.
  const storeOnlyWithTrade=analyzeJan07Transition(qtyCostDrift,storeOnly,withJan07Trade);
  assert.equal(storeOnlyWithTrade.cohorts.ledgerStableStoredChangedWithTradeEvidence,1);
  assert.equal(storeOnlyWithTrade.cohorts.ledgerStableStoredChangedWithoutMatchedTradeEvidence,0);
  const uncertainJan07=structuredClone(withJan07Trade);
  uncertainJan07.trades.push({date:'2026-01-07',code:'',name:'UNKNOWN_NAME',
    tradeType:'buy',qty:1});
  const uncertainTransition=analyzeJan07Transition(qtyCostDrift,transition,uncertainJan07);
  assert.equal(uncertainTransition.tradeActivity.unresolvedCodeLessRows,1);
  const invalidJan07=structuredClone(withJan07Trade);
  invalidJan07.trades.push({date:'2026-01-07',code:'000003',name:'SYNTH',
    tradeType:'dividend',qty:1});
  assert.equal(analyzeJan07Transition(qtyCostDrift,transition,invalidJan07)
    .tradeActivity.ignoredInvalidTypeOrNameRows,1);
  const incompleteTransition=analyzeJan07Transition(qtyCostDrift,incomplete,tradeFixture);
  assert.equal(incompleteTransition.state,'BASELINE_NOT_ASSESSABLE');
  assert.equal(incompleteTransition.possibleLedgerTradeRowsJan07,null);
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
      :action==='getAutomationStatus'?status:action==='getTrades'?tradeFixture:
        options.body.get('dates')===BASELINE_DATES.join(',')?baseline:data};
  };
  const live=await runReadonly({url:'https://script.google.com/macros/s/TEST/exec',
    token:'TEST_TOKEN',fetchImpl:stub});
  assert.equal(live.sourceStableWithinThisRead,true);
  assert.equal(live.queueStableWithinThisRead,true);
  assert.equal(live.gasVersionChecked,'9.244');
  for(const version of ['9.281','9.282']){
    const versioned={...status,gasVersion:version,
      automation:{...status.automation,gasVersion:version}};
    const upgraded=await runReadonly({
      url:'https://script.google.com/macros/s/TEST/exec',token:'TEST_TOKEN',
      fetchImpl:async(_url,options)=>({ok:true,json:async()=>options.body.get('accessToken')!=='TEST_TOKEN'
       ?{status:'error',message:'인증 실패'}
       :options.body.get('action')==='getAutomationStatus'?versioned
         :options.body.get('action')==='getTrades'?tradeFixture
           :options.body.get('dates')===BASELINE_DATES.join(',')?baseline:data})
    });
    assert.equal(upgraded.gasVersionChecked,version);
    assert.equal(upgraded.allowedToRestore,false);
    assert.equal(upgraded.allowedToDelete,false);
    assert.equal(upgraded.writesPerformed,0);
  }
  let statusReads=0;
  await assert.rejects(()=>runReadonly({
    url:'https://script.google.com/macros/s/TEST/exec',token:'TEST_TOKEN',
    fetchImpl:async(_url,options)=>({ok:true,json:async()=>options.body.get('accessToken')!=='TEST_TOKEN'
      ?{status:'error',message:'인증 실패'}
      :options.body.get('action')==='getAutomationStatus'
        ?{...status,gasVersion:++statusReads===1?'9.281':'9.282',
            automation:{...status.automation,gasVersion:statusReads===1?'9.281':'9.282'}}
        :options.body.get('action')==='getTrades'?tradeFixture
          :options.body.get('dates')===BASELINE_DATES.join(',')?baseline:data})
  }),/QUEUE_CHANGED/,'mid-audit GAS release changed: invalidate source certificate');
  assert.deepEqual(calls,['getAutomationStatus','getAutomationStatus',
    'diagnoseSnapshotIntegrityRange','getTrades','diagnoseSnapshotIntegrityRange',
    'diagnoseSnapshotIntegrityRange','getAutomationStatus']);
  const mutated=structuredClone(data);mutated.strictSourceDigest='b'.repeat(64);
  let countCalls=0;
  const changed=async(_url,options)=>{
    const action=options.body.get('action'),token=options.body.get('accessToken');
    const response=token!=='TEST_TOKEN'?{status:'error',message:'인증 실패'}
      :action==='getAutomationStatus'?status:action==='getTrades'?tradeFixture:
        options.body.get('dates')===BASELINE_DATES.join(',')?baseline:
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