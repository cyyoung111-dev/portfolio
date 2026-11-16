#!/usr/bin/env node
// Ensure a confirmed FAILED trade-v2 receipt cannot cause a preceding
// holdings write on every PC reload. This is an isolated, no-I/O VM fixture.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const src=readFileSync('src/web/domain/portfolio/data.js','utf8');
const start=src.indexOf('async function _retryPortfolioRemoteDirtySync(options) {');
const end=src.indexOf('\n}\n\nfunction _restorePortfolioRemoteDirtyPayload',start);
assert(start>=0&&end>start,'retry function extraction');
const fn=src.slice(start,end+2);
assert.match(fn,/getPortfolioSyncReceipt/);
assert(fn.indexOf('getPortfolioSyncReceipt')<fn.indexOf('const holdingsResult'),
 'receipt read must precede any holdings write');

const url='https://script.google.com/macros/s/MOCK_DEPLOYMENT/exec';
const record={action:'syncTradesV2',attempted:true,id:'test_operation_123456789',
 params:{tradeLedgerProtocolVersion:'2',expectedLedgerRevision:'a'.repeat(64),
 data:'[]',intents:'[]'}};
const make=state=>{
 const counter={receipt:0,hold:0,trade:0,settings:0,failures:[]};
 let dirty={target:url,receiptProtocol:1,epoch:'seq1',tradeV2Baseline:{revision:'a'.repeat(64)},
  trades:[{date:'2026-11-13',qty:1}],holdings:[{name:'MOCK',qty:1}],
  fundDirect:{},receiptScope:'scope1'};
 const context={
  URL,Date,String,Object,Array,Map,Number,
  _portfolioRemoteDirtyByTarget:{[url]:dirty},
  _queuePortfolioRemoteSync:async(_,work)=>work(),
  _hasPortfolioReceiptProtocol:()=>true,
  _isEmptyPortfolioDirtyWithoutDeleteIntent:()=>false,
  getGsheetConnectionGeneration:()=>1,
  isPinnedRestorePortfolioMasterComplete:()=>true,
  _readPortfolioRecoveryReceipts:()=>({[url]:{syncTradesV2:record}}),
  requestGsheetFormJson:async(action,params,options)=>{
   counter.receipt++;assert.equal(action,'getPortfolioSyncReceipt');
   assert.equal(params.operationId,record.id);
   assert.equal(params.kind,'syncTradesV2');
   assert.equal(options.retry,0);
   return state==='THROW'?Promise.reject(Error('NETWORK')):{
    status:'ok',kind:'syncTradesV2',operationId:record.id,
    receiptState:state
   };
  },
  syncHoldingsToGsheet:async()=>{counter.hold++;return{status:'ok'}},
  syncTradesToGsheet:async()=>{counter.trade++;return{status:'ok',saveState:'success'}},
  saveSettings:async()=>{counter.settings++;return true},
  _clearPortfolioRemoteDirty:()=>{delete context._portfolioRemoteDirtyByTarget[url];return true}
 };
 vm.runInNewContext(fn+'\nglobalThis.retry=_retryPortfolioRemoteDirtySync;',context);
 const run=async()=>context.retry({targetUrl:url,allowDuringRestore:true,
  onFailure:code=>counter.failures.push(code)});
 return {counter,run,context};
};
for(const state of ['FAILED','THROW','UNVERIFIED']){
 const t=make(state);
 assert.equal(await t.run(),false,state);
 assert.equal(t.counter.receipt,1);
 assert.equal(t.counter.hold,0,'no holdings writes before v2 failure');
 assert.equal(t.counter.trade,0,'no trade writes/replays');
 assert.equal(t.counter.settings,0,'no settings writes');
 assert.deepEqual(t.counter.failures,[state==='FAILED'
  ?'SYNC_RECEIPT_FAILED':'SYNC_RECEIPT_UNVERIFIED']);
 assert.equal(t.context._portfolioRemoteDirtyByTarget[url]?.trades?.length,1,
  'dirty source remains intact');
}
const success=make('COMPLETE');
assert.equal(await success.run(),true);
assert.deepEqual([success.counter.receipt,success.counter.hold,
 success.counter.trade,success.counter.settings],[1,1,1,1]);
assert.equal(success.context._portfolioRemoteDirtyByTarget[url],undefined);
console.log('PASS PC failed v2 receipt read before holdings write');
