import {pathToFileURL} from 'node:url';
import {runPreview} from './preview-krx-pending-reconcile.mjs';
import {runTargetedRecovery} from './run-krx-targeted-recovery.mjs';
import {runCoverage} from './diagnose-krx-held-coverage.mjs';
import {runBackfillStatus} from './diagnose-backfill-status.mjs';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
export const DATES=Object.freeze(['2026-10-22','2026-10-23','2026-10-26']);
export async function runDaily({url,token,apply=false,fetchImpl=fetch,emit=()=>{}}){
  const endpoint=validateWebAppUrl(url);
  if(typeof apply!=='boolean'||typeof token!=='string'||!token.trim())throw Error('DAILY_INPUT');
  const opts={url:endpoint,token,fetchImpl},out=[];
  for(const date of DATES){
    let proof=await runPreview({...opts,dates:date});
    emit({phase:'PERSISTED_PROOF',...proof});
    if(!proof.entries[0].verified){
      const source=await runCoverage({...opts,dates:date});emit({phase:'OFFICIAL_SOURCE',...source});
      if(!source.ready){out.push({date,status:'SOURCE_BLOCKED'});continue;}
      // Existing producer preflight requires an empty date and rejects foreign
      // session conflicts before backups or writes. Never bypass that gate.
      const recovery=await runTargetedRecovery({...opts,date,apply});emit({phase:'RECOVERY',...recovery});
      if(!apply){out.push({date,status:'READY_FOR_RECOVERY'});continue;}
      proof=await runPreview({...opts,dates:date});
    }
    const p=proof.entries[0];
    if(!p.verified)throw Error('DAILY_NOT_VERIFIED');
    let cleared=0;
    if(apply&&p.queued){
      let response,data;
      try{response=await fetchImpl(endpoint,{method:'POST',redirect:'follow',headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({action:'reconcileCompletedKrxPending',dates:date,apply:'1',accessToken:token}),signal:AbortSignal.timeout(180000)});if(!response.ok)throw Error();data=await response.json();}catch{throw Error('DAILY_APPLY_UNCERTAIN_VERIFY_BEFORE_RETRY');}
      const c=data?.checked?.[0];
      if(data?.status!=='ok'||data.mode!=='APPLIED'||data.checked.length!==1||c?.date!==date||c.ok!==true||c.verifiedCodes!==p.verifiedCodes||typeof c.queued!=='boolean'||data.cleared!==(c.queued?1:0))throw Error('DAILY_APPLY_PROOF');
      cleared=data.cleared;
    }
    const after=await runPreview({...opts,dates:date});
    if(!after.entries[0].verified||(apply&&after.entries[0].queued))throw Error('DAILY_READBACK');
    out.push({date,status:apply?'VERIFIED_CLEAR':'VERIFIED',cleared});
  }
  const status=await runBackfillStatus(opts);emit({phase:'FINAL_STATUS',...status});
  return {mode:apply?'APPLY':'DRY_RUN',dates:out,complete:out.every(x=>x.status==='VERIFIED_CLEAR')};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
  try{console.log(JSON.stringify(await runDaily({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,apply:process.env.APPLY==='1',emit:r=>console.log(JSON.stringify(r))})));}
  catch(e){console.error(/^(?:DAILY_|TARGET_|PENDING_PREVIEW_|KRX_HELD_DIAG_|AUTOMATION_DIAG_)[A-Z_]+$/.test(e?.message||'')?e.message:'DAILY_UNKNOWN');process.exitCode=1;}
}
