#!/usr/bin/env node
import assert from 'node:assert/strict';
import {verifyGas9291PostDeployWithRetry} from './issue860-gas9291-postdeploy-readonly.mjs';

const verified={kind:'ISSUE860_9291_POSTDEPLOY_READONLY',status:'VERIFIED',
 deployedVersion:'9.291',tradeLedgerVersion:2,tradeRows:338,
 writerGate:'OPEN',recordedActive:0,financialWrites:0,
 closeFinality:'NOT_CHECKED_BY_LIGHTWEIGHT_PROBE'};
let n=0;let waits=[];
const result=await verifyGas9291PostDeployWithRetry({
 verify:async()=>{
  n++;
  if(n===1)throw Error('ISSUE860_9291_POSTDEPLOY_PREVIOUS_VERSION_WARM');
  return verified;
 },delay:async ms=>waits.push(ms),maxChecks:4
});
assert.equal(n,2);
assert.deepEqual(waits,[3000]);
assert.equal(result.readbackAttempts,2);
assert.equal(result.onlyReadOperations,true);
assert.equal(result.closeFinality,'NOT_CHECKED_BY_LIGHTWEIGHT_PROBE');
assert.equal(result.financialWrites,0);

let network=0;
const recovered=await verifyGas9291PostDeployWithRetry({
 verify:async()=>{
  if(++network===1)throw Error('ISSUE860_9291_POSTDEPLOY_NETWORK_OR_TIMEOUT');
  return verified;
 },delay:async()=>{}
});
assert.equal(network,2);
assert.equal(recovered.readbackAttempts,2);

let exhausted=0;
await assert.rejects(()=>verifyGas9291PostDeployWithRetry({
 verify:async()=>{
  exhausted++;
  throw Error('ISSUE860_9291_POSTDEPLOY_PREVIOUS_VERSION_WARM');
 },delay:async()=>{}
}),/PREVIOUS_VERSION_WARM/);
assert.equal(exhausted,4);
for(const code of ['WEBAPP_VERSION_MISMATCH','TRADE_IDS_UNVERIFIED',
 'TRADE_LEDGER_UNVERIFIED','WRITER_GATE_NOT_IDLE','RESPONSE_UNVERIFIED']){
 let calls=0,pauses=0;
 await assert.rejects(()=>verifyGas9291PostDeployWithRetry({
  verify:async()=>{calls++;throw Error('ISSUE860_9291_POSTDEPLOY_'+code);},
  delay:async()=>{pauses++;}
 }),new RegExp(code));
 assert.equal(calls,1,code+' is not a transient warm path');
 assert.equal(pauses,0);
}
for(const mutation of [{recordedActive:1},{financialWrites:1},
 {deployedVersion:'9.289'},{tradeLedgerVersion:1},{status:'PENDING'}]){
 await assert.rejects(()=>verifyGas9291PostDeployWithRetry({
  verify:async()=>({...verified,...mutation}),delay:async()=>{}
 }),/RETRY_RESULT_INVALID/);
}
assert.equal((await verifyGas9291PostDeployWithRetry({
 verify:async()=>verified,delay:async()=>{}
})).readbackAttempts,1);
console.log('PASS #860 9.291 postflight warm instance: bounded 4 read-only checks; no GAS writes/deploy; wrong version/trade/Writer fail closed');
