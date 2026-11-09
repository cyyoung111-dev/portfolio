#!/usr/bin/env node
import assert from 'node:assert/strict';
import {inspectProcesses,summarizeProcessPage} from './issue860-close-processes-readonly.mjs';

const scriptId='TEST_SCRIPT_ID_0123456789';
const token='ACCESS_TOKEN_PRIVATE_TEST_123456';
const first={projectName:'SECRET',functionName:'runDailyPortfolioClose1900',
 processType:'TIME_DRIVEN',processStatus:'TIMED_OUT',
 startTime:'2026-11-09T10:33:17Z',duration:'360.993s',
 userAccessLevel:'OWNER'};
const watchdog={projectName:'SECRET',functionName:'runPortfolioCloseWatchdog2030',
 processType:'TIME_DRIVEN',processStatus:'COMPLETED',
 startTime:'2026-11-09T11:37:04Z',duration:'244.001s'};
const fund={functionName:'runDeferredFundAfterPortfolioCloseFailure',
 processType:'TRIGGER',processStatus:'COMPLETED',
 startTime:'2026-11-09T11:49:43Z',duration:'12.2s'};
const safe=summarizeProcessPage({processes:[first,watchdog,fund,
 {functionName:'privateNamedMethod',projectName:'SECRET'}]});
assert.deepEqual(safe.rows.map(r=>r.kind),['REGULAR_CLOSE','WATCHDOG','FUND_DEFERRED']);
assert.equal(safe.rows[0].startKst,'19:33:17');
assert.equal(safe.rows[0].durationSec,360.993);
assert.equal(safe.rows[0].status,'TIMED_OUT');
assert.equal(safe.rows[1].startKst,'20:37:04');
assert(!JSON.stringify(safe).includes('SECRET'));
assert(!JSON.stringify(safe).includes('OWNER'));
assert(!JSON.stringify(safe).includes('privateNamedMethod'));
const emptyGoogleResponse=summarizeProcessPage({});
assert.deepEqual(emptyGoogleResponse.rows,[],'Omitted empty repeated field means no evidence, not success');

let calls=0;
const audit=await inspectProcesses({scriptId,token,fetchImpl:async(url,options)=>{
 calls++;
 const dest=new URL(url);
 assert.equal(dest.origin,'https://script.googleapis.com');
 assert.equal(dest.pathname,'/v1/processes:listScriptProcesses');
 assert.equal(dest.searchParams.get('scriptId'),scriptId);
 assert.equal(dest.searchParams.get('scriptProcessFilter.startTime'),'2026-11-09T10:25:00Z');
 assert.equal(dest.searchParams.get('scriptProcessFilter.endTime'),'2026-11-09T12:15:00Z');
 assert.equal(options.method,'GET');
 assert.equal(options.headers.Authorization,'Bearer '+token);
 assert.equal(options.redirect,'error');
 assert.equal(options.body,undefined,'Strictly no API body or mutation');
 assert.equal(dest.searchParams.get('pageToken'),calls===1?null:'NEXT');
 return {ok:true,status:200,text:async()=>JSON.stringify(calls===1?
  {processes:[first],nextPageToken:'NEXT'}:{processes:[watchdog,fund]})};
}});
assert.equal(calls,2);
assert.equal(audit.firstCloseObserved,true);
assert.equal(audit.watchdogObserved,true);
assert.deepEqual(audit.firstCloseStatuses,['TIMED_OUT']);
assert.equal(audit.resultCount,3);
assert.equal(audit.requestCount,2);
assert.equal(audit.stackVerified,false);
assert.equal(audit.ownerUidVerified,false);
assert.equal(audit.backupOwnerVerified,false);
assert.equal(audit.financeWrites,0);
assert(!JSON.stringify(audit).includes(token));
assert(!JSON.stringify(audit).includes(scriptId));
assert(!JSON.stringify(audit).includes('SECRET'));

await assert.rejects(()=>inspectProcesses({scriptId,token,
 fetchImpl:async()=>({ok:false,status:403,text:async()=>{throw Error('SECRET');}})}),
 /ISSUE860_PROCESSES_SCOPE_OR_PERMISSION/);
await assert.rejects(()=>inspectProcesses({scriptId,token,
 fetchImpl:async()=>{throw Object.assign(Error('SECRET'),{name:'TimeoutError'});}}),
 /ISSUE860_PROCESSES_TIMEOUT/);
await assert.rejects(()=>inspectProcesses({scriptId,token,
 fetchImpl:async()=>({ok:true,status:200,text:async()=>JSON.stringify(
 {processes:[],nextPageToken:'UNVERIFIED'})})}),
 /ISSUE860_PROCESSES_PAGINATION/);
assert.throws(()=>summarizeProcessPage({processes:[{
 ...first,startTime:'2026-11-10T10:33:17Z'
}]}),/ISSUE860_PROCESSES_TIME_SCHEMA/);
assert.throws(()=>summarizeProcessPage({processes:[{
 ...first,duration:'broken secret'
}]}),/ISSUE860_PROCESSES_DURATION_SCHEMA/);
console.log(JSON.stringify({kind:'ISSUE860_PROCESS_AUDIT_OFFLINE_PASS',
 scenarios:8,firstCloseAndWatchdogDistinct:true,queryIsGetOnly:true,
 paginationFailClosed:true,oauthScopeFailureSanitized:true,
 realGoogleRequests:0,gasWrites:0,financialWrites:0}));
