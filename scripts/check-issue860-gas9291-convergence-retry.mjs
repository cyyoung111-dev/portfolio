#!/usr/bin/env node
// Regression: after the API has published 9.291, a heavyweight
// getAutomationStatus network timeout must not cause a false rollback.
// Keep strong published-version, ledger-v2 and Writer 0 conditions.
import assert from 'node:assert/strict';
import {verifyGas9291LightweightConvergence} from './deploy-gas.mjs';
const clean={status:'VERIFIED',deployedVersion:'9.291',tradeLedgerVersion:2,
 writerGate:'OPEN',recordedActive:0,snapshotIntegrity:'PREDEPLOY_VERIFIED_NOT_RECHECKED',
 closeFinality:'NOT_CHECKED_BY_LIGHTWEIGHT_PROBE'};
let reads=0,pauses=[];
const ok=await verifyGas9291LightweightConvergence({
 verify:async()=>{reads++;if(reads===1)throw Error('ISSUE860_9291_POSTDEPLOY_NETWORK_OR_TIMEOUT');return clean;},
 pause:async ms=>pauses.push(ms),maxChecks:3
});
assert.equal(reads,2);
assert.deepEqual(pauses,[2000]);
assert.equal(ok.attempts,2);
assert.equal(ok.result.closeFinality,'NOT_CHECKED_BY_LIGHTWEIGHT_PROBE');
let wrongReads=0,wrongWaits=0;
await assert.rejects(()=>verifyGas9291LightweightConvergence({
 verify:async()=>{wrongReads++;throw Error('ISSUE860_9291_POSTDEPLOY_WEBAPP_VERSION_MISMATCH');},
 pause:async()=>wrongWaits++
}),/WEBAPP_VERSION_MISMATCH/);
assert.equal(wrongReads,1);
assert.equal(wrongWaits,0);
for(const mutation of [
 {deployedVersion:'9.290'},{tradeLedgerVersion:1},
 {writerGate:'DRAINING'},{recordedActive:1},{status:'PENDING'}
]){
 await assert.rejects(()=>verifyGas9291LightweightConvergence({
  verify:async()=>({...clean,...mutation}),pause:async()=>{} }),
 /GAS_9291_POSTDEPLOY_UNVERIFIED/);
}
let attempts=0;
await assert.rejects(()=>verifyGas9291LightweightConvergence({
 verify:async()=>{attempts++;throw Error('ISSUE860_9291_POSTDEPLOY_NETWORK_OR_TIMEOUT');},
 pause:async()=>{},maxChecks:3
}),/ISSUE860_9291_POSTDEPLOY_NETWORK_OR_TIMEOUT/);
assert.equal(attempts,3);
await assert.rejects(()=>verifyGas9291LightweightConvergence({
 verify:async()=>clean,maxChecks:0
}),/GAS_9291_CONVERGENCE_INVALID/);
console.log('PASS: v9.291 postdeploy transient read retry, fail closed wrong version/ledger/Writer, no heavy automation or finance writes');
