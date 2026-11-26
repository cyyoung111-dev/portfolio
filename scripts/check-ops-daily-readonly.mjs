// Fixtures only: no network, GAS writes, Telegram or finance mutation.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import YAML from 'yaml';
import {operatingReferenceDate,classifyDailyOperations,
 classifyNavRuns,runDailyOperations} from './ops-daily-readonly.mjs';
const at=s=>new Date(s);
const fri='2026-11-13',mon='2026-11-16';
assert.equal(operatingReferenceDate(at('2026-11-14T23:01:00+09:00')),fri);
assert.equal(operatingReferenceDate(at('2026-11-15T02:30:00+09:00')),fri);
assert.equal(operatingReferenceDate(at('2026-11-16T07:39:00+09:00')),fri);
assert.equal(operatingReferenceDate(at('2026-11-16T07:40:00+09:00')),mon);
assert.throws(()=>operatingReferenceDate(at('invalid')),/OPS_CLOCK/);
const evidence={
 closeDate:fri,officialReferenceDate:fri,navWorkflowStatus:'NAV_DATA_VERIFIED',
 officialNavMatched:true,storedNavConfirmed:true,derivedConfirmed:true,
 closeComplete:true,priceOk:true,fundOk:true
};
const now=at('2026-11-13T21:30:00+09:00');
const proof=classifyDailyOperations({date:fri,now,morningProof:true,
 closeProof:true,navRuns:'ALL_NAV_JOBS_EXECUTED_NOT_DATA_VERIFIED',
 navReport:evidence});
assert.equal(proof.overall,'CORE_CHECKPOINTS_VERIFIED_SNAPSHOT_UNAUDITED');
assert.equal(proof.kbNav.state,'PASS');
assert.equal(proof.kbNav.execution,'ALL_NAV_JOBS_EXECUTED_NOT_DATA_VERIFIED');
assert.equal(proof.savedClose.state,'PASS');
assert.equal(proof.snapshot.state,'NOT_FULLY_AUDITED');
const exactSnapshot={date:fri,state:'VERIFIED',storedRows:39,
 internalRevaluationVerified:true,externalWriterExcludedVerified:false,
 exactWriterOwnerVerified:false,financialWrites:0};
const withSnapshot=classifyDailyOperations({date:fri,now,morningProof:true,
 closeProof:true,navRuns:'ALL_NAV_JOBS_EXECUTED_NOT_DATA_VERIFIED',
 navReport:evidence,snapshotEvidence:exactSnapshot});
assert.equal(withSnapshot.snapshot.state,'PASS');
assert.equal(withSnapshot.snapshot.storedRows,39);
assert.equal(withSnapshot.overall,'CORE_AND_SNAPSHOT_INTERNAL_VERIFIED_WRITER_UNAUDITED');
assert.equal(withSnapshot.externalWriterExcludedVerified,false);
for(const bad of [
 {...exactSnapshot,date:'2026-11-12'},
 {...exactSnapshot,externalWriterExcludedVerified:true},
 {...exactSnapshot,exactWriterOwnerVerified:true},
 {...exactSnapshot,financialWrites:1},
 {...exactSnapshot,state:'INCOMPLETE_OR_MISMATCH'}
])assert.equal(classifyDailyOperations({date:fri,now,morningProof:true,
 closeProof:true,navRuns:'ALL_NAV_JOBS_EXECUTED_NOT_DATA_VERIFIED',
 navReport:evidence,snapshotEvidence:bad}).snapshot.state,'NOT_FULLY_AUDITED');
assert.equal(proof.financialWrites,0);
assert.equal(proof.telegramSends,0);
const noProof=classifyDailyOperations({date:fri,now,morningProof:false,
 closeProof:false,navRuns:'ALL_NAV_JOBS_EXECUTED_NOT_DATA_VERIFIED'});
assert.equal(noProof.kbNav.state,'EVIDENCE_MISSING',
 'green runner must not certify NAV data');
assert.equal(noProof.savedClose.state,'EVIDENCE_MISSING');
assert.equal(noProof.closeTelegram.state,'EVIDENCE_MISSING');
assert.equal(noProof.morningTelegram.state,'EVIDENCE_MISSING');
assert.equal(noProof.overall,'CORE_EVIDENCE_INCOMPLETE');
const notDue=classifyDailyOperations({date:mon,now:at('2026-11-16T08:00:00+09:00'),
 morningProof:false,closeProof:false,navRuns:'NOT_DUE'});
