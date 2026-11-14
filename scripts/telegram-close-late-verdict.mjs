// #734: A delayed closing cron must not turn an unconfirmed missed
// Telegram delivery into a green GitHub run. Read-only SENT archive proof;
// never sends Telegram, creates a delivery claim or alters finance data.
import {krxSessionStatus} from './krx-session-calendar.mjs';
import {pathToFileURL} from 'node:url';
export function lateCloseTargetDate(now=new Date()){
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('CLOSE_LATE_CLOCK_INVALID');
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(now).map(z=>[z.type,z.value]));
 let date=p.year+'-'+p.month+'-'+p.day;
 const clock=Number(p.hour)*60+Number(p.minute);
 // An early-arm aborted after 16:00 must NOT use Friday's SENT as proof
 // for Monday's failed pre-arm. Audit the current KRX session from 16:00.
 if(clock>=960&&krxSessionStatus(date)==='OPEN')return date;
 for(let i=0;i<14;i++){
  const d=new Date(date+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()-1);
  date=d.toISOString().slice(0,10);
  const x=krxSessionStatus(date);
  if(x==='OPEN')return date;
  if(x!=='CLOSED')return null;
 }
 return null;
}
const REPO='cyyoung111-dev/portfolio';
const PATHS=new Set([
 '.github/workflows/telegram-close-briefing.yml',
 '.github/workflows/telegram-close-punctual-arm.yml'
]);
export async function verifyLateCloseSent({
 now=new Date(),token,repository=REPO,fetchImpl=fetch}={}){
 const date=lateCloseTargetDate(now);
 const base={kind:'TELEGRAM_CLOSE_LATE_SCHEDULE_READONLY',
  date:date||'-',telegramSends:0,financeWrites:0};
 if(!date||repository!==REPO||typeof token!=='string'||token.length<8)
  return {...base,status:'SENT_PROOF_UNVERIFIED',verified:false};
 const claimName='telegram-close-claim-'+date;
 const start=Date.parse(date+'T17:00:00+09:00');
 const end=Date.parse(date+'T18:00:00+09:00');
 const headers={Accept:'application/vnd.github+json',Authorization:'Bearer '+token};
 async function get(path){
  const url='https://api.github.com/repos/'+repository+path;
  const response=await fetchImpl(url,{method:'GET',headers,
   redirect:'error',signal:AbortSignal.timeout(9000)});
  if(!response?.ok)throw Error('CLOSE_LATE_GITHUB_UNVERIFIED');
  return response.json();
 }
 try{
  async function artifact(name){
   const data=await get('/actions/artifacts?name='+encodeURIComponent(name)+'&per_page=100');
   if(!data||data.total_count!==1||!Array.isArray(data.artifacts)
     ||data.artifacts.length!==1)throw Error('CLOSE_LATE_ARTIFACT_UNVERIFIED');
   const a=data.artifacts[0],created=Date.parse(a?.created_at);
   if(a?.name!==name||a.expired!==false||!Number.isSafeInteger(a.id)
     ||!Number.isSafeInteger(a.workflow_run?.id)
     ||!Number.isFinite(created)||created<start||created>=end)
    throw Error('CLOSE_LATE_ARTIFACT_UNVERIFIED');
   return {runId:a.workflow_run.id,created};
  }
  const sent=await artifact(claimName+'-sent');
  const claim=await artifact(claimName);
  if(sent.runId!==claim.runId||claim.created>sent.created)
   throw Error('CLOSE_LATE_CLAIM_UNVERIFIED');
  const run=await get('/actions/runs/'+sent.runId);
  if(run?.id!==sent.runId||run?.status!=='completed'||run?.conclusion!=='success'
     ||run.head_branch!=='main'||run.head_repository?.full_name!==REPO
     ||!PATHS.has(run.path)||run.run_attempt!==1
     ||!['schedule','workflow_dispatch','workflow_run','push'].includes(run.event))
   throw Error('CLOSE_LATE_RUN_UNVERIFIED');
  return {...base,status:'PRIOR_SENT_ARTIFACT_VERIFIED',verified:true,
   githubReads:3};
 }catch{return {...base,status:'SENT_PROOF_UNVERIFIED',verified:false};}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length!==3||process.argv[2]!=='--check-scheduled-arm')
   throw Error('CLOSE_LATE_ARG_INVALID');
  const proof=await verifyLateCloseSent({
   repository:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN});
  console.log(JSON.stringify(proof));
  if(process.env.GITHUB_STEP_SUMMARY) {
   const fs=await import('node:fs');
   fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    'Scheduled early-arm without SEND: '+proof.status+
    ' / KRX session '+proof.date+' (Telegram sends 0)'+'\n');
  }
  if(!proof.verified)process.exitCode=1;
 }catch{
  console.error('CLOSE_LATE_PROOF_UNVERIFIED');process.exitCode=1;
 }
}
