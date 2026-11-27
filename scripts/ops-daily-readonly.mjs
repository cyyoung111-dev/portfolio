// #734: manual, read-only daily operating verdict. Never a scheduler, Writer,
// GAS deploy or Telegram sender. Evidence is scoped: Telegram API-confirmed
// claim+SENT; NAV official-vs-stored GAS preview; persisted CLOSE flags.
// A successful GitHub workflow alone is NEVER treated as a completed NAV.
import {pathToFileURL} from 'node:url';
import {appendFileSync} from 'node:fs';
import {krxSessionStatus} from './krx-session-calendar.mjs';
import {verifyLateScheduledMorningSent} from './telegram-morning-late-sent-readonly.mjs';
import {verifyLateCloseSent} from './telegram-close-late-verdict.mjs';
import {auditKbNavPostflight,auditHanwhaNavPostflight} from './audit-kb-nav-postflight-readonly.mjs';
import {runBackfillStatus} from './diagnose-backfill-status.mjs';
import {auditSnapshotExact} from './issue734-snapshot-exact-readonly.mjs';

const REPO='cyyoung111-dev/portfolio',DAY=/^\d{4}-\d{2}-\d{2}$/;
function kstClock(now){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(now).map(x=>[x.type,x.value]));
 return {day:parts.year+'-'+parts.month+'-'+parts.day,
  minute:Number(parts.hour)*60+Number(parts.minute)};
}
function before(d){const t=new Date(d+'T00:00:00Z');t.setUTCDate(t.getUTCDate()-1);return t.toISOString().slice(0,10);}
export function operatingReferenceDate(now=new Date()){
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('OPS_CLOCK_UNVERIFIED');
 const {day,minute}=kstClock(now);
 if(krxSessionStatus(day)==='OPEN'&&minute>=7*60+40)return day;
 let date=day;
 for(let i=0;i<15;i++){
  date=before(date);
  if(krxSessionStatus(date)==='OPEN')return date;
  if(krxSessionStatus(date)==='UNKNOWN')break;
 }
 throw Error('OPS_TRADING_SESSION_UNVERIFIED');
}
function isDue(now,day,minute){
 const clock=kstClock(now);
 return clock.day>day||(clock.day===day&&clock.minute>=minute);
}
function safeStatus(value){return /^[A-Z0-9_]{1,90}$/.test(String(value||''))?value:'UNVERIFIED';}
// The authenticated GAS close status is independent of public fund prices.
export function verifiedPersistedClose(date,close){
 return close?.runDate===date&&close.summaryRunDate===date
  &&close.summaryPresent===true&&close.state==='COMPLETE'&&close.stage==='COMPLETE'
  &&close.priceOk===true&&close.fundOk===true
  &&close.runStale===false&&close.snapshotStale===false
  &&DAY.test(close.expectedRunDate||'')&&close.expectedRunDate<=date
  &&DAY.test(close.expectedSnapshotDate||'')&&close.expectedSnapshotDate<=date;
}
export function classifyDailyOperations({date,now,morningProof,closeProof,navRuns,navReport,hanwhaReport,closeStatus,snapshotEvidence}){
 if(!DAY.test(date)||krxSessionStatus(date)!=='OPEN'
    ||!(now instanceof Date)||!Number.isFinite(now.getTime())
    ||date>kstClock(now).day)throw Error('OPS_CLASSIFY_INVALID');
 const telegram=(verified,due,scope)=>({
  state:verified?'PASS':due?'EVIDENCE_MISSING':'WAITING',
  scope,verified:verified===true
 });
 const morning=telegram(morningProof===true,isDue(now,date,490),'TRUSTED_CLAIM_AND_SENT');
 const close=telegram(closeProof===true,isDue(now,date,1080),'TRUSTED_CLAIM_AND_SENT');
 const navDue=isDue(now,date,21*60+10);
 const classifyFund=(report,scope)=>{
  const exact=report?.closeDate===date
   &&report?.officialReferenceDate===date
   &&report?.navWorkflowStatus==='NAV_DATA_VERIFIED'
   &&report?.officialNavMatched===true
   &&report?.storedNavConfirmed===true
   &&report?.derivedConfirmed===true;
  // A delayed or stale source must not turn a published-but-missing NAV
  // into a harmless publication delay.
  const pending=report?.navWorkflowStatus==='OFFICIAL_NAV_AWAITING_PUBLICATION'
   &&report?.officiallyPublished===false
   &&report?.officialReferenceDate===date
   &&report?.closeDate===date
   &&report?.closeDateVerified===true
   &&report?.runStale===false&&report?.snapshotStale===false;
  return {state:exact?'PASS':!navDue?'WAITING':pending?'PUBLICATION_PENDING':'EVIDENCE_MISSING',
   scope,verified:exact,execution:safeStatus(navRuns)};
 };
 const nav=classifyFund(navReport,'KB_OFFICIAL_NAV_AND_DERIVED');
 // Never infer Hanwha from a green KB collector or from the shared close.
 const hanwha=classifyFund(hanwhaReport?.kind==='HANWHA_NAV_CLOSE_POSTFLIGHT_READ_ONLY'
   &&hanwhaReport.code==='F00001'?hanwhaReport:null,'HANWHA_OFFICIAL_NAV_AND_DERIVED');
 // A supplied authenticated checkpoint must not be overridden by a fund
 // report. Legacy fixture/caller evidence is accepted only when no direct
 // checkpoint argument was supplied.
 const closePersisted=closeStatus!==undefined?verifiedPersistedClose(date,closeStatus):
  navReport?.closeDate===date&&navReport?.closeComplete===true
  &&navReport?.priceOk===true&&navReport?.fundOk===true;
 // An unpublished official NAV is not a failed price close. Distinguish
 // only the exact current KRX session's persisted FUND_PENDING checkpoint,
 // never a stale date, unrelated close error, or a published-but-missing NAV.
 // This is a pending label, NOT success or authorization to write data.
 const fundPublicationPending=(hanwha.state==='PASS'||hanwha.state==='PUBLICATION_PENDING')
  &&nav.state==='PUBLICATION_PENDING'
  &&navReport?.closeDate===date
  &&navReport?.officialReferenceDate===date
  &&navReport?.officiallyPublished===false
  &&navReport?.closeState==='INCOMPLETE'
  &&navReport?.closeDateVerified===true
  &&navReport?.runStale===false&&navReport?.snapshotStale===false
  &&navReport?.fundCloseCheckpointEvidence?.closeStage==='FUND_PENDING'
  &&navReport?.priceOk===true&&navReport?.fundOk===false
  &&navReport?.closeComplete===false;
 const savedClose={state:closePersisted?'PASS':
   !isDue(now,date,21*60)?'WAITING':
   fundPublicationPending?'FUND_PUBLICATION_PENDING':'EVIDENCE_MISSING',
  scope:'GAS_PERSISTED_CLOSE_FLAGS_NOT_ALL_SNAPSHOT_ROWS',
  verified:closePersisted};
 const snapOk=snapshotEvidence?.date===date&&snapshotEvidence?.state==='VERIFIED'
   &&snapshotEvidence.internalRevaluationVerified===true
   &&snapshotEvidence.externalWriterExcludedVerified===false
   &&snapshotEvidence.exactWriterOwnerVerified===false
   &&snapshotEvidence.financialWrites===0;
 const snapshot={state:snapOk?'PASS':'NOT_FULLY_AUDITED',verified:snapOk,
  scope:'GAS_STORED_VS_RECOMPUTED_SNAPSHOT_NOT_EXTERNAL_WRITER_OR_OFFICIAL_PRICE',
  storedRows:snapOk?snapshotEvidence.storedRows:null};
 const coreVerified=morning.verified&&close.verified&&nav.verified&&hanwha.verified&&savedClose.verified;
 return {kind:'PORTFOLIO_DAILY_OPERATIONS_READ_ONLY',date,
  morningTelegram:morning,closeTelegram:close,kbNav:nav,hanwhaNav:hanwha,
  savedClose,snapshot,
  overall:coreVerified?(snapOk?'CORE_AND_SNAPSHOT_INTERNAL_VERIFIED_WRITER_UNAUDITED'
    :'CORE_CHECKPOINTS_VERIFIED_SNAPSHOT_UNAUDITED'):'CORE_EVIDENCE_INCOMPLETE',
  writerOwnershipVerified:false,externalWriterExcludedVerified:false,
  financialWrites:0,gasWrites:0,telegramSends:0,deployments:0};
}
// Observing an admitted workflow run only says execution was attempted.
// source-public on a push and skipped postflight are explicitly NOT NAV
// success. Do not request GitHub job logs, private account values or artifacts.
function acceptedNavRuns(runs,date){
 return runs.filter(r=>
  r?.head_branch==='main'&&r?.run_attempt===1
  &&['schedule','workflow_dispatch'].includes(r.event)
  &&Number.isSafeInteger(r.id)&&Number.isFinite(Date.parse(r.created_at))
  &&kstClock(new Date(r.created_at)).day===date);
}
export function classifyNavRuns(runs,jobsByRunId,date){
 if(!Array.isArray(runs)||runs.length>100)return 'RUN_LIST_UNVERIFIED';
 const candidates=acceptedNavRuns(runs,date);
 if(!candidates.length)return 'NO_ACCEPTED_EXECUTION_OBSERVED';
 let failing=false,completed=false,active=false;
 for(const run of candidates){
  if(['queued','in_progress','waiting','requested','pending'].includes(run.status)){
   active=true;continue;
  }
  const jobs=jobsByRunId?.[run.id];
  if(!Array.isArray(jobs)||run.status!=='completed')continue;
  const relevant=['collect','hanwha-collect','postflight-readonly'];
  const mapped=relevant.map(name=>{
   const matches=jobs.filter(j=>j.name===name);
   return matches.length===1?matches[0]:null;
  });
  // Public-source failures may make the entire run red even when all
  // three private jobs succeeded. This label certifies execution ONLY.
  if(mapped.every(j=>j?.status==='completed'&&j.conclusion==='success'))completed=true;
  else if(mapped.some(j=>j?.status==='completed'&&j.conclusion==='failure'))failing=true;
 }
 return completed?'ALL_NAV_JOBS_EXECUTED_NOT_DATA_VERIFIED'
  :active?'NAV_EXECUTION_IN_PROGRESS'
  :failing?'NAV_EXECUTION_FAILED':'NAV_EXECUTION_UNVERIFIED';
}
async function navRunnerEvidence({token,date,fetchImpl=fetch}){
 if(typeof token!=='string'||!token)return 'RUN_LIST_UNVERIFIED';
 const headers={authorization:'Bearer '+token,accept:'application/vnd.github+json'};
 const get=async path=>{
  const resp=await fetchImpl('https://api.github.com/repos/'+REPO+path,{
   method:'GET',redirect:'error',headers,signal:AbortSignal.timeout(12000)});
  if(!resp.ok)throw Error('OPS_RUN_SOURCE_UNVERIFIED');
  return resp.json();
 };
 try{
  // Query a single KST day in UTC, not the repository's entire lifetime
  // (which exceeds 100 historical runs and would always be "unverified").
  const from=new Date(date+'T00:00:00+09:00');
  const until=new Date(from.getTime()+86400000-1000);
  const created=from.toISOString().replace('.000Z','Z')+'..'+
    until.toISOString().replace('.000Z','Z');
  const data=await get('/actions/workflows/kb-fund-nav-collect.yml/runs?branch=main&created='+
    encodeURIComponent(created)+'&per_page=100');
  if(!Array.isArray(data?.workflow_runs)||data.workflow_runs.length>100
     ||Number(data.total_count)>100)return 'RUN_LIST_UNVERIFIED';
  // Exclude public-only pushes, retired triggers, reruns and other
  // branches before applying the bounded private-evidence read budget.
  const interested=acceptedNavRuns(data.workflow_runs,date);
  const terminal=interested.filter(r=>r.status==='completed');
  if(terminal.length>12)return 'RUN_LIST_UNVERIFIED';
  const jobs={};
  for(const r of terminal){
   const d=await get('/actions/runs/'+r.id+'/jobs?per_page=100');
   if(!Array.isArray(d?.jobs)||d.total_count>100)
    return 'RUN_LIST_UNVERIFIED';
   jobs[r.id]=d.jobs;
  }
  return classifyNavRuns(data.workflow_runs,jobs,date);
 }catch{return 'RUN_LIST_UNVERIFIED';}
}
export async function runDailyOperations({
 now=new Date(),repository=REPO,token,gasUrl,gasToken,
 fetchImpl=fetch,navReader=auditKbNavPostflight,hanwhaReader=auditHanwhaNavPostflight,
 statusReader=runBackfillStatus,morningReader=verifyLateScheduledMorningSent,
 closeReader=verifyLateCloseSent,
 navRunReader=navRunnerEvidence,snapshotReader=auditSnapshotExact}={}){
 if(repository!==REPO)throw Error('OPS_REPOSITORY_UNVERIFIED');
 const date=operatingReferenceDate(now);
 const morningDue=isDue(now,date,490),closeDue=isDue(now,date,1080),
  navDue=isDue(now,date,21*60+10);
 let morningProof=false,closeProof=false,navReport=null,hanwhaReport=null,snapshotEvidence=null,closeStatus=null;
 if(morningDue){
  try{const p=await morningReader({date,repository,token,fetchImpl});morningProof=p?.verifiedSent===true;}
  catch{morningProof=false;}
 }
 if(closeDue){
  try{
   // Explicit same trading date within the KRX close window, even when
   // running an audit on the following weekend or early next business day.
   const proofTime=new Date(date+'T20:00:00+09:00');
   const p=await closeReader({now:proofTime,repository,token,fetchImpl});
   closeProof=p?.date===date&&p?.verified===true;
  }catch{closeProof=false;}
 }
 const navRuns=navDue?await navRunReader({date,token,fetchImpl}):'NOT_DUE';
 if(navDue&&gasUrl&&gasToken){
  // Share the authenticated close checkpoint, not the fund-specific public
  // source or exact NAV/derived readback. A failure in KB cannot skip Hanwha.
  let sharedStatus;
  const readStatus=args=>sharedStatus??=(Promise.resolve().then(()=>statusReader(args)));
  const options={now,url:gasUrl,token:gasToken,fetchImpl,statusReader:readStatus};
  try{closeStatus=(await readStatus({url:gasUrl,token:gasToken,fetchImpl}))?.close??null;}catch{}
  try{navReport=await navReader(options);}catch{navReport=null;}
  try{hanwhaReport=await hanwhaReader(options);}catch{hanwhaReport=null;}
 }
 // Only after the verified close checkpoint: never fetch a partial snapshot
 // while a financial Writer could still be in its closing window.
 if(navDue&&gasUrl&&gasToken&&verifiedPersistedClose(date,closeStatus)) {
   try{snapshotEvidence=await snapshotReader({date,url:gasUrl,token:gasToken,fetchImpl});}
   catch{snapshotEvidence=null;}
 }
 return classifyDailyOperations({
  date,now,morningProof,closeProof,navRuns,navReport,hanwhaReport,closeStatus,snapshotEvidence
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length!==2||process.env.GITHUB_EVENT_NAME!=='workflow_dispatch'
    ||process.env.GITHUB_REF!=='refs/heads/main'
    ||process.env.GITHUB_REPOSITORY!==REPO)
   throw Error('OPS_MANUAL_MAIN_ONLY');
  const summary=await runDailyOperations({
   repository:process.env.GITHUB_REPOSITORY,
   token:process.env.GITHUB_TOKEN,
   gasUrl:process.env.GAS_WEB_APP_URL,gasToken:process.env.GAS_ACCESS_TOKEN
  });
  console.log(JSON.stringify(summary));
  if(process.env.GITHUB_STEP_SUMMARY){
   const fields=['morningTelegram','closeTelegram','kbNav','hanwhaNav','savedClose','snapshot'];
   appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    '### Daily portfolio evidence (read only)\n'+
    fields.map(k=>'- '+k+': **'+summary[k].state+'** ('+summary[k].scope+')').join('\n')+
    '\nOverall: **'+summary.overall+'**. Snapshot is internal reconciliation only; external writer exclusion and official price origin remain unverified.\n');
  }
  if(!['CORE_CHECKPOINTS_VERIFIED_SNAPSHOT_UNAUDITED',
   'CORE_AND_SNAPSHOT_INTERNAL_VERIFIED_WRITER_UNAUDITED'].includes(summary.overall))
   process.exitCode=2;
 }catch{
  console.error('OPS_DAILY_VERDICT_UNVERIFIED');process.exitCode=2;
 }
}
