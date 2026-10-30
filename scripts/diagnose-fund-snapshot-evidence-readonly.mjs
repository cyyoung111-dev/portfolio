// Bounded, read-only representative-row evidence for one known fund/date.
// Output only enums and booleans; never output raw account, holdings, amounts or API bodies.
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
export const TARGET_DATE='2026-10-30', TARGET_CODE='F00001';
const SOURCE=/^(?:FUND_NAV|FUND_NAV_CARRY|FUND_NAV_CARRY_INPUT_REQUIRED|MANUAL)(?:@\d{4}-\d{2}-\d{2})?$/;

export function summarizeEvidence(history,prices,date=TARGET_DATE,code=TARGET_CODE){
 if(history?.status!=='ok'||history.date!==date||!Array.isArray(history.items)||history.items.length>1000
    ||prices?.status!=='ok'||!prices.prices||typeof prices.prices!=='object'
    ||Array.isArray(prices.prices))throw Error('FUND_SNAPSHOT_BAD_RESPONSE');
 const matches=history.items.filter(i=>i?.code===code);
 if(matches.length>1)throw Error('FUND_SNAPSHOT_AMBIGUOUS_ROWS');
 const fundPrices=prices.prices[code]||[];
 if(!Array.isArray(fundPrices)||fundPrices.length>5)throw Error('FUND_SNAPSHOT_BAD_RESPONSE');
 const exact=fundPrices.filter(r=>r?.date===date);
 if(exact.length>1)throw Error('FUND_SNAPSHOT_AMBIGUOUS_ROWS');
 const h=matches[0],p=exact[0];
 const result={code,date,snapshotRepresentativePresent:!!h,priceRepresentativePresent:!!p,
    amountMatches:null,sourceTextMatches:null,classification:''};
 if(!p){result.classification='PRICE_REPRESENTATIVE_ABSENT';return result;}
 if(!h){result.classification='SNAPSHOT_REPRESENTATIVE_ABSENT';return result;}
 if(!Number.isFinite(h.evalAmt)||!Number.isFinite(p.price)||h.evalAmt<=0||p.price<=0
    ||typeof h.source!=='string'||typeof p.source!=='string'
    ||!SOURCE.test(h.source.toUpperCase())||!SOURCE.test(p.source.toUpperCase()))
    throw Error('FUND_SNAPSHOT_BAD_RESPONSE');
 result.amountMatches=h.evalAmt===p.price;
 result.sourceTextMatches=h.source.toUpperCase()===p.source.toUpperCase();
 result.classification=!result.amountMatches
    ?'REPRESENTATIVE_AMOUNT_DIFFERENT'
    :!result.sourceTextMatches
      ?'REPRESENTATIVE_SOURCE_TEXT_DIFFERENT'
      :'REPRESENTATIVES_MATCH_CHECK_FULL_GAS_PROVENANCE';
 return result;
}

// Compare exact-date stored Snapshot to GAS's own trade/price/NAV recomputation.
// This API may contain sensitive rows, so emit ONLY selected enums/counts/booleans.
export function summarizeFullIntegrity(payload,date=TARGET_DATE,code=TARGET_CODE) {
 const d=payload?.diagnostic;
 const allowed=new Set(['VALID','MISMATCH','PARTIAL','CONFLICT','NO_SNAPSHOT','SOURCE_INCOMPLETE','PRICE_SUSPICIOUS']);
 const groups=['expectedCodes','storedCodes','missingCodes','unexpectedCodes','evalAmtMismatches',
  'sourceMismatches','qtyMismatches','costAmtMismatches','evalUnitMismatches','priceIntegrity','duplicateKeys','conflictKeys',
  'sourceDataErrors'];
 if(payload?.status!=='ok'||!d||d.date!==date||!allowed.has(d.status)
   ||!Number.isSafeInteger(d.expectedRowCount)||!Number.isSafeInteger(d.storedRowCount)
   ||d.expectedRowCount<0||d.storedRowCount<0||d.expectedRowCount>100000||d.storedRowCount>100000
   ||groups.some(k=>!Array.isArray(d[k])||d[k].length>100000))throw Error('FUND_SNAPSHOT_BAD_INTEGRITY');
 const codeIn=k=>d[k].some(x=>x===code||x?.code===code);
 const targetPrices=d.priceIntegrity.filter(x=>x?.code===code);
 if(targetPrices.length>1)throw Error('FUND_SNAPSHOT_BAD_INTEGRITY');
 const rawPriceState=targetPrices[0]?.status;
 const fundPriceState=targetPrices.length===0?'NOT_REPORTED'
   :rawPriceState==='VALID'?'VALID'
   :rawPriceState==='MANUAL_PROTECTED'?'MANUAL_PROTECTED':'REVIEW_REQUIRED';
 return {date,code,integrityStatus:d.status,
  expectedRows:d.expectedRowCount,storedRows:d.storedRowCount,
  fundExpectedPresent:codeIn('expectedCodes'),fundStoredPresent:codeIn('storedCodes'),
  fundMissing:codeIn('missingCodes'),fundUnexpected:codeIn('unexpectedCodes'),
  fundAmountMismatch:codeIn('evalAmtMismatches'),fundSourceMismatch:codeIn('sourceMismatches'),
  fundQtyMismatch:codeIn('qtyMismatches'),fundCostMismatch:codeIn('costAmtMismatches'),
  fundPriceIntegrityState:fundPriceState,sourceDataErrorPresent:d.sourceDataErrors.length>0,
  unresolvedDuplicatesOrConflicts:d.duplicateKeys.length>0||d.conflictKeys.length>0};
}


