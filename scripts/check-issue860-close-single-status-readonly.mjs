#!/usr/bin/env node
// #860 single protected status read offline contract. No GAS network/Sheets access.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readIssue860Once,classifySavedFundWarning} from './issue860-close-single-status-readonly.mjs';

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
const afterTradeV2=await readIssue860Once({url,token,fetchImpl:async()=>({
 ok:true,json:async()=>({...data,gasVersion:'9.288',
  automation:{...data.automation,gasVersion:'9.288'}})
})});
assert.equal(afterTradeV2.gasVersion,'9.288',
 'Known manual 9.288 release needs the same strict persisted-status diagnostic');
assert.equal(afterTradeV2.financialWrites,0);
const afterPerf289=await readIssue860Once({url,token,fetchImpl:async()=>({
 ok:true,json:async()=>({...data,gasVersion:'9.289',
  automation:{...data.automation,gasVersion:'9.289'}})
})});
assert.equal(afterPerf289.gasVersion,'9.289',
 'Known deployed v9.289 requires the same sanitized persisted-status diagnostic');
assert.equal(afterPerf289.requestCount,1);
assert.equal(afterPerf289.financialWrites,0);
const afterCurrent291=await readIssue860Once({url,token,fetchImpl:async()=>({
 ok:true,json:async()=>({...data,gasVersion:'9.291',
  automation:{...data.automation,gasVersion:'9.291'}})
})});
assert.equal(afterCurrent291.gasVersion,'9.291','Published 9.291 must pass sanitized status audit');
assert.equal(afterCurrent291.requestCount,1);
assert.equal(afterCurrent291.financialWrites,0);
const afterGate292=await readIssue860Once({url,token,fetchImpl:async()=>({
 ok:true,json:async()=>({...data,gasVersion:'9.292',
  automation:{...data.automation,gasVersion:'9.292',
   priceCloseState:'COMPLETE',fundCloseState:'PENDING',
   fundReservationVerified:true}})
})});
assert.equal(afterGate292.gasVersion,'9.292');
assert.equal(afterGate292.priceCloseState,'COMPLETE');
assert.equal(afterGate292.fundCloseState,'PENDING');
assert.equal(afterGate292.fundReservationVerified,true);
const afterCurrent294=await readIssue860Once({url,token,fetchImpl:async()=>({
 ok:true,json:async()=>({...data,gasVersion:'9.294',
  automation:{...data.automation,gasVersion:'9.294',
   closeRun:{runDate:'2026-11-13',state:'INCOMPLETE',stage:'FUND_PENDING'},
   portfolioClose:{...data.automation.portfolioClose,runDate:'2026-11-13',
    priceDate:'2026-11-13',priceRows:39,priceOk:true,fundOk:false},
   fundAttempt:{date:'2026-11-13',state:'IN_PROGRESS'},
   priceCloseState:'COMPLETE',fundCloseState:'PENDING',
   fundReservationVerified:true}})
})});
assert.equal(afterCurrent294.gasVersion,'9.294');
assert.equal(afterCurrent294.closeRunDate,'2026-11-13');
assert.equal(afterCurrent294.storedPriceRows,39);
assert.equal(afterCurrent294.priceCloseState,'COMPLETE');
assert.equal(afterCurrent294.fundCloseState,'PENDING');
assert.equal(afterCurrent294.closeComplete,false);
assert.equal(afterCurrent294.financialWrites,0);
assert.equal(afterCurrent294.requestCount,1);
assert.equal(classifySavedFundWarning('F00001 NAV 미확보 1일'),
 'NAV_PUBLICATION_OR_INPUT_PENDING');
assert.equal(classifySavedFundWarning('Snapshot 보호 충돌 2건'),
 'SNAPSHOT_PROTECTED');
assert.equal(classifySavedFundWarning('일부 부분 완료'),
 'PARTIAL_FUND_VALUATION');
assert.equal(classifySavedFundWarning('PRIVATE_ACCOUNT_123456'),
 'UNCLASSIFIED');
assert.equal(classifySavedFundWarning(''),'NONE');
const warningStatus=await readIssue860Once({url,token,
 fetchImpl:async()=>({ok:true,json:async()=>({...data,gasVersion:'9.294',
  automation:{...data.automation,gasVersion:'9.294',
   fundLastWarning:'F00001 NAV 미확보 1일 PRIVATE_ACCOUNT_123456'}})})});
