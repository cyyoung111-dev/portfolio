import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {runBackfillStatus} from './diagnose-backfill-status.mjs';
export async function runCheckpoint({url,token,apply=false,fetchImpl=fetch}){
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||!token.trim()||typeof apply!=='boolean')throw Error('CHECKPOINT_INPUT');
 async function req(action,args={},credential=token){try{const r=await fetchImpl(endpoint,{method:'POST',redirect:'follow',headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({action,...args,accessToken:credential}),signal:AbortSignal.timeout(180000)});if(!r.ok)throw Error();return await r.json();}catch{throw Error('CHECKPOINT_REQUEST_VERIFY_BEFORE_RETRY');}}
 const bad=token==='CHECKPOINT_BAD'?'CHECKPOINT_BAD_ALT':'CHECKPOINT_BAD';
 const denied=await req('getAutomationStatus',{},bad);
 if(denied.status!=='error'||denied.message!=='인증 실패')throw Error('CHECKPOINT_AUTH_GUARD');
 const before=await req('getAutomationStatus');
 if(before.status!=='ok'||before.gasVersion!=='9.269')throw Error('CHECKPOINT_VERSION');
 const result=await req('reconcileHistoricalCheckpoints',{apply:apply?'1':'0'});
 if(result.status!=='ok')throw Error(['CHECKPOINT_WRITER_ACTIVE','CHECKPOINT_BACKUP_LIMIT','CHECKPOINT_BACKUP_UNVERIFIED','CHECKPOINT_RECONCILE_FAILED'].includes(result.message)?result.message:'CHECKPOINT_SERVER');
 if(result.mode!==(apply?'APPLY':'DRY_RUN')||![result.stale,result.reconciled].every(x=>Number.isSafeInteger(x)&&x>=0&&x<=2)||result.reconciled!==(apply?result.stale:0)||result.originalDataWritten!==false||result.queuesChanged!==false||result.errorsCleared!==false)throw Error('CHECKPOINT_PROOF');
 const after=await runBackfillStatus({url:endpoint,token,fetchImpl});
 return {mode:result.mode,stale:result.stale,reconciled:result.reconciled,originalDataWritten:false,queuesChanged:false,errorsCleared:false,status:after};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){try{console.log(JSON.stringify(await runCheckpoint({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,apply:process.env.APPLY==='1'})));}catch(e){console.error(/^(?:CHECKPOINT_|AUTOMATION_DIAG_)[A-Z_]+$/.test(e?.message||'')?e.message:'CHECKPOINT_UNKNOWN');process.exitCode=1;}}
