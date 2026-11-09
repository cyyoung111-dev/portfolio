#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {composeIssue860Gas9289PerfCandidate} from './compose-issue860-gas9289-perf-candidate.mjs';
import {assertGasReleaseReady,assertIssue507ManualReleasePermission,
 assertIssue8609289Prerequisites,gasSourceBlobSha} from './deploy-gas.mjs';
import {verifyIssue8609289TradeV2LiveGate} from './issue860-v9289-trade-v2-live-gate.mjs';

const {parent,candidate,manifest}=composeIssue860Gas9289PerfCandidate();
assert.equal(gasSourceBlobSha(parent),'9e8584032daf896c5cffedb02041b604ee82ed07');
assert.equal(gasSourceBlobSha(candidate),'e6c0d8eba5eba8012ae761de7f436e86601b63d9');
assert.equal(assertGasReleaseReady(parent),'9.288');
assert.equal(assertGasReleaseReady(candidate),'9.289');
assert.equal(manifest.waitingOnTradeV2Release,true);
for(const args of [
 {version:'9.289',eventName:'workflow_run',approved9289:true},
 {version:'9.289',eventName:'workflow_dispatch',approved9289:false},
 {version:'9.289',eventName:'workflow_dispatch',approved9288:true}
])assert.throws(()=>assertIssue507ManualReleasePermission(args),
 /GAS_9289_EXPLICIT_MANUAL_RELEASE_REQUIRED/);
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({
 version:'9.289',eventName:'workflow_dispatch',approved9289:true}));
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({
 version:'9.289',eventName:'workflow_run',dryRun:true}));
for(const args of [
 {version:'9.289',publishedVersion:'9.287',confirmedMigrated:true},
 {version:'9.289',publishedVersion:'9.289',confirmedMigrated:true}
])assert.throws(()=>assertIssue8609289Prerequisites(args),
 /GAS_9289_REQUIRES_PUBLISHED_9288/);
assert.throws(()=>assertIssue8609289Prerequisites({
 version:'9.289',publishedVersion:'9.288',confirmedMigrated:false
}),/GAS_9289_REQUIRES_VERIFIED_TRADE_V2/);
assert.doesNotThrow(()=>assertIssue8609289Prerequisites({
 version:'9.289',publishedVersion:'9.288',confirmedMigrated:true}));
assert.doesNotThrow(()=>assertIssue8609289Prerequisites({
 version:'9.289',publishedVersion:'9.287',dryRun:true}));
assert.doesNotThrow(()=>assertIssue8609289Prerequisites({
 version:'9.288',publishedVersion:'9.287'}));
const x=fs.readFileSync('.github/workflows/gas-deploy.yml','utf8');
const y=YAML.parse(x);
for(const flag of ['use_9289_close_perf','approve_9289','confirm_9288_migration']){
 assert.equal(y.on.workflow_dispatch.inputs[flag].default,false);
 assert.equal(y.on.workflow_dispatch.inputs[flag].type,'boolean');
}
assert.match(x,/GAS_9289_CLOSE_PERF/);
assert.match(x,/GAS_9289_RELEASE_APPROVAL/);
assert.match(x,/GAS_9289_TRADE_V2_VERIFIED/);
assert.match(x,/node scripts\/issue860-v9289-trade-v2-live-gate\.mjs/);
const gate=y.jobs.deploy.steps.find(s=>String(s.name||'').includes('9.289'));
const codeIndex=y.jobs.deploy.steps.findIndex(s=>s===gate);
const deployIndex=y.jobs.deploy.steps.findIndex(s=>s.name==='Deploy GAS');
assert(gate&&codeIndex>0&&codeIndex<deployIndex);
assert(String(gate.if).includes("GAS_DEPLOY_DRY_RUN != 'true'"));
assert(String(gate.if).includes("GAS_9289_CLOSE_PERF == 'true'"));
assert.equal(gate['continue-on-error'],undefined);
const url='https://script.google.com/macros/s/TEST_DEPLOYMENT_TOKEN/exec';
const token='private-mock-token-only';
const rows=Array.from({length:338},(_,i)=>({
 id:'srv_'+i.toString(16).padStart(32,'0'),date:'2026-11-06',
 tradeType:'buy',code:'005930',qty:1,price:100
}));
const answer=(status='ok',gasVersion='9.288',trades=rows)=>({
 getAutomationStatus:{status,gasVersion,
  automation:{gasVersion,portfolioClose:{stage:'COMPLETE'},
   fundAttempt:{state:'DONE'}}},
 getTrades:{status:'ok',tradeLedgerProtocolVersion:2,ledgerRevision:'a'.repeat(64),trades}
});
async function exercise(mock,expectActions){
 const calls=[];
 const result=await verifyIssue8609289TradeV2LiveGate({
  url,token,fetchImpl:async(_url,options)=>{
   assert.equal(_url,url);
   assert.equal(options.method,'POST');
   assert.equal(options.body.get('accessToken'),token);
   const action=options.body.get('action');
   calls.push(action);
   return {ok:true,json:async()=>mock[action]};
  }
 });
 assert.deepEqual(calls,expectActions);
 return result;
}
const ok=await exercise(answer(),['getAutomationStatus','getTrades']);
assert.equal(ok.status,'VERIFIED');
assert.equal(ok.uniqueTradeRows,338);
assert.equal(ok.financeWrites,0);
assert(!JSON.stringify(ok).includes(token));
assert(!JSON.stringify(ok).includes(url));
assert(!JSON.stringify(ok).includes('srv_'));
for(const version of ['9.287','9.289','9.281']){
 const calls=[];
 await assert.rejects(()=>verifyIssue8609289TradeV2LiveGate({
  url,token,fetchImpl:async(_,options)=>{
   const action=options.body.get('action');calls.push(action);
   return {ok:true,json:async()=>answer('ok',version)[action]};
  }
 }),/ISSUE860_9289_GATE_PUBLISHED_9288_UNVERIFIED/);
 assert.deepEqual(calls,['getAutomationStatus']);
}
for(const invalid of [
 {...answer().getTrades,tradeLedgerProtocolVersion:1},
 {...answer().getTrades,ledgerRevision:'invalid'},
 {...answer().getTrades,trades:rows.slice(0,337)},
 {...answer().getTrades,trades:[...rows.slice(0,337),rows[0]]},
 {...answer().getTrades,trades:[...rows.slice(0,337),{...rows[337],id:'NO_ID'}]}
]){
 await assert.rejects(()=>exercise({...answer(),getTrades:invalid},
  ['getAutomationStatus','getTrades']),/ISSUE860_9289_GATE_(?:MIGRATED_LEDGER_NOT_VERIFIED|TRADE_IDS_UNVERIFIED)/);
}
for(const phase of ['PRICE','FUND','IN_PROGRESS']){
 const calls=[];
 await assert.rejects(()=>verifyIssue8609289TradeV2LiveGate({
  url,token,fetchImpl:async(_,options)=>{
   calls.push(options.body.get('action'));
   const z=answer();z.getAutomationStatus.automation.portfolioClose.stage=phase;
   return {ok:true,json:async()=>z[options.body.get('action')]};
  }
 }),/ISSUE860_9289_GATE_ACTIVE_WRITER/);
 assert.deepEqual(calls,['getAutomationStatus']);
}
console.log(JSON.stringify({kind:'ISSUE860_9289_LIVE_GATE_OFFLINE_PASS',
 scenarios:16,pinnedSource:true,preDeploymentGate:true,
 exactParentPublished:true,uniqueIdsRequired:338,
 unknownVersionsBlocked:true,financeWrites:0,gasDeployments:0}));
