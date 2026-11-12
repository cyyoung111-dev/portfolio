import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {runBackfillStatus,summarizeBackfillStatus} from './diagnose-backfill-status.mjs';
export async function resumeClose({url,token,fetchImpl=fetch,emit=()=>{},readOnly=false,statusReader=runBackfillStatus}) {
 const endpoint=validateWebAppUrl(url);
 const initialStarted=Date.now();
 let initial;
 try {initial=await statusReader({url:endpoint,token,fetchImpl});}
 catch(error){if(readOnly)emit({phase:'INITIAL_STATUS',requestState:'FAILED',elapsedMs:Date.now()-initialStarted});throw error;}
 if(readOnly)emit({phase:'INITIAL_STATUS',elapsedMs:Date.now()-initialStarted,...initial});
 // The published 9.289 CLOSE may have committed the 11/10 Snapshot even when
 // its PRICE owner timed out before recording the summary. Its schedule/continue
 // producer can call saveDailyPriceHistory again. Never use that writer as
 // evidence-only recovery and never auto-admit it through a version bump.
 // The status reader uses authenticated persisted getAutomationStatus only.
 if(initial.gasVersion==='9.289' && readOnly){
  const close=initial.close||{};
  const matched=close.state==='COMPLETE'&&close.stage==='COMPLETE'
    &&close.priceOk===true&&close.fundOk===true
    &&close.runDate===close.fundAttemptDate
    &&close.fundErrorPresent===false&&close.fundWarningPresent===false;
  const preflightState=matched
    ?'AWAIT_INDEPENDENT_DEPLOY_GATE'
    :'BLOCKED_9289_UNSETTLED_CLOSE';
  emit({phase:'9289_READ_ONLY_STATUS',requestState:'CHECKED',
    preflightState,priceReplayAllowed:false,
    navReplayAllowed:false,financialWrites:0});
  return {mode:'READ_ONLY',complete:false,
    continueReady:null,scheduleReady:null,preflightState,
    priceReplayAllowed:false,navReplayAllowed:false,
    status:initial};
 }
 // Modern releases have an immutable persisted close marker, not the
 // legacy resumeIncompletePortfolioClose preview/apply protocol. Status is
 // safe to inspect on 9.293; financial replay is NEVER admitted from here.
 if(readOnly&&['9.291','9.292','9.293'].includes(initial.gasVersion)){
  const close=initial.close||{};
  const matching=close.state==='COMPLETE'&&close.stage==='COMPLETE'
    &&close.priceOk===true&&close.fundOk===true
    &&close.runDate===close.fundAttemptDate
    &&close.fundErrorPresent===false&&close.fundWarningPresent===false;
  const preflightState=matching
    ?'PERSISTED_CLOSE_MARKER_COMPLETE_INDEPENDENT_PROOF_REQUIRED'
    :'BLOCKED_PERSISTED_CLOSE_INCOMPLETE';
  emit({phase:'MODERN_CLOSE_READ_ONLY_STATUS',requestState:'CHECKED',
    version:initial.gasVersion,preflightState,
    priceReplayAllowed:false,navReplayAllowed:false,
    financialWrites:0,gasDeployments:0});
  return {mode:'READ_ONLY',complete:false,closeMarkerComplete:matching,
    continueReady:null,scheduleReady:null,preflightState,
    priceReplayAllowed:false,navReplayAllowed:false,status:initial};
 }
 if(!['9.281','9.282','9.283','9.284','9.285'].includes(initial.gasVersion))throw Error('RESUME_VERSION');
 if(!readOnly&&initial.close.state==='COMPLETE'&&!initial.close.fundWarningPresent)return {complete:true,status:initial};
 const waitingFundDone=status=>status.close.krxPublicationWaiting && status.close.fundOk===true
   && status.close.fundState==='DONE' && !status.close.fundErrorPresent && !status.close.fundWarningPresent;
 if(!readOnly&&waitingFundDone(initial))return {complete:false,fundComplete:true,waitingPublication:true,status:initial};
 // An authenticated persisted timeout is already sufficient to block a
 // read-only recovery verdict. The GAS preview would acquire the same shared
 // ScriptLock and has been observed to hang until the 330s HTTP timeout.
 // Never schedule/continue or imply readiness based on a timed-out worker.
 if(readOnly && initial.close.state==='INCOMPLETE'
   && initial.close.fundOk===false
   && initial.close.fundState==='TIMEOUT_SUSPECTED'){
  emit({phase:'FUND_TIMEOUT_PREVIEW_SKIPPED',operation:'READ_ONLY',
    requestState:'BLOCKED',reason:'FUND_TIMEOUT_SUSPECTED'});
  return {mode:'READ_ONLY',complete:false,continueReady:null,
    scheduleReady:null,preflightState:'BLOCKED_BY_PERSISTED_FUND_TIMEOUT',
    status:initial};
 }
 async function req(action,args={}) {
  let r;
  const started=Date.now();
  const diagnostic=()=>({phase:args.phase||action,operation:action==='getAutomationStatus'?'READ':args.apply==='0'?'PREVIEW':'APPLY',elapsedMs:Date.now()-started});
  try {
   r=await fetchImpl(endpoint,{method:'POST',redirect:'follow',headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({action,...args,accessToken:token}),signal:AbortSignal.timeout(330000)});
  }catch{emit({...diagnostic(),requestState:'NETWORK_UNCERTAIN'});throw Error('RESUME_REQUEST_UNCERTAIN_VERIFY_BEFORE_RETRY');}
  if(!r.ok){emit({...diagnostic(),requestState:'HTTP_ERROR',httpStatus:Number.isInteger(r.status)?r.status:null});throw Error('RESUME_HTTP_UNCERTAIN_VERIFY_BEFORE_RETRY');}
  try{const data=await r.json();if(readOnly)emit({...diagnostic(),requestState:'RECEIVED',responseOk:data?.status==='ok'});return data;}catch{emit({...diagnostic(),requestState:'JSON_UNCERTAIN'});throw Error('RESUME_JSON_UNCERTAIN_VERIFY_BEFORE_RETRY');}
 }
 const preview=await req('resumeIncompletePortfolioClose',{apply:'0',phase:'continue'});
 if(readOnly){
  const schedule=await req('resumeIncompletePortfolioClose',{apply:'0',phase:'schedule'});
  return {mode:'READ_ONLY',complete:initial.close.state==='COMPLETE',continueReady:preview.status==='ok',scheduleReady:schedule.status==='ok',status:initial};
 }
 if(preview.status!=='ok') {
  const r=await req('resumeIncompletePortfolioClose',{apply:'1',phase:'schedule'});
  if(r.status!=='ok'||(!r.complete&&r.scheduled!==true)){
   const allowed=['AUTH','OWNER','BUSY','RESERVATION','PRICE_VERIFY','OWNER_CHECK','CONTINUE','SCHEDULE'];
   const errorCode=allowed.map(x=>'CLOSE_RESUME_'+x+'_FAILED').includes(r.errorCode)?r.errorCode:'UNCLASSIFIED';
   emit({phase:'schedule',operation:'APPLY',requestState:'BLOCKED',errorCode});
   throw Error('RESUME_SCHEDULE_BLOCKED');
  }
 }
 for(let i=0;i<33;i++) {
  const r=await req('resumeIncompletePortfolioClose',{apply:'1',phase:'continue'});
  const status=summarizeBackfillStatus(await req('getAutomationStatus'));
  emit({iteration:i+1,...status});
  if(status.close.state==='COMPLETE'&&!status.close.fundWarningPresent)return {complete:true,status};
  if(waitingFundDone(status))return {complete:false,fundComplete:true,waitingPublication:true,status};
  if(r.status!=='ok'||r.continued!==true)throw Error('RESUME_CONTINUE_BLOCKED_VERIFY_STATUS');
 }
 throw Error('RESUME_BOUNDED_PROGRESS_EXHAUSTED');
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){try{console.log(JSON.stringify(await resumeClose({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,readOnly:process.env.RESUME_READ_ONLY==='1',emit:x=>console.log(JSON.stringify(x))})));}catch(e){console.error(/^(?:RESUME_|AUTOMATION_DIAG_)[A-Z_]+$/.test(e?.message||'')?e.message:'RESUME_UNKNOWN');process.exitCode=1;}}