// Analysis only. NEVER an authorization to repair or an input to any write path.
// Reuse the full raw GAS integrity response in memory, but emit no account rows.
export function classifySingleFundRepairReview(payload,date=TARGET_DATE,code=TARGET_CODE){
 const summary=summarizeFullIntegrity(payload,date,code);
 const d=payload.diagnostic;
 const isTargetOnly=key=>d[key].length===1 && d[key][0]?.code===code;
 const blocking=['missingCodes','unexpectedCodes','qtyMismatches','costAmtMismatches',
  'evalUnitMismatches','duplicateKeys','conflictKeys'];
 const noOtherDifferences=blocking.every(key=>d[key].length===0)
  && isTargetOnly('evalAmtMismatches') && isTargetOnly('sourceMismatches');
 const targetPrices=d.priceIntegrity.filter(row=>row?.code===code);
 const expectedPresent=summary.fundExpectedPresent && summary.fundStoredPresent;
 const lengthsAgree=d.expectedRowCount>0 && d.expectedRowCount===d.storedRowCount;
 // RAW rows are necessary to reject a stale/compressed or partial diagnosis.
 const rowsComplete=Array.isArray(d.expectedRows)&&Array.isArray(d.storedRows)
  && d.expectedRows.length===d.expectedRowCount && d.storedRows.length===d.storedRowCount
  && d.expectedRows.filter(row=>Array.isArray(row)&&row[1]===code).length===1
  && d.storedRows.filter(row=>Array.isArray(row)&&row[1]===code).length===1;
 const noOtherPriceWarnings=d.priceIntegrity.every(row=>
  row && (row.status==='VALID'||row.status==='MANUAL_PROTECTED'));
 // Only hard-coded category names leave the process; never log values, codes, rows or errors.
 const blockers=[];
 const blockedCategory={missingCodes:'MISSING_ROW',unexpectedCodes:'UNEXPECTED_ROW',
  qtyMismatches:'QUANTITY_MISMATCH',costAmtMismatches:'COST_MISMATCH',
  evalUnitMismatches:'EVALUATION_UNIT_MISMATCH',duplicateKeys:'DUPLICATE_ROW',
  conflictKeys:'CONFLICT_ROW'};
 for(const [key,label] of Object.entries(blockedCategory))
  if(d[key].length)blockers.push(label);
 if(!isTargetOnly('evalAmtMismatches'))blockers.push('EVALUATION_AMOUNT_SCOPE');
 if(!isTargetOnly('sourceMismatches'))blockers.push('SOURCE_SCOPE');
 if(!expectedPresent)blockers.push('FUND_ROW_ABSENT');
 if(!lengthsAgree)blockers.push('ROW_COUNT_MISMATCH');
 if(!rowsComplete)blockers.push('RAW_ROW_EVIDENCE_INCOMPLETE');
 if(targetPrices.length!==1||targetPrices[0].status!=='VALID')blockers.push('TARGET_PRICE_UNVERIFIED');
 if(!noOtherPriceWarnings)blockers.push('OTHER_PRICE_WARNINGS');
 if(d.sourceDataErrors.length)blockers.push('SOURCE_DATA_ERRORS');
 if(d.status!=='MISMATCH')blockers.push('INTEGRITY_STATUS_NOT_MISMATCH');
 const candidate=d.status==='MISMATCH'&&expectedPresent&&lengthsAgree&&rowsComplete
  &&noOtherDifferences &&targetPrices.length===1&&targetPrices[0].status==='VALID'
  &&noOtherPriceWarnings &&d.sourceDataErrors.length===0;
 return {
  date,code,candidate,
  classification:candidate?'SINGLE_FUND_SNAPSHOT_REPAIR_REVIEW_CANDIDATE':'REPAIR_PREFLIGHT_BLOCKED',
  scope:'F00001_2026_10_30_ONLY',
  requiresBackup:true,requiresWriterExclusion:true,requiresExplicitApproval:true,
  writeAuthorized:false,mutationPerformed:false,
  noOtherDifferences,rowsComplete,otherPriceWarnings:!noOtherPriceWarnings,
  blockers
 };
}