assert.equal(notDue.morningTelegram.state,'WAITING');
assert.equal(notDue.closeTelegram.state,'WAITING');
assert.equal(notDue.kbNav.state,'WAITING');
const publisherReport={
 ...evidence,navWorkflowStatus:'OFFICIAL_NAV_AWAITING_PUBLICATION',
 officiallyPublished:false,closeDateVerified:true,
 runStale:false,snapshotStale:false,
 officialNavMatched:false,storedNavConfirmed:false
};
const publisher=classifyDailyOperations({date:fri,now,morningProof:true,
 closeProof:true,navRuns:'NAV_EXECUTION_FAILED',navReport:publisherReport});
assert.equal(publisher.kbNav.state,'PUBLICATION_PENDING');
for(const bad of [
 {officiallyPublished:true},
 {officialReferenceDate:'2026-11-12'},
 {closeDate:'2026-11-12'},
 {closeDateVerified:false},
 {runStale:true},
 {snapshotStale:true}
]){
 const mismatched=classifyDailyOperations({date:fri,now,morningProof:true,
  closeProof:true,navRuns:'NAV_EXECUTION_FAILED',
  navReport:{...publisherReport,...bad}});
 assert.equal(mismatched.kbNav.state,'EVIDENCE_MISSING',
  'published, stale or unverified source cannot masquerade as pending');
}
// Production-shaped 2026-11-17 05:34 postflight: 11/16 stored GAS close
// COMPLETE with carried 11/13 NAV, but 11/16 official NAV is not published.
// The persisted-close checkpoint is real; official NAV verification is not.
const completedWithUnpublishedNav=classifyDailyOperations({
 date:mon,now:at('2026-11-17T05:34:43+09:00'),morningProof:true,
 closeProof:true,navRuns:'NAV_EXECUTION_FAILED',
 navReport:{
  ...publisherReport,closeDate:mon,officialReferenceDate:mon,
  closeState:'COMPLETE',closeComplete:true,priceOk:true,fundOk:true,
  derivedConfirmed:true,officiallyPublished:false,
  fundCloseCheckpointEvidence:{closeStage:'COMPLETE'}
 },
 snapshotEvidence:{...exactSnapshot,date:mon}
});
assert.equal(completedWithUnpublishedNav.savedClose.state,'PASS');
assert.equal(completedWithUnpublishedNav.kbNav.state,'PUBLICATION_PENDING');
assert.equal(completedWithUnpublishedNav.kbNav.verified,false);
assert.equal(completedWithUnpublishedNav.snapshot.state,'PASS');
assert.equal(completedWithUnpublishedNav.overall,'CORE_EVIDENCE_INCOMPLETE',
 'stored complete cannot certify unpublished official NAV');
// Current official NAV may be unpublished at 21:10 even though all 37
// regular-market prices and today's Snapshot are already persisted.
// Report a separate pending state, never a false PASS or a generic missing
// proof alarm. Unrelated errors and stale/mismatched dates still fail closed.
const unpublishedClose={
 ...evidence,
 officiallyPublished:false,officialReferenceDate:fri,
 navWorkflowStatus:'OFFICIAL_NAV_AWAITING_PUBLICATION',
 officialNavMatched:false,storedNavConfirmed:false,derivedConfirmed:false,
 closeState:'INCOMPLETE',closeDateVerified:true,
 runStale:false,snapshotStale:false,
 fundCloseCheckpointEvidence:{closeStage:'FUND_PENDING'},
 closeComplete:false,priceOk:true,fundOk:false
};
const awaiting=classifyDailyOperations({date:fri,now,morningProof:true,
 closeProof:true,navRuns:'NAV_EXECUTION_FAILED',navReport:unpublishedClose});
assert.equal(awaiting.kbNav.state,'PUBLICATION_PENDING');
assert.equal(awaiting.savedClose.state,'FUND_PUBLICATION_PENDING');
assert.equal(awaiting.savedClose.verified,false);
assert.equal(awaiting.overall,'CORE_EVIDENCE_INCOMPLETE',
 'unpublished fund NAV is a pending item, never a certified close');
