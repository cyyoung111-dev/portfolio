#!/usr/bin/env node
// #860 single protected status read offline contract. No GAS network/Sheets access.
import assert from 'node:assert/strict';
import {readIssue860Once} from './issue860-close-single-status-readonly.mjs';

const url='https://script.google.com/macros/s/EXAMPLE_DEPLOYMENT/exec';
const token='TEST_PRIVATE_ACCESS_TOKEN_12345';
const data={
 status:'ok',gasVersion:'9.284',automation:{
  gasVersion:'9.284',checkedAt:'2026-11-09 20:49:20',overallStatus:'INCOMPLETE',
  snapshotLastDate:'2026-11-09',priceHistoryLastDate:'2026-11-09',
  expectedSnapshotDate:'2026-11-09',snapshotStale:false,
  pendingKrxCloseDates:[],fundLastWarning:'PRIVATE:',
  portfolioClose:{runDate:'2026-11-08',priceOk:true,fundOk:false,
    priceRows:39,priceDate:'2026-11-09',errors:['PRIVATE']},
  closeRun:{runDate:'2026-11-08',state:'ERROR',stage:'ERROR'},
  fundAttempt:{date:'2026-11-08',state:'TIMEOUT_SUSPECTED'},
  fundLastError:'PRIVATE: timed out for account SECRET',
  fundResumeCheckpoint:{
   stage:'VALUATION',lastWorkStage:'navWrite',
   requestId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
   atMs:1,elapsedMs:1,sequence:1
  }
 }
};
let calls=0;
const network=async(dest,opt)=>{
 calls++;
 assert.equal(dest,url);
 assert.equal(opt.method,'POST');
 assert.equal(opt.body.get('action'),'getAutomationStatus');
 assert.equal(opt.body.get('accessToken'),token);
 assert.equal(opt.signal.aborted,false);
 return {ok:true,json:async()=>data};
};
const report=await readIssue860Once({url,token,fetchImpl:network});
assert.equal(calls,1);
assert.equal(report.gasVersion,'9.284');
const postFailure=await readIssue860Once({url,token,fetchImpl:async()=>({
 ok:true,json:async()=>({
  ...data,gasVersion:'9.287',automation:{...data.automation,gasVersion:'9.287'}
 })
})});
assert.equal(postFailure.gasVersion,'9.287','Post-failure read must not reject successfully published candidate');
assert.equal(postFailure.processExecutionOwnerVerified,false);
assert.equal(postFailure.financialWrites,0);

assert.equal(report.closeState,'ERROR');
assert.equal(report.priceOk,true);
assert.equal(report.fundOk,false);
assert.equal(report.fundFailureClass,'TIMEOUT');
assert.equal(report.fundWorkStage,'navWrite');
assert.equal(report.observedKstDate,'2026-11-09');
assert.equal(report.overallStatus,'INCOMPLETE');
assert.equal(report.storedPriceRows,39);
assert.equal(report.storedPriceDate,'2026-11-09');
assert.equal(report.snapshotLastDate,'2026-11-09');
assert.equal(report.priceHistoryLastDate,'2026-11-09');
assert.equal(report.expectedSnapshotDate,'2026-11-09');
assert.equal(report.snapshotStale,false);
assert.equal(report.fundErrorPresent,true);
assert.equal(report.fundWarningPresent,true);
assert.equal(report.pendingKrxDatesCount,0);
assert.equal(report.closeComplete,false);
assert.equal(report.processExecutionOwnerVerified,false);
assert.equal(report.backupRegistryOwnerVerified,false);
assert.equal(report.financialWrites,0);
assert(!JSON.stringify(report).includes('SECRET'));
assert(!JSON.stringify(report).includes('aaaa'));
assert(!JSON.stringify(report).includes(token));
assert(!JSON.stringify(report).includes(url));
await assert.rejects(()=>readIssue860Once({url,token,
 fetchImpl:async()=>({ok:true,json:async()=>({
  ...data,gasVersion:'9.286'
 })})}),/ISSUE860_STATUS_VERSION_OR_SCHEMA/);
await assert.rejects(()=>readIssue860Once({url,token,
 fetchImpl:async()=>({ok:false})}),/ISSUE860_STATUS_HTTP/);
await assert.rejects(()=>readIssue860Once({url,token,
 fetchImpl:async()=>({ok:true,json:async()=>{throw Error('secret');}})}),
 /ISSUE860_STATUS_JSON/);
for(const [name,reason] of [['TimeoutError','TIMEOUT'],['Error','NETWORK']]){
 let n=0;
 await assert.rejects(()=>readIssue860Once({url,token,fetchImpl:async()=>{
  n++;throw Object.assign(Error('private credentials'),{name});
 }}),new RegExp('ISSUE860_STATUS_'+reason));
 assert.equal(n,1,'single request; do not retry a busy GAS service');
}
console.log(JSON.stringify({kind:'ISSUE860_SINGLE_STATUS_OFFLINE_PASS',
 responseSanitized:true,authenticatedOneRequest:true,timeoutBounded:true,
 ownerProofNotInvented:true,financialWrites:0,realGasRequests:0}));
