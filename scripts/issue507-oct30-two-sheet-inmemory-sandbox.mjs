// Source-only two-sheet *in-memory* transaction sandbox for Issue #507.
// NEVER import into GAS, browser/API handlers or production writers.
// It cannot acquire an actual lock, approve an operator, or mutate a sheet.
import {createHash} from 'node:crypto';
import {verifyIssue507Oct30PostState,DAY}
  from './issue507-oct30-postwrite-reconciliation.mjs';

const COPY=x=>structuredClone(x);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ALLOWED=new Set(['NONE','BACKUP_FAIL','EXTERNAL_BEFORE_WRITE',
 'PRICE_PARTIAL','PRICE_UNKNOWN','PRICE_DONE','SNAPSHOT_PARTIAL',
 'SNAPSHOT_DONE','READBACK_CORRUPT','ROLLBACK_FAILURE']);
const fail=reason=>{throw Error('ISSUE507_SANDBOX_'+reason);};
const goodRows=(rows,width,dateOnly)=>{
 if(!Array.isArray(rows)||rows.some(row=>
   !Array.isArray(row)||row.length!==width||
   (dateOnly&&row[0]!==DAY)))fail('INPUT_SHAPE');
};
const externalOnly=(rows)=>rows.filter(x=>x[0]!==DAY);

