import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {runBackfillStatus,summarizeBackfillStatus} from './diagnose-backfill-status.mjs';
export async function resumeClose({url,token,fetchImpl=fetch,emit=()=>{},readOnly=false}) {
 const endpoint=validateWebAppUrl(url);
 const initialStarted=Date.now();
 let initial;
 try {initial=await runBackfillStatus({url:endpoint,token,fetchImpl});}
 catch(error){if(readOnly)emit({phase:'INITIAL_STATUS',requestState:'FAILED',elapsedMs:Date.now()-initialStarted});throw error;}
 if(readOnly)emit({phase:'INITIAL_STATUS',elapsedMs:Date.now()-initialStarted,...initial});
 if(initial.gasVersion!=='9.275')throw Error('RESUME_VERSION');
 if(!readOnly&&initial.close.state==='COMPLETE'&&!initial.close.fundWarningPresent)return {complete:true,status:initial};
 const waitingFundDone=status=>status.close.krxPublicationWaiting && status.close.fundOk===true
   && status.close.fundState==='DONE' && !status.close.fundErrorPresent && !status.close.fundWarningPresent;
 if(!readOnly&&waitingFundDone(initial))return {complete:false,fundComplete:true,waitingPublication:true,status:initial};
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