assert.equal(warningStatus.fundWarningPresent,true);
const parityStatus=await readIssue860Once({url,token,
 fetchImpl:async()=>({ok:true,json:async()=>({...data,gasVersion:'9.294',
  automation:{...data.automation,gasVersion:'9.294',
   portfolioCloseRunStale:false,portfolioCloseLastError:'SENSITIVE_PRIVATE',
   tradeLedgerWriteUnverified:true,
   pendingTradeSnapshotRebuildFrom:'2026-11-12',tradeSnapshotDeferredCount:3}})})});
assert.equal(parityStatus.portfolioCloseRunStale,false);
assert.equal(parityStatus.portfolioCloseLastErrorPresent,true);
assert.equal(parityStatus.tradeLedgerWriteUnverified,true);
assert.equal(parityStatus.pendingTradeSnapshotRebuildPresent,true);
assert.equal(parityStatus.tradeSnapshotDeferredCount,3);
assert(!JSON.stringify(parityStatus).includes('SENSITIVE_PRIVATE'));
assert.equal(warningStatus.fundWarningClass,'NAV_PUBLICATION_OR_INPUT_PENDING');
assert.ok(!JSON.stringify(warningStatus).includes('PRIVATE_ACCOUNT_123456'));


assert.equal(afterGate292.financialWrites,0);
await assert.rejects(()=>readIssue860Once({url,token,fetchImpl:async()=>({
 ok:true,json:async()=>({...data,gasVersion:'9.290',
  automation:{...data.automation,gasVersion:'9.290'}})
})}),/ISSUE860_STATUS_VERSION_OR_SCHEMA/,'Unreviewed 9.290 must not pass');
await assert.rejects(()=>readIssue860Once({url,token,fetchImpl:async()=>({
 ok:true,json:async()=>({...data,gasVersion:'9.288',
  automation:{...data.automation,gasVersion:'9.287'}})
})}),/ISSUE860_STATUS_VERSION_OR_SCHEMA/,'Outer and inner versions must agree');
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
assert.equal(report.portfolioCloseRunStale,null,'unknown flag must remain unknown');
assert.equal(report.portfolioCloseLastErrorPresent,false);
assert.equal(report.tradeLedgerWriteUnverified,false);
assert.equal(report.pendingTradeSnapshotRebuildPresent,false);
assert.equal(report.tradeSnapshotDeferredCount,null,'missing deferred count is not zero');
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
// The protected one-shot runs with Node only; no package installation.
const current=fs.readFileSync('.github/workflows/issue860-once-close-status-readonly.yml','utf8');
assert(current.includes("paths: ['.github/workflows/issue860-once-close-status-readonly.yml']"));
assert.match(current,/environment: portfolio-production-gas/);
assert.match(current,/run: node scripts\/issue860-close-single-status-readonly\.mjs/);
assert.match(current,/run: node scripts\/issue734-gas9293-postdeploy-readonly\.mjs/);
assert.doesNotMatch(current,/run: node scripts\/issue860-gas9292-postdeploy-readonly\.mjs/);
assert.doesNotMatch(current,/run:.*resumeIncompletePortfolioClose/);
const currentIssue734=fs.readFileSync(
 '.github/workflows/issue734-current-close-status-readonly.yml','utf8');
assert.match(currentIssue734,/environment: portfolio-production-gas/);
assert.match(currentIssue734,/node scripts\/issue860-close-single-status-readonly\.mjs/);
assert.match(currentIssue734,/auditFundRows/);
assert.match(currentIssue734,/days:32/);
assert.match(currentIssue734,/ISSUE734_FUND_32DAY_VERDICT/);
assert.doesNotMatch(currentIssue734,/action:\s*['"](?:collectKbFundNav|collectHanwhaFundNav|resumeIncompletePortfolioClose)['"]/);
console.log(JSON.stringify({kind:'ISSUE860_SINGLE_STATUS_OFFLINE_PASS',
 responseSanitized:true,authenticatedOneRequest:true,timeoutBounded:true,
 ownerProofNotInvented:true,financialWrites:0,realGasRequests:0}));
