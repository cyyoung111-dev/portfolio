// Read-only proof for a severely delayed GitHub morning schedule.
// Trust only dated regular-window claim + SENT artifacts uploaded by the same
// successful production workflow. A claim without SENT cannot clear the error.
const REPO='cyyoung111-dev/portfolio';
const MORNING_PATHS=new Set([
 '.github/workflows/telegram-morning-briefing.yml',
 '.github/workflows/telegram-morning-punctual-arm.yml'
]);
const fail=()=>{throw Error('TELEGRAM_SCHEDULE_LATE_UNVERIFIED');};
export async function verifyLateScheduledMorningSent({
 date,repository,token,fetchImpl=fetch
}={}){
 if(repository!==REPO||typeof token!=='string'||!token
    ||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date||''))fail();
 const start=Date.parse(date+'T07:40:00+09:00');
 const end=Date.parse(date+'T08:10:00+09:00');
 if(!Number.isFinite(start)||!Number.isFinite(end))fail();
 const base='https://api.github.com/repos/'+REPO+'/actions';
 async function get(url){
  let response;
  try{response=await fetchImpl(url,{method:'GET',
   headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json'},
   redirect:'error',signal:AbortSignal.timeout(15000)});}
  catch{fail();}
  if(response?.ok!==true)fail();
  try{return await response.json();}catch{fail();}
 }
 const claimName='telegram-morning-claim-'+date;
 async function oneArtifact(name){
  const data=await get(base+'/artifacts?name='+encodeURIComponent(name)+'&per_page=100');
  if(data?.total_count!==1||!Array.isArray(data.artifacts)||data.artifacts.length!==1)fail();
  const a=data.artifacts[0];
  if(a?.name!==name||a.expired!==false||!Number.isSafeInteger(a.id)
    ||!Number.isSafeInteger(a.workflow_run?.id))fail();
  const created=Date.parse(a.created_at);
  if(!Number.isFinite(created)||created<start||created>=end)fail();
  return {runId:a.workflow_run.id,created};
 }
 const sent=await oneArtifact(claimName+'-sent');
 const claim=await oneArtifact(claimName);
 if(sent.runId!==claim.runId||claim.created>sent.created)fail();
 const run=await get(base+'/runs/'+sent.runId);
 if(run?.id!==sent.runId||run.status!=='completed'||run.conclusion!=='success'
  ||run.head_branch!=='main'||run.head_repository?.full_name!==REPO
  ||!MORNING_PATHS.has(run.path)||run.run_attempt!==1
  ||!['schedule','workflow_run','push','workflow_dispatch'].includes(run.event))fail();
 return {date,status:'LATE_SCHEDULE_ALREADY_SENT',verifiedSent:true,
  financeWrites:0,telegramSends:0,githubReads:3};
}
