import {pathToFileURL} from 'node:url';
import {krxSessionStatus} from './krx-session-calendar.mjs';

const REPO='cyyoung111-dev/portfolio';
const WORKFLOW='nh-night-capture.yml';
const REFERENCE='NH night reference capture';
const PATH='.github/workflows/nh-night-capture.yml';

function kstNow(instant){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
    hourCycle:'h23'}).formatToParts(instant).map(x=>[x.type,x.value]));
  return {date:p.year+'-'+p.month+'-'+p.day,minute:Number(p.hour)*60+Number(p.minute)};
}
export async function auditNhNightSchedule({
  now=()=>new Date(),fetchImpl=fetch,token,repository=REPO
}={}){
  if(repository!==REPO||typeof token!=='string'||!token)throw Error('NH_AUDIT_CONFIG');
  const clock=kstNow(now());
  if(clock.minute<458)throw Error('NH_AUDIT_TOO_EARLY'); // 07:38 KST after the 07:35 capture cutoff
  const date=clock.date,calendar=krxSessionStatus(date);
  if(calendar==='CLOSED')return {date,status:'MARKET_CLOSED',ok:true,runs:0,artifacts:0};
  if(calendar!=='OPEN')throw Error('NH_AUDIT_CALENDAR_UNVERIFIED');
  const start=Date.parse(date+'T06:45:00+09:00');
  const end=Date.parse(date+'T07:35:00+09:00');
  const after=new Date(start).toISOString()+'..'+new Date(end-1).toISOString();
  const base='https://api.github.com/repos/'+REPO+'/actions';
  const runUrl=base+'/workflows/'+WORKFLOW+'/runs?event=schedule&branch=main&created='+encodeURIComponent(after)+'&per_page=100';
  const artifactUrl=base+'/artifacts?name='+encodeURIComponent('nh-night-reference-'+date)+'&per_page=100';
  const headers={authorization:'Bearer '+token,accept:'application/vnd.github+json'};
  async function get(url){
    let response,body;
    try{
      response=await fetchImpl(url,{headers,redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error();
      body=await response.json();
    }catch{throw Error('NH_AUDIT_API_UNAVAILABLE');}
    return body;
  }
  const [runData,artifactData]=await Promise.all([get(runUrl),get(artifactUrl)]);
  if(!Number.isSafeInteger(runData?.total_count)||!Array.isArray(runData.workflow_runs)
    ||runData.total_count>100||runData.total_count<runData.workflow_runs.length
    ||!Number.isSafeInteger(artifactData?.total_count)||!Array.isArray(artifactData.artifacts)
    ||artifactData.total_count>100||artifactData.total_count<artifactData.artifacts.length)
    throw Error('NH_AUDIT_API_SCHEMA');
  const validRuns=runData.workflow_runs.filter(r=>{
    const created=Date.parse(r?.created_at);
    return Number.isSafeInteger(r?.id)&&r.name===REFERENCE&&r.path===PATH
      &&r.event==='schedule'&&r.head_branch==='main'
      &&r.head_repository?.full_name===REPO&&r.run_attempt===1
      &&Number.isFinite(created)&&created>=start&&created<end;
  });
  const artifacts=artifactData.artifacts.filter(a=>a?.name==='nh-night-reference-'+date
    &&a.expired===false&&Number.isSafeInteger(a.id));
  const succeeded=validRuns.filter(r=>r.status==='completed'&&r.conclusion==='success');
  const proof=artifacts.filter(a=>succeeded.some(r=>r.id===a.workflow_run?.id));
  const status=proof.length===1&&artifacts.length===1?'CAPTURE_CONFIRMED'
    :artifacts.length>0?'ARTIFACT_PROVENANCE_UNVERIFIED'
    :validRuns.length===0?'SCHEDULE_NOT_TRIGGERED'
    :validRuns.some(r=>r.status==='in_progress'||r.status==='queued')?'CAPTURE_RUN_INCOMPLETE'
    :succeeded.length>0?'CAPTURE_RUN_NO_REFERENCE'
    :'CAPTURE_RUN_FAILED';
  return {date,status,ok:status==='CAPTURE_CONFIRMED',
    runs:validRuns.length,artifacts:artifacts.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.env.GITHUB_REPOSITORY!==REPO||process.env.GITHUB_REF!=='refs/heads/main'
      ||!['schedule','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME)
      ||process.env.GITHUB_RUN_ATTEMPT!=='1')throw Error('NH_AUDIT_EVENT_DENIED');
    const r=await auditNhNightSchedule({repository:process.env.GITHUB_REPOSITORY,
      token:process.env.GH_TOKEN});
    console.log(JSON.stringify(r));
    if(!r.ok)process.exitCode=2; // Red Actions check, no NH query or Telegram send.
  }catch(e){
    const safe=String(e?.message||'');
    console.error(/^NH_AUDIT_[A-Z_]+$/.test(safe)?safe:'NH_AUDIT_UNVERIFIED');
    process.exitCode=1;
  }
}
