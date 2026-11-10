#!/usr/bin/env node
import assert from 'node:assert/strict';
import {TARGETS,inspectWriterProcesses,reconcileObservedProcesses} from './issue734-writer-terminal-evidence-readonly.mjs';

assert.equal(TARGETS.length,14);
assert.equal(TARGETS.filter(x=>x.name==='_tradeV2MigrationManual_').length,3);
const scriptId='TEST_SCRIPT_123456789012345';
const token='TEST_ACCESS_TOKEN_1234567890123456789';
const base=Date.parse('2026-11-09T10:33:17Z');
const targets=[{name:'runDailyPortfolioClose1900',startedAt:base},
 {name:'_tradeV2MigrationManual_',startedAt:base+100000},
 {name:'runPortfolioCloseWatchdog2030',startedAt:base+200000}];
const p=[{name:'runDailyPortfolioClose1900',startedAt:base-5000,status:'TIMED_OUT'},
 {name:'runTradeV2MigrationPreflight',startedAt:base+96000,status:'COMPLETED'}];
const offline=reconcileObservedProcesses(targets,p);
assert.equal(offline.terminalCandidates,2);
assert.equal(offline.unresolvedCount,1);
assert.equal(offline.results[2].evidence,'NOT_OBSERVED');
assert.equal(offline.activeCleanupAuthorized,false);
assert.equal(offline.migrationApproved,false);
assert(!JSON.stringify(offline).includes(scriptId));
assert.equal(reconcileObservedProcesses(targets,[...p,{...p[0],startedAt:base+2000}]).results[0].evidence,'AMBIGUOUS');
assert.equal(reconcileObservedProcesses(targets,[{...p[0],status:'RUNNING'}]).results[0].evidence,
 'NONTERMINAL_PROCESS_CANDIDATE');

const calls=[];
const response=payload=>({ok:true,status:200,json:async()=>payload});
const mock=async(url,options)=>{
 const u=new URL(url);calls.push(u.toString());
 assert.equal(u.origin,'https://script.googleapis.com');
 assert.equal(u.pathname,'/v1/processes:listScriptProcesses');
 assert.equal(u.searchParams.get('scriptId'),scriptId);
 assert.equal(u.searchParams.get('scriptProcessFilter.startTime'),'2026-11-04T15:00:00Z');
 assert.equal(u.searchParams.get('pageSize'),'100');
 assert.equal(u.searchParams.get('scriptProcessFilter.endTime'),null,
  'Do not exclude running processes using a completion-time filter');
 assert.equal(options.method,'GET');
 assert.equal(options.redirect,'error');
 assert.equal(options.headers.Authorization,'Bearer '+token);
 assert.equal(options.body,undefined);
 const f=u.searchParams.get('scriptProcessFilter.functionName');
 if(f==='runDailyPortfolioClose1900'){
  if(!u.searchParams.has('pageToken'))return response({processes:[],nextPageToken:'P2'});
  assert.equal(u.searchParams.get('pageToken'),'P2');
  return response({processes:[{functionName:f,startTime:'2026-11-09T10:33:12Z',
   processStatus:'TIMED_OUT',projectName:'PRIVATE_PROJECT',userAccessLevel:'OWNER'}]});
 }
 if(f==='runTradeV2MigrationPreflight')return response({processes:[{
  functionName:f,startTime:'2026-11-09T10:34:53Z',processStatus:'COMPLETED'
 }]});
 if(f==='runPortfolioCloseWatchdog2030')return response({});
 throw Error('UNEXPECTED_FUNCTION');
};
const live=await inspectWriterProcesses({scriptId,token,fetchImpl:mock,targets});
assert.equal(calls.length,4);
assert.equal(live.processApiPaginationComplete,true);
assert.equal(live.terminalCandidates,2);
assert.equal(live.unresolvedCount,1);
assert.equal(live.productionWrites,0);
assert.equal(live.financeWrites,0);
assert.equal(live.activeCleanupAuthorized,false);
assert(!JSON.stringify(live).includes('PRIVATE_PROJECT'));
assert(!JSON.stringify(live).includes(token));
assert(!JSON.stringify(live).includes(scriptId));

await assert.rejects(
 ()=>inspectWriterProcesses({scriptId,token,targets:targets.slice(0,1),
  fetchImpl:async()=>({ok:false,status:403})}),
 /ISSUE734_WRITER_AUDIT_SCOPE_OR_PERMISSION/);
await assert.rejects(
 ()=>inspectWriterProcesses({scriptId,token,targets:targets.slice(0,1),
  fetchImpl:async()=>response({nextPageToken:'repeat'}),
 }),
 /ISSUE734_WRITER_AUDIT_PAGE_TOKEN/);
await assert.rejects(
 ()=>inspectWriterProcesses({scriptId,token,targets:targets.slice(0,1),
  fetchImpl:async()=>response({processes:[{functionName:'unrelated',
   startTime:'2026-11-09T10:33:17Z',processStatus:'COMPLETED'}]}),
 }),
 /ISSUE734_WRITER_AUDIT_PROCESS_SCHEMA/);
console.log(JSON.stringify({kind:'ISSUE734_WRITER_TERMINAL_EVIDENCE_SOURCE_PASS',
 cases:9,targets:TARGETS.length,paginationFailClosed:true,scopeFailureFailClosed:true,
 exactOwnerNotClaimed:true,gasWrites:0,financialWrites:0}));
