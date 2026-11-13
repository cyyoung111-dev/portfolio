// #734 2026-11-12: explicitly approved ONE-SHOT owner-bound GAS recovery.
// The current 9.293 live Web App already implements resumeIncompletePortfolioClose.
// This wrapper does not write any Sheet directly and NEVER retries a lost APPLY
// ACK. It independently checks the approved 9.293 release, 338-row ledger,
// idle writer, exact 39-row Snapshot and BOTH fund NAV/derived valuations.
// The underlying Apps Script owns ScriptLock, CAS backup and trigger reservation.
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {verifyGas9294Preflight} from './issue734-gas9294-predeploy-readonly.mjs';
import {runBackfillStatus} from './diagnose-backfill-status.mjs';
const DATE='2026-11-12';
const CODES=['F00001','F00002'];
const die=reason=>{throw Error('ISSUE734_ONCE_'+reason);};
export function assertSingleCloseOwnerReadiness({proof,status,funds}={}){
 if(proof?.status!=='VERIFIED'||proof.currentGas!=='9.293'
    ||proof.date!==DATE||proof.snapshotRows!==39
    ||proof.tradeRows!==338||proof.writerIdle!==true
    ||proof.financeWrites!==0||proof.gasDeployments!==0)
   die('LIVE_PREFLIGHT_UNVERIFIED');
 const close=status?.close;
 if(status?.gasVersion!=='9.293'
    ||close?.runDate!==DATE||close?.state!=='INCOMPLETE'
    ||close?.stage!=='PRICE'||close?.snapshotStale!==false
    ||status.snapshotLastDate!==DATE||status.priceHistoryLastDate!==DATE
    ||status.pendingCount!==0||status.triggerReady!==true
    ||status.tradeLedgerWriteUnverified!==false)
   die('EXACT_DATE_OWNER_UNVERIFIED');
 for(const code of CODES){
   const rows=funds?.[code];
   if(!Array.isArray(rows)||rows.length!==1||rows[0]?.date!==DATE
      ||rows[0]?.code!==code||rows[0]?.navState!=='EXISTING_CONFIRMED'
      ||rows[0]?.valuationRequired!==true
      ||rows[0]?.unitsApplied!==true||rows[0]?.reconciled!==true
      ||rows[0]?.evaluationState!=='EXISTING_VALID'
      ||rows[0]?.snapshotState!=='EXISTING_VALID')
     die('FUND_DERIVED_UNVERIFIED');
 }
 return {mode:'EXACT_OWNER_READ_ONLY_READY',date:DATE,
   gasVersion:'9.293',snapshotRows:39,tradeRows:338,navCodes:2,
   ownerComplete:false,financialWrites:0};
}
async function gasRequest({endpoint,token,fetchImpl,action,args={},timeout=120000}){
 let response;
 try{response=await fetchImpl(endpoint,{method:'POST',redirect:'follow',
  headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
  body:new URLSearchParams({action,...args,accessToken:token}),
  signal:AbortSignal.timeout(timeout)});
 }catch{die(action==='resumeIncompletePortfolioClose'&&args.apply==='1'
    ?'APPLY_ACK_UNCERTAIN_DO_NOT_RETRY':'READ_REQUEST_UNVERIFIED');}
 if(!response?.ok)die(action==='resumeIncompletePortfolioClose'&&args.apply==='1'
    ?'APPLY_ACK_UNCERTAIN_DO_NOT_RETRY':'READ_HTTP_UNVERIFIED');
 try{return await response.json();}
 catch{die(action==='resumeIncompletePortfolioClose'&&args.apply==='1'
   ?'APPLY_ACK_UNCERTAIN_DO_NOT_RETRY':'READ_JSON_UNVERIFIED');}
}
export async function recoverIssue734Once({
 url,token,confirm,fetchImpl=fetch,verify=verifyGas9294Preflight,
 readStatus=runBackfillStatus,post=gasRequest
}={}){
 if(confirm!=='APPLY')die('EXPLICIT_MANUAL_APPROVAL_REQUIRED');
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||!token.trim())die('AUTH_MISSING');
 const proof=await verify({url:endpoint,token,fetchImpl});
 const before=await readStatus({url:endpoint,token,fetchImpl});
 const funds={};
 for(const code of CODES){
   const p=await post({endpoint,token,fetchImpl,
     action:'getFundValuationStatus',args:{from:DATE,to:DATE,code}});
   if(p?.status!=='ok'||p.fundResults?.[code]?.code!==code)
     die('FUND_STATUS_UNVERIFIED');
   funds[code]=p.fundResults[code].dates;
 }
 const readiness=assertSingleCloseOwnerReadiness({proof,status:before,funds});
 // The GAS dry-run validates that the same owner exists and no FUND/backfill
 // lease is currently active. 'complete=true' is a race, not APPLY permission.
 const preview=await post({endpoint,token,fetchImpl,
   action:'resumeIncompletePortfolioClose',args:{apply:'0',phase:'schedule'}});
 if(preview?.status!=='ok'||preview.date!==DATE||preview.complete!==false)
   die('GAS_OWNER_PREVIEW_REJECTED');
 // Recheck current owner immediately before the single APPLY. No initial
 // read, preview or public source is permission to overwrite a newer CLOSE.
 const immediate=await readStatus({url:endpoint,token,fetchImpl});
 assertSingleCloseOwnerReadiness({proof,status:immediate,funds});
 const applied=await post({endpoint,token,fetchImpl,
   action:'resumeIncompletePortfolioClose',args:{apply:'1',phase:'schedule'},
   timeout:330000});
 if(applied?.status!=='ok'||applied.date!==DATE||applied.scheduled!==true)
   die('APPLY_RESULT_UNVERIFIED_DO_NOT_RETRY');
 // An ACK of a scheduled NAV trigger is not a CLOSE COMPLETE receipt.
 const after=await readStatus({url:endpoint,token,fetchImpl});
 if(after?.gasVersion!=='9.293'||after.close?.runDate!==DATE
    ||after.snapshotLastDate!==DATE||after.priceHistoryLastDate!==DATE
    ||after.close?.priceOk!==true)
   die('POST_APPLY_OWNER_READBACK_UNVERIFIED_DO_NOT_RETRY');
 return {kind:'ISSUE734_OWNER_REPAIR_ONCE_ACK',
   date:DATE,snapshotRows:readiness.snapshotRows,
   gasVersion:'9.293',scheduled:true,closeComplete:false,
   navCompletionRequiresIndependentReceipt:true,autoApplyRetries:0,
   manualApprovalVerified:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(JSON.stringify(await recoverIssue734Once({
  url:process.env.GAS_WEB_APP_URL,
  token:process.env.GAS_ACCESS_TOKEN,
  confirm:process.env.ISSUE734_CONFIRM_RECOVERY})))}
 catch(error){
  const c=String(error?.message||'');
  console.error(/^ISSUE734_ONCE_[A-Z_]+$/.test(c)?c:'ISSUE734_ONCE_UNVERIFIED');
  process.exitCode=1;
 }
}
