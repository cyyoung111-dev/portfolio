// #734: target-date derived valuation recovery only. This never reimports NAV
// or replays a complete portfolio close, trades, prices, or dividends.
// Read-only by default; explicit manual approval is required for ONE fund.
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {verifyGas9298ReleaseReadOnly} from './gas9298-release-readonly.mjs';
import {runBackfillStatus} from './diagnose-backfill-status.mjs';

export const TARGET_DATE='2026-11-19';
const FUNDS=Object.freeze({F00001:'collectHanwhaFundNav',F00002:'collectKbFundNav'});
const STATES=new Set(['EXISTING_VALID','NOT_REQUIRED','WRITE_REQUIRED','NOT_CREATED']);
const fail=reason=>{throw Error('ISSUE734_NOV19_'+reason);};

export function assessNov19DerivedRecovery({integrity,status,row,code}={}){
 if(!Object.hasOwn(FUNDS,code))fail('FUND_SCOPE_INVALID');
 if(integrity?.status!=='VERIFIED'||integrity.version!=='9.304'
    ||integrity.tradeRows!==338||integrity.tradeV2HashVerified!==true
    ||integrity.writerGateMode!=='OPEN'||integrity.activeCount!==0
    ||integrity.pendingCount!==0||integrity.tradeSnapshotDeferredCount!==0
    ||integrity.financeWrites!==0)fail('LEDGER_OR_IDLE_UNVERIFIED');
 const close=status?.close;
 if(status?.gasVersion!=='9.304'||status.triggerReady!==true
    ||status.tradeLedgerWriteUnverified!==false
    ||status.pendingTradeSnapshotRebuildFrom!=='-'
    ||(status.tradeSnapshotDeferredCount??0)!==0
    ||status.pendingCount!==0||status.snapshotLastDate!==TARGET_DATE
    ||status.priceHistoryLastDate!==TARGET_DATE
    ||close?.state!=='COMPLETE'||close?.stage!=='COMPLETE'
    ||close?.runDate!==TARGET_DATE||close.priceOk!==true||close.fundOk!==true
    ||close?.fundState!=='DONE'||close?.fundAttemptDate!==TARGET_DATE
    ||close.closeErrorPresent!==false||close.fundErrorPresent!==false
    ||status.overallStatus!=='NORMAL')fail('CLOSE_OWNER_OR_DATE_UNVERIFIED');
 if(row?.date!==TARGET_DATE||row.code!==code
    ||row.navState!=='EXISTING_CONFIRMED'
    ||row.valuationRequired!==true||row.unitsApplied!==true
    ||row.reconciled!==true
    ||!STATES.has(row.evaluationState)||!STATES.has(row.snapshotState)
    ||['NOT_REQUIRED'].includes(row.evaluationState)
    ||['NOT_REQUIRED'].includes(row.snapshotState))fail('EXACT_NAV_OR_UNITS_UNVERIFIED');
 if(row.evaluationState==='EXISTING_VALID'&&row.snapshotState==='EXISTING_VALID')
  return {kind:'ISSUE734_NOV19_DERIVED',code,date:TARGET_DATE,state:'ALREADY_VERIFIED',
    recoveryRequired:false,financialWrites:0,navImportWrites:0};
 if(!['WRITE_REQUIRED','NOT_CREATED','EXISTING_VALID'].includes(row.evaluationState)
    ||!['WRITE_REQUIRED','NOT_CREATED','EXISTING_VALID'].includes(row.snapshotState))
  fail('DERIVED_STATE_UNVERIFIED');
 return {kind:'ISSUE734_NOV19_DERIVED',code,date:TARGET_DATE,state:'EXACT_DATE_PENDING',
   recoveryRequired:true,financialWrites:0,navImportWrites:0};
}