for(const unhealthy of [
 {officiallyPublished:true},
 {closeState:'ERROR'},
 {closeDateVerified:false},
 {runStale:true},
 {snapshotStale:true},
 {fundCloseCheckpointEvidence:{closeStage:'ERROR'}},
 {fundCloseCheckpointEvidence:null},
 {officialReferenceDate:'2026-11-12'},
 {closeDate:'2026-11-12'},
 {priceOk:false},
 {fundOk:true},
 {closeComplete:true}
]){
 const res=classifyDailyOperations({date:fri,now,morningProof:true,
  closeProof:true,navRuns:'NAV_EXECUTION_FAILED',
  navReport:{...unpublishedClose,...unhealthy}});
 assert.equal(res.savedClose.state,'EVIDENCE_MISSING',
  'bad close must never be downgraded to publication pending: '
   +JSON.stringify(unhealthy));
 assert.equal(res.overall,'CORE_EVIDENCE_INCOMPLETE');
}

const stale=classifyDailyOperations({date:fri,now,morningProof:true,
 closeProof:true,navRuns:'ALL_NAV_JOBS_EXECUTED_NOT_DATA_VERIFIED',
 navReport:{...evidence,closeDate:'2026-11-12'}});
assert.equal(stale.kbNav.state,'EVIDENCE_MISSING');
assert.equal(stale.savedClose.state,'EVIDENCE_MISSING');
assert.throws(()=>classifyDailyOperations({date:'2026-11-14',now}),
 /OPS_CLASSIFY_INVALID/);
const run={id:123,head_branch:'main',run_attempt:1,event:'schedule',
 created_at:'2026-11-13T01:30:00Z',status:'completed',conclusion:'success'};
const jobs={123:['collect','hanwha-collect','postflight-readonly'].map(
 name=>({name,status:'completed',conclusion:'success'}))};
assert.equal(classifyNavRuns([run],jobs,fri),
 'ALL_NAV_JOBS_EXECUTED_NOT_DATA_VERIFIED');
assert.equal(classifyNavRuns([{...run,event:'push'}],jobs,fri),
 'NO_ACCEPTED_EXECUTION_OBSERVED');
assert.equal(classifyNavRuns([{...run,event:'workflow_run'}],jobs,fri),
 'NO_ACCEPTED_EXECUTION_OBSERVED',
 'retired KRX-triggered collector is not evidence of allowed NAV execution');
assert.equal(classifyNavRuns([{...run,head_branch:'feature'}],jobs,fri),
 'NO_ACCEPTED_EXECUTION_OBSERVED');
// A public-only failure can mark the overall run red; private execution
// and exact financial data verification are independent verdicts.
assert.equal(classifyNavRuns([{...run,conclusion:'failure'}],jobs,fri),
 'ALL_NAV_JOBS_EXECUTED_NOT_DATA_VERIFIED');
const privateFailure={123:jobs[123].map(j=>j.name==='collect'?{...j,conclusion:'failure'}:j)};
assert.equal(classifyNavRuns([{...run,conclusion:'failure'}],privateFailure,fri),
 'NAV_EXECUTION_FAILED');
assert.equal(classifyNavRuns([{...run,conclusion:'failure'}],{123:[{name:'source-public',status:'completed',conclusion:'failure'}]},fri),
 'NAV_EXECUTION_UNVERIFIED');
assert.equal(classifyNavRuns([{...run,status:'queued',conclusion:null}],{},fri),
 'NAV_EXECUTION_IN_PROGRESS');
assert.equal(classifyNavRuns([run,{...run,id:124,status:'in_progress',conclusion:null}],privateFailure,fri),
 'NAV_EXECUTION_IN_PROGRESS');
assert.equal(classifyNavRuns([run],{123:[...jobs[123],jobs[123][0]]},fri),
 'NAV_EXECUTION_UNVERIFIED');
