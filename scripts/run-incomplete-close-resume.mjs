import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {runBackfillStatus,summarizeBackfillStatus} from './diagnose-backfill-status.mjs';
export async function resumeClose({url,token,fetchImpl=fetch,emit=()=>{}}) {
 const endpoint=validateWebAppUrl(url);
 const initial=await runBackfillStatus({url:endpoint,token,fetchImpl});
 if(initial.gasVersion!=='9.264')throw Error('RESUME_VERSION');
 if(initial.close.state==='COMPLETE'&&!initial.close.fundWarningPresent)return {complete:true,status:initial};
 async function req(action,args={}) {
  try {
   const r=await fetchImpl(endpoint,{method:'POST',redirect:'follow',headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({action,...args,accessToken:token}),signal:AbortSignal.timeout(330000)});
   if(!r.ok)throw Error();return await r.json();
  }catch{throw Error('RESUME_REQUEST_UNCERTAIN_VERIFY_BEFORE_RETRY');}
 }
 const preview=await req('resumeIncompletePortfolioClose',{apply:'0',phase:'continue'});
 if(preview.status!=='ok') {
  const r=await req('resumeIncompletePortfolioClose',{apply:'1',phase:'schedule'});
  if(r.status!=='ok'||(!r.complete&&r.scheduled!==true))throw Error('RESUME_SCHEDULE_BLOCKED');
 }
 for(let i=0;i<33;i++) {
  const r=await req('resumeIncompletePortfolioClose',{apply:'1',phase:'continue'});
  const status=summarizeBackfillStatus(await req('getAutomationStatus'));
  emit({iteration:i+1,...status});
  if(status.close.state==='COMPLETE'&&!status.close.fundWarningPresent)return {complete:true,status};
  if(r.status!=='ok'||r.continued!==true)throw Error('RESUME_CONTINUE_BLOCKED_VERIFY_STATUS');
 }
 throw Error('RESUME_BOUNDED_PROGRESS_EXHAUSTED');
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){try{console.log(JSON.stringify(await resumeClose({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,emit:x=>console.log(JSON.stringify(x))})));}catch(e){console.error(/^(?:RESUME_|AUTOMATION_DIAG_)[A-Z_]+$/.test(e?.message||'')?e.message:'RESUME_UNKNOWN');process.exitCode=1;}}
