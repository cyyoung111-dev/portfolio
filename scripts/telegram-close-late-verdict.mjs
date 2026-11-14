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
 const artifact='telegram-close-claim-'+date+'-sent';
 const headers={Accept:'application/vnd.github+json',Authorization:'Bearer '+token};
 async function get(path){
  const url='https://api.github.com/repos/'+repository+path;
  const response=await fetchImpl(url,{method:'GET',headers,
   redirect:'error',signal:AbortSignal.timeout(9000)});
  if(!response?.ok)throw Error('CLOSE_LATE_GITHUB_UNVERIFIED');
  return response.json();
 }
 try{
  const data=await get('/actions/artifacts?name='+encodeURIComponent(artifact)+'&per_page=100');
  if(!data||!Array.isArray(data.artifacts)||!Number.isSafeInteger(data.total_count)
    ||data.total_count>100||data.total_count!==data.artifacts.length)
   return {...base,status:'SENT_PROOF_UNVERIFIED',verified:false};
  for(const item of data.artifacts){
   if(item.name!==artifact||item.expired!==false||!Number.isSafeInteger(item.workflow_run?.id))
    return {...base,status:'SENT_PROOF_UNVERIFIED',verified:false};
   const run=await get('/actions/runs/'+item.workflow_run.id);
   if(run?.head_branch==='main'&&run?.head_repository?.full_name===REPO
     &&PATHS.has(run?.path)
     &&run?.event!=='pull_request')
    return {...base,status:'PRIOR_SENT_ARTIFACT_VERIFIED',
     verified:true};
  }
  return {...base,status:'NO_TRUSTED_SENT_PROOF',verified:false};
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
