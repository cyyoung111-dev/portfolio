#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {inspectIssue734V9288LiveReadiness} from './issue734-v9288-live-readiness-readonly.mjs';
import {composeFundSnapshot9287SourcePreview} from './compose-fund-snapshot-9287-source-preview.mjs';
import {composeGas9288TradeV2From9287Preview} from './compose-gas9288-trade-v2-from-9287-preview.mjs';
import {assertGasReleaseReady} from './deploy-gas.mjs';

const parent=composeFundSnapshot9287SourcePreview().candidate;
const successor=composeGas9288TradeV2From9287Preview().candidate;
assert.equal(assertGasReleaseReady(parent),'9.287');
assert.equal(assertGasReleaseReady(successor),'9.288');
assert(parent.includes('var ISSUE507_GATE_RELEASE_ID='));
assert(successor.includes('var ISSUE507_GATE_RELEASE_ID='));
for(const x of [parent,successor]){
 assert(x.includes("if (params.action === 'getAutomationStatus')"));
 assert(x.includes("if (params.action === 'getTrades')"));
 assert(x.includes('function _getAutomationStatusData()'));
 assert(x.includes('function handleGetTrades('));
}
const workflow=YAML.parse(fs.readFileSync('.github/workflows/gas-deploy.yml','utf8'));
const stages=workflow.jobs.deploy.steps;
const p=stages.findIndex(s=>String(s.name||'').includes('9.287 settled close and legacy ledger'));
const deploy=stages.findIndex(s=>s.name==='Deploy GAS');
assert(p>0&&p<deploy);
assert.equal(stages[p].run,'node scripts/issue734-v9288-live-readiness-readonly.mjs');
assert.match(String(stages[p].if),/GAS_9288_TRADE_V2 == 'true'/);
assert.match(String(stages[p].if),/GAS_9288_RELEASE_APPROVAL == 'true'/);
assert.match(String(stages[p].if),/GAS_DEPLOY_DRY_RUN != 'true'/);
assert(!stages[p]['continue-on-error']);
const url='https://script.google.com/macros/s/TEST_DEPLOYMENT_EXAMPLE/exec';
const token='mock_private_test_token_123';
const date='2026-11-09';
const trades=Array.from({length:338},(_,i)=>({
 date,code:String(100001+i).padStart(6,'0'),qty:1,price:100,
 tradeType:'buy',acct:'TEST',memo:'PRIVATE_MOCK_VALUE'
}));
const status={
 status:'ok',gasVersion:'9.287',automation:{
  gasVersion:'9.287',overallStatus:'NORMAL',
  portfolioClose:{runDate:date,priceDate:date,priceRows:39,priceOk:true,
    fundOk:true,errors:[]},
  closeRun:{runDate:date,state:'COMPLETE',stage:'COMPLETE'},
  portfolioCloseRunStale:false,snapshotStale:false,
  fundAttempt:{state:'DONE',date},fundLastError:'',fundLastWarning:'',
  portfolioCloseLastError:'',expectedPortfolioCloseRunDate:date,
  expectedSnapshotDate:date,pendingKrxCloseDates:[],
  pendingTradeSnapshotRebuildFrom:'',tradeLedgerWriteUnverified:false,
  tradeSnapshotDeferredCount:0,
  trigger:{hasClose:true,hasWatchdog:true,hasLegacySplitTriggers:false,
    hasDuplicateCloseTriggers:false,hasDuplicateWatchdogTriggers:false}
 }};
const responses={getAutomationStatus:status,
 getTrades:{status:'ok',trades}};
async function check(override={},expectCalls=null,expectedGasVersion='9.287'){
 const calls=[];
 const answer={...responses,...override};
 const report=await inspectIssue734V9288LiveReadiness({
  url,token,expectedGasVersion,fetchImpl:async(dest,options)=>{
   assert.equal(dest,url);
   assert.equal(options.method,'POST');
   assert.equal(options.body.get('accessToken'),token);
   const action=options.body.get('action');calls.push(action);
   return {ok:true,json:async()=>answer[action]};
  }
 });
 assert.deepEqual(calls,expectCalls||['getAutomationStatus','getTrades']);
 return report;
}
const okay=await check();
assert.equal(okay.observedGasVersion,'9.287');
assert.equal(okay.expectedGasVersion,'9.287');
const published={...status,gasVersion:'9.288',
 automation:{...status.automation,gasVersion:'9.288'}};