// Reveal only date-scoped NAV publication states. A missing Friday entry is
// NOT automatically a processing error; issuer publication timing must be checked.
export function summarizeExactFundDay(payload,code,date=TARGET_DATE){
 const item=payload?.fundResults?.[code];
 const rows=item?.dates;
 const NAV=new Set(['EXISTING_CONFIRMED','NON_PUBLICATION_CARRY','UNPUBLISHED','NAV_MISSING']);
 const STATE=new Set(['EXISTING_VALID','NOT_REQUIRED','WRITE_REQUIRED','NOT_CREATED']);
 if(!['F00001','F00002'].includes(code)||payload?.status!=='ok'||item?.code!==code
    ||!Array.isArray(rows)||rows.length>1)throw Error('FUND_SNAPSHOT_BAD_FUND_STATUS');
 if(rows.length===0)return {code,date,active:false,navState:'NO_ACTIVE_POSITION',
    publicationExpected:null,evaluationState:'NOT_REQUIRED',snapshotState:'NOT_REQUIRED'};
 const row=rows[0];
 if(row.code!==code||row.date!==date||!NAV.has(row.navState)||!STATE.has(row.evaluationState)
    ||!STATE.has(row.snapshotState)||typeof row.publicationExpected!=='boolean'
    ||row.reconciled!==true)throw Error('FUND_SNAPSHOT_BAD_FUND_STATUS');
 return {code,date,active:true,navState:row.navState,
  publicationExpected:row.publicationExpected,evaluationState:row.evaluationState,
  snapshotState:row.snapshotState};
}

// Classify WHY an exact-date repair remains blocked without leaking other
// portfolio codes, monetary amounts, original sources, units or row contents.
export function summarizeMismatchScope(payload,date=TARGET_DATE,code=TARGET_CODE){
 const d=payload?.diagnostic;
 summarizeFullIntegrity(payload,date,code);
 const categorize=key=>{
  const rows=d[key];
  const target=rows.some(row=>row?.code===code);
  const other=rows.some(row=>typeof row?.code==='string'&&row.code!==code);
  if(rows.some(row=>!row||typeof row.code!=='string'||!row.code))throw Error('FUND_SNAPSHOT_BAD_INTEGRITY');
  return target&&other?'TARGET_AND_OTHER':target?'TARGET_ONLY':other?'OTHER_ONLY':'NONE';
 };
 return {unitMismatchScope:categorize('evalUnitMismatches'),
  sourceMismatchScope:categorize('sourceMismatches'),
  evaluationAmountMismatchScope:categorize('evalAmtMismatches')};
}


