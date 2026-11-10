#!/usr/bin/env node
import assert from 'node:assert/strict';
import {inspectGateStatus,verifySafePublishedGateSource}
 from './issue734-gate-status-v9288-readonly.mjs';

assert.equal(verifySafePublishedGateSource(),true);
const url='https://script.google.com/macros/s/EXAMPLE_DEPLOYMENT_ID/exec';
const token='PRIVATE_TEST_AUTH_12345';
let calls=0;
const read=async(status='OPEN',count=14,version='9.288',access=true)=>{
 const report=await inspectGateStatus({url,token,fetchImpl:async(dest,options)=>{
  calls++;
  const request=new URL(dest);
  assert.equal(request.origin,'https://script.google.com');
  assert.equal(request.searchParams.get('action'),'getWriterGateStatus');
  assert.equal(request.searchParams.get('accessToken'),token);
  assert.equal(options.method,'GET');
  assert.equal(options.body,undefined);
  return {ok:true,json:async()=>({status:access?'ok':'error',
   gasVersion:version,writerGate:{mode:status,activeCount:count,
    repairAuthorized:false,approvalPresent:false}})};
 }});
 assert(!JSON.stringify(report).includes(token));
 assert(!JSON.stringify(report).includes('EXAMPLE_DEPLOYMENT_ID'));
 assert.equal(report.approvedToCleanup,false);
 assert.equal(report.approvedToMigrate,false);
 assert.equal(report.financeWrites,0);
 assert.equal(report.scriptPropertyWrites,0);
 return report;
};
const blocked=await read();
assert.equal(blocked.activeCount,14);
assert.equal(blocked.status,'GATE_BLOCKED');
const clear=await read('OPEN',0);
assert.equal(clear.status,'GATE_OPEN_NO_RECORDED_ACTIVE');
assert.equal(clear.terminalExecutionProof,false);
assert.equal((await read('DRAINING',0)).status,'GATE_BLOCKED');
for(const [mode,count,version,access] of [
 ['OPEN',-1,'9.288',true],['OPEN',0,'9.287',true],
 ['UNKNOWN',0,'9.288',true],['OPEN',0,'9.288',false]
 ]){
 await assert.rejects(()=>read(mode,count,version,access),
  /ISSUE734_GATE_STATUS_LIVE_GATE_UNVERIFIED/);
}
await assert.rejects(()=>inspectGateStatus({
 url,token,sourceCheck:()=>{throw Error('ISSUE734_GATE_STATUS_SOURCE_PIN_DRIFT');},
 fetchImpl:async()=>{throw Error('NETWORK_SHOULD_NOT_HAPPEN');}
}),/ISSUE734_GATE_STATUS_SOURCE_PIN_DRIFT/);
await assert.rejects(()=>inspectGateStatus({
 url,token,fetchImpl:async()=>({ok:false,status:403})
}),/ISSUE734_GATE_STATUS_HTTP_UNVERIFIED/);
assert.equal(calls,7);
console.log(JSON.stringify({kind:'ISSUE734_GATE_STATUS_SOURCE_PASS',
 readOnlyEndpointPinned:true,negativeScenarios:6,
 exactVersion:'9.288',permissionToMigrate:false,
 liveNetworkCalls:0,financeWrites:0,gasDeployments:0}));
