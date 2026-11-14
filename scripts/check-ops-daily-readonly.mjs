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
const publisher=classifyDailyOperations({date:fri,now,morningProof:true,
 closeProof:true,navRuns:'NAV_EXECUTION_FAILED',navReport:{
 ...evidence,navWorkflowStatus:'OFFICIAL_NAV_AWAITING_PUBLICATION',
 officialNavMatched:false,storedNavConfirmed:false}});
assert.equal(publisher.kbNav.state,'PUBLICATION_PENDING');
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
assert.equal(classifyNavRuns([{...run,head_branch:'feature'}],jobs,fri),
 'NO_ACCEPTED_EXECUTION_OBSERVED');
assert.equal(classifyNavRuns([{...run,conclusion:'failure'}],jobs,fri),
 'NAV_EXECUTION_FAILED');
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
 navReader:async()=>{observed.push('readback');return evidence;}
});
assert.equal(result.overall,'CORE_CHECKPOINTS_VERIFIED_SNAPSHOT_UNAUDITED');
assert.equal(result.date,fri);
assert.deepEqual(observed[0],'morning:'+fri);
assert.deepEqual(observed.slice(2),['runs','readback']);
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
