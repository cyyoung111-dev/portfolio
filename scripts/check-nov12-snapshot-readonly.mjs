import assert from 'node:assert/strict';
import {DATE,readNov12Snapshot,summarizeSnapshotCloseReadback}
  from './diagnose-nov12-snapshot-readonly.mjs';

const duplicateSummary=Object.fromEntries(
  ['groups','exactDuplicate','singleExpectedMatch','manualProtected',
    'unresolvedConflict','sourceIncomplete'].map(k=>[k,0]));
const arrays=Object.fromEntries(
  ['missingCodes','unexpectedCodes','duplicateKeys','qtyMismatches',
    'costAmtMismatches','evalUnitMismatches','evalAmtMismatches',
    'sourceMismatches','sourceDataErrors'].map(k=>[k,[]]));
const day={date:DATE,status:'NO_SNAPSHOT',expectedRowCount:39,
  storedRowCount:0,duplicateSummary,...arrays,
  fundNavStates:[{code:'F00001',value:123},{code:'F00002',value:456}],
  priceIntegrity:[{status:'VALID',code:'SECRET_CODE'},
    {status:'MISSING',code:'ANOTHER_SECRET'}],
  sourcePrivate:'PRIVATE_BROKER_DETAILS'
};
const packet={status:'ok',checkedDates:[DATE],diagnostics:[day]};
const summarized=summarizeSnapshotCloseReadback(packet);
assert.equal(summarized.storeStatus,'NO_SNAPSHOT');
assert.equal(summarized.expectedRows,39);
assert.equal(summarized.storedRows,0);
assert.equal(summarized.closeNotAsserted,true);
assert.equal(summarized.writes,0);
assert.equal(summarized.verifiedFunds,2);
assert.equal(summarized.priceSourceStates.VALID,1);
assert.equal(summarized.priceSourceStates.MISSING,1);
for(const secret of ['SECRET_CODE','ANOTHER_SECRET','PRIVATE_BROKER_DETAILS','F00001'])
  assert.doesNotMatch(JSON.stringify(summarized),new RegExp(secret));
assert.throws(()=>summarizeSnapshotCloseReadback({
  ...packet,checkedDates:['2026-11-11']}),/CLOSE_DATE_BAD_RESPONSE/);
assert.throws(()=>summarizeSnapshotCloseReadback({
  ...packet,diagnostics:[{...day,duplicateSummary:{...duplicateSummary,groups:-1}}]
}),/CLOSE_DATE_BAD_DUPLICATES/);
assert.throws(()=>summarizeSnapshotCloseReadback({
  ...packet,diagnostics:[{...day,sourceDataErrors:'LEAK'}]
}),/CLOSE_DATE_BAD_ARRAY/);
const valid={...day,status:'VALID',storedRowCount:39,
  priceIntegrity:[],sourceDataErrors:[]};
assert.equal(summarizeSnapshotCloseReadback({
  ...packet,diagnostics:[valid]
}).closeNotAsserted,false);
const url='https://script.google.com/macros/s/safe-snapshot-diagnostics/exec';
const calls=[];
const fetchImpl=async(u,opts)=>{
  assert.equal(u,url);
  assert.equal(opts.method,'POST');
  assert.equal(opts.body.get('action'),'diagnoseSnapshotIntegrityRange');
  assert.equal(opts.body.get('dates'),DATE);
  assert.equal(opts.body.get('strictReadonly'),'1');
  assert.equal(opts.body.get('accessToken'),'SECRET_TOKEN_123456');
  for(const action of ['apply','force','persist','save','writer'])
    assert.equal(opts.body.has(action),false);
  calls.push('READ_ONLY');
  return {ok:true,json:async()=>packet};
};
const live=await readNov12Snapshot({url,token:'SECRET_TOKEN_123456',fetchImpl});
assert.equal(live.expectedRows,39);
assert.deepEqual(calls,['READ_ONLY']);
await assert.rejects(()=>readNov12Snapshot({url,token:'',fetchImpl}),
  /CLOSE_DATE_MISSING_AUTH/);
console.log(JSON.stringify({kind:'ISSUE734_NOV12_SNAPSHOT_READONLY_CONTRACT_PASS',
  remoteReadCalls:calls.length,financeWrites:0,noPrivateLeak:true}));
