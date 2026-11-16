import {pathToFileURL} from 'node:url';
import {krxSessionStatus} from './krx-session-calendar.mjs';
import {verifyLateScheduledMorningSent} from './telegram-morning-late-sent-readonly.mjs';

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
  now=()=>new Date(),fetchImpl=fetch,token,repository=REPO,
  verifySent=verifyLateScheduledMorningSent
}={}){
  if(repository!==REPO||typeof token!=='string'||!token)throw Error('NH_AUDIT_CONFIG');
  const clock=kstNow(now());
  if(clock.minute<493)throw Error('NH_AUDIT_TOO_EARLY'); // 08:13 KST
  const date=clock.date,calendar=krxSessionStatus(date);
  if(calendar==='CLOSED')return {date,status:'MARKET_CLOSED',ok:true,runs:0,artifacts:0};
  if(calendar!=='OPEN')throw Error('NH_AUDIT_CALENDAR_UNVERIFIED');
  const start=Date.parse(date+'T07:30:00+09:00');
  const end=Date.parse(date+'T08:00:00+09:00');
  // Scan through the actual audit time, not only the intended slot.
  // A late successful run must not be mistaken for no run at all.
  const scanEnd=Math.min(now().getTime(),Date.parse(date+'T23:59:59.999+09:00'));
  const after=new Date(start).toISOString()+'..'+new Date(scanEnd).toISOString();
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
      &&Number.isFinite(created)&&created>=start&&created<=scanEnd;
  });
  const timelyRuns=validRuns.filter(r=>Date.parse(r.created_at)<end);
  const lateRuns=validRuns.filter(r=>Date.parse(r.created_at)>=end);
  const artifacts=artifactData.artifacts.filter(a=>a?.name==='nh-night-reference-'+date
    &&a.expired===false&&Number.isSafeInteger(a.id));
  const timelySuccess=timelyRuns.filter(r=>r.status==='completed'&&r.conclusion==='success');
  const lateSuccess=lateRuns.filter(r=>r.status==='completed'&&r.conclusion==='success');
  const proof=artifacts.filter(a=>timelySuccess.some(r=>r.id===a.workflow_run?.id));
  const lateProof=artifacts.filter(a=>lateSuccess.some(r=>r.id===a.workflow_run?.id));
  const status=proof.length===1&&artifacts.length===1?'CAPTURE_CONFIRMED'
    :lateProof.length>0?'CAPTURE_LATE_CONFIRMED'
    :artifacts.length>0?'ARTIFACT_PROVENANCE_UNVERIFIED'
    :timelyRuns.length===0&&lateRuns.length>0?'SCHEDULE_LATE_NO_REFERENCE'
    :timelyRuns.length===0?'SCHEDULE_NOT_TRIGGERED'
    :timelyRuns.some(r=>r.status==='in_progress'||r.status==='queued')?'CAPTURE_RUN_INCOMPLETE'
    :timelySuccess.length>0?'CAPTURE_RUN_NO_REFERENCE'
    :'CAPTURE_RUN_FAILED';
  const result={date,status,ok:status==='CAPTURE_CONFIRMED',
    runs:timelyRuns.length,lateRuns:lateRuns.length,artifacts:artifacts.length};
  // The independent capture is still missing. A verified, API-accepted morning
  // delivery only downgrades the repeated GitHub scheduler delay to a warning;
  // it must never claim that the NH capture artifact or 06:00 tick exists.
  if((status==='SCHEDULE_LATE_NO_REFERENCE'||status==='SCHEDULE_NOT_TRIGGERED')
    &&artifacts.length===0){
    try{
      const sent=await verifySent({date,repository,token,fetchImpl});
      if(sent?.verifiedSent===true&&sent.date===date)
        return {...result,status:'CAPTURE_MISSED_MORNING_SENT',morningDeliveryVerified:true};
    }catch{/* No trustworthy SENT proof: preserve the capture failure. */}
  }
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.env.GITHUB_REPOSITORY!==REPO||process.env.GITHUB_REF!=='refs/heads/main'
      ||!['schedule','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME)
      ||process.env.GITHUB_RUN_ATTEMPT!=='1')throw Error('NH_AUDIT_EVENT_DENIED');
    const r=await auditNhNightSchedule({repository:process.env.GITHUB_REPOSITORY,
      token:process.env.GH_TOKEN});
    console.log(JSON.stringify(r));
    if(!r.ok){
      if(r.status==='CAPTURE_MISSED_MORNING_SENT')
        console.log('::warning title=NH capture scheduled late::NH_CAPTURE_MISSED_MORNING_SENT');
      else process.exitCode=2;
    } // A verified SENT mitigates delivery, not independent NH capture.
  }catch(e){
    const safe=String(e?.message||'');
    console.error(/^NH_AUDIT_[A-Z_]+$/.test(safe)?safe:'NH_AUDIT_UNVERIFIED');
    process.exitCode=1;
  }
}
