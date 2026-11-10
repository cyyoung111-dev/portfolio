#!/usr/bin/env node
import assert from 'node:assert/strict';
import {composeGas9288TradeV2From9287Preview}
 from './compose-gas9288-trade-v2-from-9287-preview.mjs';
import {classifyProjectFiles,judgeReadiness,runReadiness}
 from './issue860-v9289-live-readiness-readonly.mjs';

const {candidate,manifest}=composeGas9288TradeV2From9287Preview();
assert.equal(manifest.candidateSourceGitBlob,
 '9e8584032daf896c5cffedb02041b604ee82ed07');
const published=[{name:'appsscript',type:'JSON',
 source:JSON.stringify({timeZone:'Asia/Seoul',runtimeVersion:'V8'})},
 {name:'Code',type:'SERVER_JS',source:candidate}];
const exact=classifyProjectFiles({head:published,published});
assert.equal(exact.status,'REVIEWED_9288_READY');
assert.equal(exact.actualFileCount,2);
assert.equal(exact.unreviewedExtraFileCount,0);
const withTemps=[...published,
 {name:'Issue734_Recovery',type:'SERVER_JS',source:'function helper(){}'},
 {name:'Issue734_OneClick',type:'SERVER_JS',source:'function oneClick(){}'}];
const blocked=classifyProjectFiles({head:withTemps,published});
assert.equal(blocked.status,'UNREVIEWED_EXTRA_OR_MANIFEST_FILES');
assert.equal(blocked.temporaryMaintenanceFileCount,2);
assert.equal(blocked.expectedPublishedShaMatch,true);
assert.equal(blocked.headPrimaryShaMatch,true);
const badCore=published.map(f=>f.name==='Code'
 ?{...f,source:f.source+'\n// unreviewed edit'}:f);
assert.equal(classifyProjectFiles({head:badCore,published}).status,
 'HEAD_PRIMARY_SOURCE_DRIFT');
const differentManifest=published.map(f=>f.name==='appsscript'
 ?{...f,source:'{"timeZone":"UTC"}'}:f);
assert.equal(classifyProjectFiles({head:differentManifest,published}).status,
 'UNREVIEWED_EXTRA_OR_MANIFEST_FILES');
assert.throws(()=>classifyProjectFiles({head:published,published:badCore}),
 /ISSUE860_9289_PREFLIGHT_PUBLISHED_SOURCE_NOT_REVIEWED/);

const gate={status:'GATE_OPEN_NO_RECORDED_ACTIVE',mode:'OPEN',
 activeCount:0,observedGasVersion:'9.288'};
const trades={status:'VERIFIED',gasVersion:'9.288',
 v2Protocol:2,uniqueTradeRows:338};
assert.equal(judgeReadiness({files:exact,gate,trades}).ready,true);
assert.equal(judgeReadiness({files:blocked,gate,trades}).ready,false);
assert.equal(judgeReadiness({files:exact,gate:{...gate,activeCount:1},trades}).ready,false);
assert.equal(judgeReadiness({files:exact,gate:{...gate,mode:'DRAINING'},trades}).ready,false);
assert.equal(judgeReadiness({files:exact,gate,trades:null}).ready,false);
assert.equal(judgeReadiness({files:exact,gate,trades:{...trades,uniqueTradeRows:337}}).ready,false);

let visited=[],reported=[];
const fakeFetch=async (url,options)=>{
 assert.equal(options.method,'GET');
 visited.push(url);
 const data=url.includes('/deployments/')
  ?{deploymentConfig:{versionNumber:345},entryPoints:[{entryPointType:'WEB_APP'}]}
  :url.includes('versionNumber=345')?{files:published}:{files:withTemps};
 return {ok:true,json:async()=>data};
};
const normal={
 scriptId:'1'+'x'.repeat(39),deploymentId:'A'+'b'.repeat(50),
 webAppUrl:'https://script.google.com/macros/s/'+('A'+'b'.repeat(50))+'/exec',
 gasToken:'test-token-01234567890',googleOauth:'oauth-token-01234567890',
 fetchImpl:fakeFetch,gateInspector:async()=>gate,
 tradeInspector:async()=>trades,report:value=>reported.push(value)
};
const live=await runReadiness(normal);
assert.equal(live.ready,false);
assert.equal(live.status,'BLOCKED_HEAD_FILE_SET');
assert.equal(visited.length,3,'strict Google API metadata GET count');
assert(reported.some(x=>x.kind==='ISSUE860_9289_TRADE_PROTOCOL_READBACK'));
const readyCalls=[],readyReported=[];
const verified=await runReadiness({...normal,
 fetchImpl:async (url,options)=>{
  assert.equal(options.method,'GET');readyCalls.push(url);
  const data=url.includes('/deployments/')
   ?{deploymentConfig:{versionNumber:345},entryPoints:[{entryPointType:'WEB_APP'}]}
   :{files:published};
  return {ok:true,json:async()=>data};
 },report:x=>readyReported.push(x)});
assert.equal(verified.ready,true);
assert.equal(verified.status,'READY_FOR_MANUAL_9289_DRY_RUN');
assert.equal(readyCalls.length,3);
assert(readyReported.every(x=>x.financialWrites===0||x.financialWrites===undefined));
assert(!JSON.stringify(readyReported).includes('oauth-token'));
const script=await import('node:fs').then(fs=>
 fs.readFileSync('scripts/issue860-v9289-live-readiness-readonly.mjs','utf8'));
assert(!script.includes("method:'PUT'"));
assert(!script.includes("method:'DELETE'"));
assert(!script.includes("method:'PATCH'"));
assert(!script.includes("method:'POST'"));
assert(!script.includes('ScriptApp.newTrigger('));
console.log(JSON.stringify({
 kind:'ISSUE860_9289_READINESS_READONLY_TEST_PASS',
 targetVersion:'9.289',legacyRows:338,
 approvedPublishedSha:true,extraFilesRejected:true,
 activeWriterRejected:true,migrationMismatchRejected:true,
 liveGoogleReadCalls:3,financialWrites:0,
 gasDeployments:0,telegramSends:0}));