// Read-only semantic split of Snapshot source mismatches. The approved GAS
// writer is NOT called. Never reveal source strings, instruments or amounts.
export function summarizeSourceMismatchKinds(payload,date=TARGET_DATE,code=TARGET_CODE){
 summarizeFullIntegrity(payload,date,code);
 const d=payload.diagnostic;
 const rows=d.sourceMismatches;
 const fundStates=Array.isArray(d.fundNavStates)?d.fundNavStates:[];
 const safeDate=/^\d{4}-\d{2}-\d{2}$/;
 const kind=s=>{
  if(typeof s!=='string')throw Error('FUND_SNAPSHOT_BAD_INTEGRITY');
  if(s==='FUND_NAV')return 'CONFIRMED_NAV';
  if(/^FUND_NAV_CARRY(?:_INPUT_REQUIRED)?(?:@\d{4}-\d{2}-\d{2})?$/.test(s))return 'CARRY_NAV';
  if(s==='MANUAL')return 'MANUAL';
  if(s==='')return 'UNLABELED';
  return 'OTHER_PROVIDER';
 };
 const isCarryLabelAlias=row=>{
  if(!/^F\d{5}$/.test(row.code))return false;
  const state=fundStates.filter(x=>x?.code===row.code);
  if(state.length!==1||!safeDate.test(String(state[0].sourceDate||'')))return false;
  const dateSuffix='@'+state[0].sourceDate;
  const a=row.expected,b=row.stored;
  // Only same NAV family & identical proven NAV source date: suffix-only
  // differences may be semantically equivalent, not proof of full integrity.
  return (a==='FUND_NAV_CARRY'+dateSuffix&&b==='FUND_NAV_CARRY')
   ||(b==='FUND_NAV_CARRY'+dateSuffix&&a==='FUND_NAV_CARRY')
   ||(a==='FUND_NAV_CARRY_INPUT_REQUIRED'+dateSuffix&&
     (b==='FUND_NAV_CARRY_INPUT_REQUIRED'||b==='FUND_NAV_CARRY'+dateSuffix));
 };
 let target=null,otherMismatchCount=0,otherFundCount=0,otherNonFundCount=0,
  otherCarryAliasReviewCount=0,otherNonAliasCount=0;
 for(const row of rows){
  if(!row||typeof row.code!=='string'||!row.code
    ||typeof row.expected!=='string'||typeof row.stored!=='string'
    ||row.expected===row.stored)throw Error('FUND_SNAPSHOT_BAD_INTEGRITY');
  if(row.code===code){
   if(target)throw Error('FUND_SNAPSHOT_BAD_INTEGRITY');
   target={expectedSourceKind:kind(row.expected),storedSourceKind:kind(row.stored),
     carryAliasReview:isCarryLabelAlias(row)};
  }else{
   otherMismatchCount++;
   if(/^F\d{5}$/.test(row.code))otherFundCount++;else otherNonFundCount++;
   if(isCarryLabelAlias(row))otherCarryAliasReviewCount++;else otherNonAliasCount++;
  }
 }
 return {targetSourceKinds:target??{expectedSourceKind:'NO_MISMATCH',
   storedSourceKind:'NO_MISMATCH',carryAliasReview:false},
  otherMismatchCount,otherFundCount,otherNonFundCount,
  otherCarryAliasReviewCount,otherNonAliasCount,
  allOtherSourceDifferencesCarryAliases:otherMismatchCount>0&&otherNonAliasCount===0,
  writeAuthorized:false};
}