const publishedOkay=await check({getAutomationStatus:published},null,'9.288');
assert.equal(publishedOkay.status,'READONLY_PASS');
assert.equal(publishedOkay.expectedGasVersion,'9.288');
assert.equal(publishedOkay.permissionToMigrate,false);
assert.equal(publishedOkay.liveExternalWriterExcludedVerified,false);
await rejected({getAutomationStatus:published},
 /ISSUE734_9288_PREFLIGHT_PUBLISHED_VERSION_MISMATCH/,['getAutomationStatus']);
assert.equal(okay.status,'READONLY_PASS');
assert.equal(okay.legacyTradeRows,338);
assert.equal(okay.permissionToDeploy,false);
assert.equal(okay.liveExternalWriterExcludedVerified,false);
assert.equal(okay.concurrentProcessExcludedVerified,false);
assert.equal(okay.financeWrites,0);
assert(!JSON.stringify(okay).includes('PRIVATE_'));
assert(!JSON.stringify(okay).includes(token));
assert(!JSON.stringify(okay).includes(url));
async function rejected(override,regex,actions,expectedGasVersion='9.287'){
 const calls=[];
 await assert.rejects(()=>inspectIssue734V9288LiveReadiness({
  url,token,expectedGasVersion,fetchImpl:async(_dest,options)=>{
   const action=options.body.get('action');calls.push(action);
   return {ok:true,json:async()=>({...responses,...override})[action]};
  }
 }),regex);
 assert.deepEqual(calls,actions);
}
const single=['getAutomationStatus'],double=[...single,'getTrades'];
await rejected({getAutomationStatus:{...published,automation:{...published.automation,gasVersion:'9.287'}}},
 /ISSUE734_9288_PREFLIGHT_PUBLISHED_VERSION_MISMATCH/,single,'9.288');
await assert.rejects(()=>inspectIssue734V9288LiveReadiness({
 url,token,expectedGasVersion:'9.289',fetchImpl:async()=>{throw Error('must not call');}
}),/ISSUE734_9288_PREFLIGHT_EXPECTED_VERSION_UNSUPPORTED/);
for(const v of ['9.285','9.289']){
 await rejected({getAutomationStatus:{...status,gasVersion:v}},
  /ISSUE734_9288_PREFLIGHT_PUBLISHED_VERSION_MISMATCH/,single);
}
for(const [field,value] of [
 ['overallStatus','WARNING'],
 ['tradeLedgerWriteUnverified',true],
 ['tradeSnapshotDeferredCount',1],
 ['pendingKrxCloseDates',[date]],
 ['pendingTradeSnapshotRebuildFrom',date]
]){
 const changed={...status.automation,[field]:value};
 await rejected({getAutomationStatus:{...status,automation:changed}},
  new RegExp('ISSUE734_9288_PREFLIGHT_(OVERALL_STATUS_NOT_NORMAL|PENDING_FINANCIAL_WRITES)'),
  single);
}
for(const bad of [
 {portfolioClose:{...status.automation.portfolioClose,priceOk:false}},
 {closeRun:{...status.automation.closeRun,state:'INCOMPLETE'}},
 {fundAttempt:{state:'IN_PROGRESS',date}},
 {snapshotStale:true},
 {fundLastError:'mock secret'},
 {portfolioCloseRunStale:true}
]){
 await rejected({getAutomationStatus:{...status,
  automation:{...status.automation,...bad}}},/ISSUE734_9288_PREFLIGHT_CLOSE_NOT_SETTLED/,single);
}
for(const fail of [
 {hasLegacySplitTriggers:true},
 {hasDuplicateCloseTriggers:true},
 {hasWatchdog:false}
]){
 await rejected({getAutomationStatus:{...status,automation:{...status.automation,
  trigger:{...status.automation.trigger,...fail}}}},
  /ISSUE734_9288_PREFLIGHT_TRIGGERS_UNVERIFIED/,single);
}
for(const bad of [
 {status:'ok',trades:trades.slice(1)},
 {status:'ok',tradeLedgerProtocolVersion:2,trades},
 {status:'ok',trades:[...trades.slice(0,337),{...trades[337],id:'srv_mockid'}]},
 {status:'ok',trades:[...trades.slice(0,337),{...trades[337],code:null}]}
]){
 await rejected({getTrades:bad},
  /ISSUE734_9288_PREFLIGHT_(LEGACY_LEDGER_NOT_EXACT|LEGACY_ROW_SCHEMA_DRIFT)/,
  double);
}
console.log(JSON.stringify({kind:'ISSUE734_9288_LIVE_READINESS_OFFLINE_PASS',
 expectedLegacyRows:338,negativeScenarios:23,legacyGatePreserved:true,
 failClosedOnIncompleteClose:true,prepublishVersion:'9.287',
 postpublishVersion:'9.288',
 realNetworkCalls:0,financeWrites:0,gasDeployments:0}));