export function runOct30TwoSheetInMemorySandbox({
 date=DAY,beforeSnapshot,beforeHistory,plan,otherSnapshot=[],
 otherHistory=[],fault='NONE'
}={}){
 if(date!==DAY||!ALLOWED.has(fault)
   ||plan?.summary?.mode!=='ISSUE507_OCT30_SCOPED_VALUATION_PLAN'
   ||plan?.summary?.safeToApply!==false)fail('NOT_AUTHORIZED_INPUT');
 goodRows(beforeSnapshot,12,true);goodRows(beforeHistory,6,true);
 goodRows(otherSnapshot,12,false);goodRows(otherHistory,6,false);
 if(otherSnapshot.some(x=>x[0]===DAY)||otherHistory.some(x=>x[0]===DAY))
   fail('OTHER_DATE_CONFLICT');
 if(!Array.isArray(plan?.privatePlan?.domestic)
   ||plan.privatePlan.domestic.length!==37
   ||!Array.isArray(plan?.privatePlan?.priceHistoryInserts)
   ||plan.privatePlan.priceHistoryInserts.length!==37)
   fail('PLAN_SHAPE');
 // Isolate everything. No caller's arrays or live sheet adapters are accepted.
 const before={snapshot:COPY([...beforeSnapshot,...otherSnapshot]),
   history:COPY([...beforeHistory,...otherHistory])};
 const state=COPY(before);
 const preDigest={snapshot:digest(before.snapshot),history:digest(before.history)};
 const desiredSnapshot=COPY(beforeSnapshot);
 const seen=new Set();
 for(const change of plan.privatePlan.domestic){
   const i=change?.rowIndex;
   if(!Number.isSafeInteger(i)||i<0||i>=39||seen.has(i))
     fail('PATCH_INDEX');
   if(!same(desiredSnapshot[i],change.before))fail('CAS_ORIGINAL_CHANGED');
   desiredSnapshot[i]=COPY(change.after);
   seen.add(i);
 }
 const desiredHistory=COPY([...beforeHistory,...plan.privatePlan.priceHistoryInserts]);
 // This real independent oracle verifies exact-day code/qty/cost/NAV/value
 // constraints BEFORE any simulated mutation can begin.
 verifyIssue507Oct30PostState({date,
   beforeSnapshot:COPY(beforeSnapshot),afterSnapshot:COPY(desiredSnapshot),
   beforeHistory:COPY(beforeHistory),afterHistory:COPY(desiredHistory),
   plan:COPY(plan)});
 const failResult=(status,restored,why)=>({
   mode:'ISSUE507_OCT30_IN_MEMORY_TRANSACTION_SANDBOX',date,
   status,faultScenario:why,
   simulatedRowsChanged:0,restoredBothSheetsInSandbox:restored,
   pendingCompletionMarkerAllowed:false,automaticRetryAllowed:false,
   physicalBackupsVerified:false,realWriterGateVerified:false,
   realFinancialWrites:0,gasDeployed:false,safeToFinalize:false,
   individualPricesOrCodesExposed:false
 });
 // BEFORE first mutation: verify exact full-sheet images for both backups.
 const backup=COPY(state);
 const backupVerified=preDigest.snapshot===digest(backup.snapshot)
   &&preDigest.history===digest(backup.history);
 if(!backupVerified)fail('BACKUP_NOT_IDENTICAL');
 if(fault==='BACKUP_FAIL')
   return {summary:failResult('SIMULATED_ABORTED_UNCHANGED',true,'BACKUP_FAIL'),
     privateSandboxState:COPY(state)};
 let mutations=0;
 try{
   // A concurrent Sheets API writer is not protected by GAS ScriptLock.
   // Never rollback an EXTERNAL modification onto an old backup.
   if(fault==='EXTERNAL_BEFORE_WRITE'){
     if(state.snapshot.length===beforeSnapshot.length)fail('EXTERNAL_TEST_NO_ROW');
     state.snapshot[beforeSnapshot.length][2]='SYNTHETIC_EXTERNAL_WRITE';
     throw Error('SIMULATED_EXTERNAL_CONFLICT');
   }
   if(digest(state.snapshot)!==preDigest.snapshot ||
      digest(state.history)!==preDigest.history)
     fail('CAS_BEFORE_WRITE');
   for(let i=0;i<plan.privatePlan.priceHistoryInserts.length;i++){
     state.history.splice(beforeHistory.length+i,0,
       COPY(plan.privatePlan.priceHistoryInserts[i]));
     mutations++;
     if(i===4&&fault==='PRICE_PARTIAL')throw Error('SIMULATED_PARTIAL_PRICE');
     if(i===0&&fault==='PRICE_UNKNOWN')throw Error('SIMULATED_LOST_ACK');
   }
   if(fault==='PRICE_DONE')throw Error('SIMULATED_PRICE_COMPLETE_NO_SNAPSHOT');
   if(!same(state.snapshot,before.snapshot))fail('CAS_BEFORE_SNAPSHOT');
   for(let i=0;i<plan.privatePlan.domestic.length;i++){
     const patch=plan.privatePlan.domestic[i];
     if(!same(state.snapshot[patch.rowIndex],patch.before))
       fail('CAS_ORIGINAL_CHANGED');
     state.snapshot[patch.rowIndex]=COPY(patch.after);
     mutations++;
     if(i===7&&fault==='SNAPSHOT_PARTIAL')throw Error('SIMULATED_PARTIAL_SNAPSHOT');
   }
   if(fault==='SNAPSHOT_DONE')throw Error('SIMULATED_NO_READBACK');
   if(fault==='READBACK_CORRUPT')
     state.snapshot[37][7]=Number(state.snapshot[37][7])+1;
   const verified=verifyIssue507Oct30PostState({date,
     beforeSnapshot:COPY(beforeSnapshot),
     afterSnapshot:COPY(state.snapshot.filter(row=>row[0]===DAY)),
     beforeHistory:COPY(beforeHistory),
     afterHistory:COPY(state.history.filter(row=>row[0]===DAY)),
     plan:COPY(plan)});
   if(verified.safeToFinalize!==false)fail('ORACLE_UNEXPECTED_APPROVAL');
   if(!same(externalOnly(state.snapshot),externalOnly(before.snapshot))||
      !same(externalOnly(state.history),externalOnly(before.history)))
     fail('NON_TARGET_DATE_CHANGED');
   return {summary:{
     mode:'ISSUE507_OCT30_IN_MEMORY_TRANSACTION_SANDBOX',
     date,status:'SIMULATED_READBACK_MATCH',
     simulatedRowsChanged:mutations,restoredBothSheetsInSandbox:false,
     pendingCompletionMarkerAllowed:false,automaticRetryAllowed:false,
     physicalBackupsVerified:false,realWriterGateVerified:false,
     realFinancialWrites:0,gasDeployed:false,safeToFinalize:false,
     individualPricesOrCodesExposed:false
   },privateSandboxState:COPY(state)};
 }catch(error){
   if(String(error?.message||'')==='SIMULATED_EXTERNAL_CONFLICT'){
     return {summary:failResult('SIMULATED_EXTERNAL_CONFLICT_UNRESOLVED',
       false,'EXTERNAL_BEFORE_WRITE'),privateSandboxState:COPY(state)};
   }
   // In a *real* two-sheet failure each backup needs verified restore under
   // an independent ownership gate. Here only isolated arrays are restored.
   state.history=COPY(backup.history);
   if(fault!=='ROLLBACK_FAILURE')state.snapshot=COPY(backup.snapshot);
   else state.snapshot[0][7]+=1; // synthetic restoration failure marker
   const clean=digest(state.snapshot)===preDigest.snapshot
     &&digest(state.history)===preDigest.history;
   return {summary:failResult(clean?'SIMULATED_ROLLBACK_VERIFIED':
     'SIMULATED_ROLLBACK_UNVERIFIED',clean,fault),
     privateSandboxState:COPY(state)};
 }
}