// Exact, explicitly configured fund IDs only. Check source-family transitions
// without leaking NAV value, date, units, holdings, or arbitrary asset codes.
// Do NOT treat semantic similarity as a write authorization.
export function summarizeKnownFundSourcePairs(payload,date=TARGET_DATE) {
 summarizeFullIntegrity(payload,date,TARGET_CODE);
 const d=payload.diagnostic;
 const funds=['F00002','F00003'];
 const states=Array.isArray(d.fundNavStates)?d.fundNavStates:[];
 const kind=source=>{
  if(typeof source!=='string')throw Error('FUND_SNAPSHOT_BAD_INTEGRITY');
  if(source==='FUND_NAV')return 'CONFIRMED_NAV';
  if(/^FUND_NAV_CARRY(?:@\d{4}-\d{2}-\d{2})?$/.test(source))return 'CARRY_NAV';
  if(/^FUND_NAV_CARRY_INPUT_REQUIRED(?:@\d{4}-\d{2}-\d{2})?$/.test(source))return 'CARRY_INPUT_REQUIRED';
  if(source==='MANUAL')return 'MANUAL';
  if(source==='')return 'UNLABELED';
  return 'OTHER_PROVIDER';
 };
 const output={};
 for(const code of funds){
  const rows=d.sourceMismatches.filter(row=>row?.code===code);
  const navStates=states.filter(row=>row?.code===code);
  if(rows.length>1||navStates.length>1)throw Error('FUND_SNAPSHOT_BAD_INTEGRITY');
  if(!rows.length){output[code]={mismatch:false};continue;}
  const row=rows[0];
  if(typeof row.expected!=='string'||typeof row.stored!=='string'
    ||row.expected===row.stored)throw Error('FUND_SNAPSHOT_BAD_INTEGRITY');
  const state=navStates[0];
  const sourceDate=typeof state?.sourceDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(state.sourceDate)?
    state.sourceDate:null;
  const expectedKind=kind(row.expected),storedKind=kind(row.stored);
  const datedCarryMatches=source=>{
   if(!sourceDate)return null;
   const suffix=source.match(/^FUND_NAV_CARRY(?:_INPUT_REQUIRED)?@(\d{4}-\d{2}-\d{2})$/);
   return suffix?suffix[1]===sourceDate:null;
  };
  output[code]={
   mismatch:true,expectedKind,storedKind,
   expectedCarryDateMatchesNav:datedCarryMatches(row.expected),
   storedCarryDateMatchesNav:datedCarryMatches(row.stored),
   bothCarryFamilies:['CARRY_NAV','CARRY_INPUT_REQUIRED'].includes(expectedKind)
     &&['CARRY_NAV','CARRY_INPUT_REQUIRED'].includes(storedKind),
   confirmedNavExpected:expectedKind==='CONFIRMED_NAV',
   writeAuthorized:false
  };
 }
 return {knownFundSourcePairs:output};
}


// A narrower *review* gate, NOT a repair authorization. The GAS integrity
// still reports MISMATCH and the original single-fund gate remains blocked.
// F00002 may legitimately require a new NAV; preserve its explicit warning.
// Fail closed on any extra row, amount, unit, provenance or price discrepancy.
export function classifyF00001ScopedReview(integrity,hanwhaStatus,kbStatus){
 const old=classifySingleFundRepairReview(integrity);
 const d=integrity.diagnostic;
 const h=summarizeExactFundDay(hanwhaStatus,'F00001');
 const k=summarizeExactFundDay(kbStatus,'F00002');
 const pairs=summarizeKnownFundSourcePairs(integrity).knownFundSourcePairs;
 const kinds=summarizeSourceMismatchKinds(integrity);
 const exact=(group,codes)=>d[group].length===codes.length&&
  codes.every(code=>d[group].filter(row=>row?.code===code).length===1);
 const allCodes=d.expectedCodes.length===d.storedCodes.length
  &&d.expectedCodes.every(code=>d.storedCodes.includes(code));
 const noOtherChanges=['missingCodes','unexpectedCodes','qtyMismatches',
  'costAmtMismatches','duplicateKeys','conflictKeys','sourceDataErrors']
  .every(group=>d[group].length===0);
 const codeCount=(rows,code)=>Array.isArray(rows)?
  rows.filter(row=>Array.isArray(row)&&row[1]===code).length:0;
 const rowProof=old.rowsComplete&&d.expectedRowCount===d.storedRowCount
  &&d.expectedRowCount>0&&allCodes
  &&['F00001','F00002'].every(code=>
   codeCount(d.expectedRows,code)===1&&codeCount(d.storedRows,code)===1);
 const statusProof=d.status==='MISMATCH'
  &&h.active&&h.navState==='EXISTING_CONFIRMED'&&h.publicationExpected
  &&h.evaluationState==='EXISTING_VALID'&&h.snapshotState==='WRITE_REQUIRED'
  &&k.active&&k.navState==='NAV_MISSING'&&k.publicationExpected
  &&k.evaluationState==='EXISTING_VALID'&&k.snapshotState==='EXISTING_VALID';
 const exactDiffs=exact('evalUnitMismatches',['F00001'])
  &&exact('evalAmtMismatches',['F00001'])
  &&exact('sourceMismatches',['F00001','F00002'])
  &&kinds.targetSourceKinds.expectedSourceKind==='CONFIRMED_NAV'
  &&kinds.targetSourceKinds.storedSourceKind==='CARRY_NAV'
  &&kinds.otherMismatchCount===1&&kinds.otherFundCount===1
  &&kinds.otherNonFundCount===0;
 const kbWarningPreserved=pairs.F00002?.mismatch===true
  &&pairs.F00002.expectedKind==='CARRY_NAV'
  &&pairs.F00002.storedKind==='CARRY_INPUT_REQUIRED'
  &&pairs.F00002.expectedCarryDateMatchesNav===true
  &&pairs.F00002.bothCarryFamilies===true
  &&pairs.F00002.confirmedNavExpected===false
  &&pairs.F00003?.mismatch===false;
 const allPricesVerified=Array.isArray(d.priceIntegrity)
  &&d.priceIntegrity.some(row=>row?.code==='F00001'&&row.status==='VALID')
  &&d.priceIntegrity.every(row=>row?.status==='VALID');
 const flags={rowProof,statusProof,exactDiffs,kbWarningPreserved,
  allPricesVerified,noOtherChanges,originalSingleFundGateBlocked:old.candidate===false};
 const blockers=Object.entries(flags).filter(([,passed])=>!passed)
  .map(([name])=>({
   rowProof:'ROW_PROOF',statusProof:'FUND_DAY_STATE',
   exactDiffs:'DIFFERENCE_SCOPE',kbWarningPreserved:'KB_MISSING_NAV_WARNING',
   allPricesVerified:'PRICE_INTEGRITY',noOtherChanges:'OTHER_MISMATCHES',
   originalSingleFundGateBlocked:'ORIGINAL_GATE'
  })[name]);
 const reviewOnlyCandidate=blockers.length===0;
 return {date:TARGET_DATE,reviewOnlyCandidate,
  classification:reviewOnlyCandidate?'F00001_SCOPED_REPAIR_REVIEW_ONLY':'F00001_SCOPED_REVIEW_BLOCKED',
  blockers,retainF00002MissingNavWarning:true,
  targetScope:'F00001_ONE_EXISTING_ROW_ONLY',
  requiresFreshFullRecheck:true,requiresBackup:true,
  requiresWriterExclusion:true,requiresExplicitApproval:true,
  existingSingleFundGateBlocked:old.candidate===false,
  writeAuthorized:false,mutationPerformed:false};
}

