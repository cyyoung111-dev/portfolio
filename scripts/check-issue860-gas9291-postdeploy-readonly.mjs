#!/usr/bin/env node
import assert from 'node:assert/strict';
import {verifyGas9291PostDeploy} from './issue860-gas9291-postdeploy-readonly.mjs';
const url='https://script.google.com/macros/s/TEST_9291_POSTDEPLOY/exec';
const token='POSTDEPLOY_MOCK_TOKEN';
const date='2026-11-10';
const trades=Array.from({length:338},(_,i)=>({
 id:'srv_'+i.toString(16).padStart(32,'0'),date,qty:1,price:100}));
const good={
 getSettings:{status:'ok',gasVersion:'9.291',settings:{portfolioVersion:'v2'}},
 getTrades:{status:'ok',tradeLedgerProtocolVersion:2,ledgerRevision:'a'.repeat(64),trades},
 getWriterGateStatus:{status:'ok',gasVersion:'9.291',
  writerGate:{mode:'OPEN',activeCount:0,repairAuthorized:false}}
};
async function check(payload=good){
 const calls=[];
 const r=await verifyGas9291PostDeploy({url,token,fetchImpl:async(dest,opts)=>{
  const get=opts.method==='GET';
  const action=get?new URL(dest).searchParams.get('action'):opts.body.get('action');
  calls.push(action);
  assert.equal(get?new URL(dest).searchParams.get('accessToken'):opts.body.get('accessToken'),token);
  assert(['getSettings','getTrades','getWriterGateStatus'].includes(action));
  return {ok:true,json:async()=>payload[action]};
 }});
 assert.deepEqual(calls,['getSettings','getTrades','getWriterGateStatus']);
 return r;
}
const ok=await check();
assert.equal(ok.status,'VERIFIED');
assert.equal(ok.tradeRows,338);
assert.equal(ok.deployedVersion,'9.291');
assert.equal(ok.closeFinality,'NOT_CHECKED_BY_LIGHTWEIGHT_PROBE');
assert.equal(ok.fundAttemptState,'NOT_CHECKED_BY_LIGHTWEIGHT_PROBE');
assert.equal(ok.snapshotIntegrity,'PREDEPLOY_VERIFIED_NOT_RECHECKED');
assert.equal(ok.closeMarkedCompleteByProbe,false);
assert.equal(ok.financialWrites,0);
const exercise=async(payload,regex)=>{
 await assert.rejects(()=>check(payload),regex);
};
await exercise({...good,getSettings:{...good.getSettings,gasVersion:'9.289'}},
 /PREVIOUS_VERSION_WARM/);
await exercise({...good,getWriterGateStatus:{...good.getWriterGateStatus,gasVersion:'9.289'}},
 /PREVIOUS_VERSION_WARM/);
await exercise({...good,getSettings:{...good.getSettings,gasVersion:'9.290'}},
 /WEBAPP_VERSION_MISMATCH/);
await exercise({...good,getSettings:{...good.getSettings,settings:null}},
 /WEBAPP_VERSION_MISMATCH/);
await exercise({...good,getTrades:{...good.getTrades,trades:[...trades.slice(0,-1),trades[0]]}},
 /TRADE_IDS_UNVERIFIED/);
await exercise({...good,getWriterGateStatus:{...good.getWriterGateStatus,
 writerGate:{...good.getWriterGateStatus.writerGate,activeCount:1}}},/WRITER_GATE_NOT_IDLE/);
console.log('PASS v9.291 post-deploy: lightweight verified version, v2 ledger, Writer idle; heavy snapshot/fund/close status explicitly deferred');