let jobReads=[];
const pushRuns=Array.from({length:8},(_,i)=>({...run,id:200+i,event:'push'}));
const retired={...run,id:300,event:'workflow_run'};
const noisyAudit=await runDailyOperations({
 now:at('2026-11-13T22:30:00+09:00'),token:'synthetic',
 morningReader:async()=>({verifiedSent:true}),
 closeReader:async()=>({date:fri,verified:true}),
 fetchImpl:async url=>{
  if(url.includes('/workflows/kb-fund-nav-collect.yml/runs?'))
   return {ok:true,json:async()=>({total_count:10,workflow_runs:[...pushRuns,retired,run]})};
  jobReads.push(url);
  assert.match(url,/\/actions\/runs\/123\/jobs\?per_page=100$/);
  return {ok:true,json:async()=>({total_count:3,jobs:jobs[123]})};
 }
});
assert.equal(jobReads.length,1,'ineligible source-only runs must not exhaust private evidence budget');
assert.equal(noisyAudit.kbNav.execution,'ALL_NAV_JOBS_EXECUTED_NOT_DATA_VERIFIED');
assert.equal(noisyAudit.kbNav.state,'EVIDENCE_MISSING','execution is not NAV storage proof');
assert.equal(classifyNavRuns([run],{123:jobs[123].slice(0,1)},fri),
 'NAV_EXECUTION_UNVERIFIED');
let observed=[];
const result=await runDailyOperations({now:at('2026-11-14T23:01:00+09:00'),
 repository:'cyyoung111-dev/portfolio',token:'test-read-only',
 gasUrl:'https://example.invalid',gasToken:'test',
 morningReader:async args=>{observed.push('morning:'+args.date);
  return {verifiedSent:true};},
 closeReader:async args=>{observed.push('close:'+args.now.toISOString());
  return {date:fri,verified:true};},
 navRunReader:async()=>{observed.push('runs');return 'ALL_NAV_JOBS_EXECUTED_NOT_DATA_VERIFIED';},
 navReader:async()=>{observed.push('readback');return evidence;},
 snapshotReader:async({date})=>{
  observed.push('snapshot:'+date);return exactSnapshot;
 }
});
assert.equal(result.overall,'CORE_AND_SNAPSHOT_INTERNAL_VERIFIED_WRITER_UNAUDITED');
assert.equal(result.date,fri);
assert.equal(result.snapshot.verified,true);
assert.deepEqual(observed[0],'morning:'+fri);
assert.deepEqual(observed.slice(2),['runs','readback','snapshot:'+fri]);
const failedSnapshot=await runDailyOperations({now:at('2026-11-14T23:01:00+09:00'),
 repository:'cyyoung111-dev/portfolio',token:'test-read-only',
 gasUrl:'https://example.invalid',gasToken:'test',
 morningReader:async()=>({verifiedSent:true}),
 closeReader:async()=>({date:fri,verified:true}),
 navRunReader:async()=> 'ALL_NAV_JOBS_EXECUTED_NOT_DATA_VERIFIED',
 navReader:async()=>evidence,
 snapshotReader:async()=>{throw Error('PRIVATE_SOURCE_ERROR')}
});
assert.equal(failedSnapshot.snapshot.state,'NOT_FULLY_AUDITED');
assert.equal(failedSnapshot.overall,'CORE_CHECKPOINTS_VERIFIED_SNAPSHOT_UNAUDITED');
const noCredentials=await runDailyOperations({
 now:at('2026-11-14T23:01:00+09:00'),
 token:null,gasUrl:null,gasToken:null,
 morningReader:async()=>{throw Error('no signal')},
 closeReader:async()=>{throw Error('no signal')},
 navRunReader:async()=> 'RUN_LIST_UNVERIFIED',
 navReader:async()=>{throw Error('must not be invoked without credentials')}
});
assert.equal(noCredentials.overall,'CORE_EVIDENCE_INCOMPLETE');
assert.equal(noCredentials.kbNav.state,'EVIDENCE_MISSING');
const y=YAML.parse(readFileSync('.github/workflows/portfolio-daily-ops-readonly.yml','utf8'));
assert.deepEqual(Object.keys(y.on),['workflow_dispatch'],
 'no new cron, branch push or writer trigger');
assert.equal(y.permissions.contents,'read');
assert.equal(y.permissions.actions,'read');
assert.equal(y.jobs.verdict.environment,'portfolio-production-gas');
const source=readFileSync('scripts/ops-daily-readonly.mjs','utf8');
assert.match(source,/GITHUB_EVENT_NAME!=='workflow_dispatch'/);
assert.match(source,/financialWrites:0,gasWrites:0,telegramSends:0,deployments:0/);
assert.doesNotMatch(source,/workflow_dispatch.*POST|sendMessage|saveSnapshot|collectHanwhaFundNav/);
console.log('OPS_DAILY_READONLY_VERDICT_PASS date, trusted SENT, NAV stored proof, GAS persisted close, no-cron/no-writes');
