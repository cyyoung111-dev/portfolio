#!/usr/bin/env node
import assert from 'node:assert/strict';
import {verifyGas9291PostDeploy} from './issue860-gas9291-postdeploy-readonly.mjs';
const url='https://script.google.com/macros/s/TEST_9291_POSTDEPLOY/exec';
const token='POSTDEPLOY_MOCK_TOKEN';
const date='2026-11-10';
const a={gasVersion:'9.291',closeRun:{state:'INCOMPLETE'},
 snapshotLastDate:date,priceHistoryLastDate:date,snapshotStale:false,
 tradeLedgerWriteUnverified:false,pendingTradeSnapshotRebuildFrom:'',
 tradeSnapshotDeferredCount:0,fundAttempt:{state:'DONE',date:'2026-11-09'}};
const trades=Array.from({length:338},(_,i)=>({
 id:'srv_'+i.toString(16).padStart(32,'0'),date,qty:1,price:100}));
const good={
 getAutomationStatus:{status:'ok',gasVersion:'9.291',automation:a},
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
  assert(['getAutomationStatus','getTrades','getWriterGateStatus'].includes(action));
  return {ok:true,json:async()=>payload[action]};
 }});
 assert.deepEqual(calls,['getAutomationStatus','getTrades','getWriterGateStatus']);
 return r;
}
const ok=await check();
assert.equal(ok.status,'VERIFIED');
assert.equal(ok.tradeRows,338);
assert.equal(ok.deployedVersion,'9.291');
assert.equal(ok.closeFinality,'INCOMPLETE');
assert.equal(ok.fundAttemptState,'DONE');
assert.equal(ok.closeMarkedCompleteByProbe,false);
assert.equal(ok.financialWrites,0);
const exercise=async(payload,regex)=>{
 await assert.rejects(()=>check(payload),regex);
};
await exercise({...good,getAutomationStatus:{...good.getAutomationStatus,gasVersion:'9.290'}},
 /WEBAPP_VERSION_MISMATCH/);
await exercise({...good,getAutomationStatus:{...good.getAutomationStatus,
 automation:{...a,snapshotStale:true}}},/FINANCIAL_STATE_UNVERIFIED/);
await exercise({...good,getTrades:{...good.getTrades,trades:[...trades.slice(0,-1),trades[0]]}},
 /TRADE_IDS_UNVERIFIED/);
await exercise({...good,getWriterGateStatus:{...good.getWriterGateStatus,
 writerGate:{...good.getWriterGateStatus.writerGate,activeCount:1}}},/WRITER_GATE_NOT_IDLE/);
console.log('PASS v9.291 post-deploy: verified exact web app, 338 ledger v2, separate incomplete close, Writer idle, zero finance writes');