async function request({endpoint,token,action,args={},fetchImpl=fetch,timeoutMs=60000,write=false}){
 let response;
 try {
  response=await fetchImpl(endpoint,{method:'POST',redirect:'follow',
    headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
    body:new URLSearchParams({action,...args,accessToken:token}),
    signal:AbortSignal.timeout(timeoutMs)});
 }catch{fail(write?'WRITE_ACK_UNCERTAIN_NO_RETRY':'READ_NETWORK_UNVERIFIED');}
 if(response?.ok!==true)fail(write?'WRITE_ACK_UNCERTAIN_NO_RETRY':'READ_HTTP_UNVERIFIED');
 try{return await response.json();}
 catch{fail(write?'WRITE_ACK_UNCERTAIN_NO_RETRY':'READ_JSON_UNVERIFIED');}
}
export async function readNov19FundDay({endpoint,token,code,fetchImpl=fetch,post=request}){
 const data=await post({endpoint,token,fetchImpl,action:'getFundValuationStatus',
  args:{from:TARGET_DATE,to:TARGET_DATE,code}});
 const group=data?.fundResults?.[code];
 if(data?.status!=='ok'||group?.code!==code||!Array.isArray(group.dates)
    ||group.dates.length!==1)fail('READBACK_DATE_UNVERIFIED');
 return group.dates[0];
}
export async function recoverNov19DerivedOnce({
 url,token,code,confirm='',diagnoseOnly=true,fetchImpl=fetch,
 verify=verifyGas9298ReleaseReadOnly,readStatus=runBackfillStatus,post=request
}={}){
 if(!Object.hasOwn(FUNDS,code))fail('FUND_SCOPE_INVALID');
 // In the workflow, both the date and fund choice are fixed, never arbitrary.
 if(typeof token!=='string'||token.length<12)fail('AUTH_MISSING');
 const endpoint=validateWebAppUrl(url);
 if(!diagnoseOnly&&confirm!=='APPLY_2026-11-19')fail('MANUAL_APPROVAL_REQUIRED');
 const verified=await verify({url:endpoint,token,fetchImpl,mode:'post',candidateVersion:'9.304'});
 const current=await readStatus({url:endpoint,token,fetchImpl});
 const row=await readNov19FundDay({endpoint,token,code,fetchImpl,post});
 const ready=assessNov19DerivedRecovery({integrity:verified,status:current,row,code});
 if(!ready.recoveryRequired)return {...ready,mode:'READ_ONLY',alreadyVerified:true};
 if(diagnoseOnly)return {...ready,mode:'READ_ONLY',applyAllowedOnlyAfterManualApproval:true};
 // Bounded same-run revalidation. Never act on a previously observed stale
 // status, an unknown lease, a later CLOSE or a changed/corrupted fund row.
 const second=await verify({url:endpoint,token,fetchImpl,mode:'post',candidateVersion:'9.304'});
 const before=await readStatus({url:endpoint,token,fetchImpl});
 const secondRow=await readNov19FundDay({endpoint,token,code,fetchImpl,post});
 const secondReady=assessNov19DerivedRecovery({integrity:second,status:before,row:secondRow,code});
 if(!secondReady.recoveryRequired)return {...secondReady,mode:'READ_ONLY',alreadyVerified:true};
 if(row.navState!==secondRow.navState||row.evaluationState!==secondRow.evaluationState
    ||row.snapshotState!==secondRow.snapshotState
    ||row.unitsApplied!==secondRow.unitsApplied||row.reconciled!==secondRow.reconciled)
  fail('SOURCE_CHANGED_DURING_PREFLIGHT');
 let writeAckUncertain=false;
 // The one, exact-date financial write. NO retries, even on HTTP errors.
 try{
  const saved=await post({endpoint,token,fetchImpl,action:FUNDS[code],
    args:{mode:'refresh',date:TARGET_DATE},write:true,timeoutMs:180000});
  if(saved?.status!=='ok')fail('REFRESH_REJECTED_NO_RETRY');
 }catch(error){
  if(String(error?.message)==='ISSUE734_NOV19_WRITE_ACK_UNCERTAIN_NO_RETRY')writeAckUncertain=true;
  else throw error;
 }
 // An ACK is not success. Verify the persisted exact-day derived rows.
 const after=await readNov19FundDay({endpoint,token,code,fetchImpl,post});
 if(after?.date!==TARGET_DATE||after.code!==code
    ||after.navState!=='EXISTING_CONFIRMED'
    ||after.unitsApplied!==true||after.reconciled!==true
    ||after.evaluationState!=='EXISTING_VALID'
    ||after.snapshotState!=='EXISTING_VALID')
  fail(writeAckUncertain?'POSTWRITE_ACK_UNCERTAIN_NO_RETRY':'POSTWRITE_DERIVED_UNVERIFIED_NO_RETRY');
 return {kind:'ISSUE734_NOV19_DERIVED',code,date:TARGET_DATE,mode:'APPLY',
  state:'EXACT_DAY_DERIVED_VERIFIED',readbackVerified:true,writeAttempted:true,
  writeAttempts:1,navImportWrites:0,closeReplayWrites:0,ackRecoveredByReadback:writeAckUncertain};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const result=await recoverNov19DerivedOnce({
   url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,
   code:process.env.ISSUE734_FUND_CODE,confirm:process.env.ISSUE734_CONFIRM,
   diagnoseOnly:process.env.ISSUE734_DIAGNOSE_ONLY!=='false'
  });
  console.log(JSON.stringify(result));
 }catch(error){
  const code=String(error?.message||'');
  console.error(/^ISSUE734_NOV19_[A-Z_]+$/.test(code)?code:'ISSUE734_NOV19_UNVERIFIED');
  process.exitCode=2;
 }
}