export async function diagnoseSnapshot({url,token,fetchImpl=fetch,emit=()=>{}}){
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||!token.trim())throw Error('FUND_SNAPSHOT_TOKEN_MISSING');
 async function read(action,args){
  let r,payload;
  try{
   r=await fetchImpl(endpoint,{method:'POST',redirect:'follow',
    headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
    body:new URLSearchParams({action,...args,accessToken:token}),
    signal:AbortSignal.timeout(180000)});
  }catch{throw Error('FUND_SNAPSHOT_NETWORK_UNVERIFIED');}
  if(!r?.ok)throw Error('FUND_SNAPSHOT_HTTP_UNVERIFIED');
  try{payload=await r.json();}catch{throw Error('FUND_SNAPSHOT_JSON_UNVERIFIED');}
  return payload;
 }
 const history=await read('getHistoryDetail',{date:TARGET_DATE});
 const prices=await read('getPriceHistory',{from:TARGET_DATE,to:TARGET_DATE,codes:TARGET_CODE});
 const result=summarizeEvidence(history,prices);
 const integrity=await read('diagnoseSnapshotIntegrity',{date:TARGET_DATE});
 const hanwha=await read('getFundValuationStatus',{from:TARGET_DATE,to:TARGET_DATE,code:'F00001'});
 const kb=await read('getFundValuationStatus',{from:TARGET_DATE,to:TARGET_DATE,code:'F00002'});
 const complete={...result,...summarizeFullIntegrity(integrity),...classifySingleFundRepairReview(integrity),
  ...summarizeMismatchScope(integrity),...summarizeSourceMismatchKinds(integrity),...summarizeKnownFundSourcePairs(integrity),
  scopedRepairReview:classifyF00001ScopedReview(integrity,hanwha,kb),fundDayStates:[
    summarizeExactFundDay(hanwha,'F00001'),summarizeExactFundDay(kb,'F00002')]};
 emit(complete);
 return complete;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await diagnoseSnapshot({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,
   emit:v=>console.log(JSON.stringify(v))});}
 catch(e){const code=String(e?.message||'');
  console.error(/^FUND_SNAPSHOT_[A-Z_]+$/.test(code)?code:'FUND_SNAPSHOT_UNKNOWN');
  process.exitCode=1;
 }
}
