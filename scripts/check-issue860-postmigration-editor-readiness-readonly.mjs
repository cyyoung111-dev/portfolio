#!/usr/bin/env node
import assert from 'node:assert/strict';
import {inspectEditorReadiness} from './issue860-postmigration-editor-readiness-readonly.mjs';
import {composeGas9288TradeV2From9287Preview}
 from './compose-gas9288-trade-v2-from-9287-preview.mjs';
const {candidate}=composeGas9288TradeV2From9287Preview();
const scriptId='EXAMPLE_SCRIPT_ID_12345',deploymentId='TESTDEPLOYMENT123456';
const webAppUrl='https://script.google.com/macros/s/'+deploymentId+'/exec';
const files=[
 {name:'appsscript',type:'JSON',source:JSON.stringify({timeZone:'Asia/Seoul'})},
 {name:'Code',type:'SERVER_JS',source:candidate}
];
const deployment={deploymentConfig:{versionNumber:345},
 entryPoints:[{entryPointType:'WEB_APP',webApp:{}}]};
async function simulate({current=files,published=files,gateBusy=false,rows=338}={}){
 const calls=[],bodyByEndpoint={};
 const result=await inspectEditorReadiness({
  scriptId,deploymentId,webAppUrl,oauthToken:'fake_oauth_token_12345678900',
  gasToken:'fake-gas-test-token-123',
  fetchImpl:async(url,opt)=>{
   assert.equal(opt.method,'GET');
   assert.equal(opt.body,undefined);
   assert.equal(opt.redirect,'error');
   calls.push(url);
   const val=url.includes('/deployments/')?deployment:
     url.endsWith('/content')?{files:current}:{files:published};
   return {ok:true,json:async()=>val};
  },
  gateInspect:async()=>({status:gateBusy?'GATE_BLOCKED':'GATE_OPEN_NO_RECORDED_ACTIVE',
    mode:'OPEN',activeCount:gateBusy?1:0}),
  tradeInspect:async()=>({status:'VERIFIED',uniqueTradeRows:rows})
 });
 assert.equal(result.financeWrites,0);
 assert.equal(result.gasDeployments,0);
 assert.equal(result.telegramSends,0);
 assert.equal(calls.length,3);
 assert(!JSON.stringify(result).includes('fake_oauth'));
 assert(!JSON.stringify(result).includes(scriptId));
 return result;
}
const ok=await simulate();
assert.equal(ok.status,'READY_FOR_SEPARATELY_APPROVED_DRY_RUN');
assert.equal(ok.tradeRowsVerified,338);
assert.equal(ok.editorFileCount,2);
const extra=await simulate({current:[...files,
 {name:'Issue734_OneClick',type:'SERVER_JS',source:'function test(){}'}]});
assert.equal(extra.status,'BLOCKED');
assert.equal(extra.reason,'EXTRA_EDITOR_FILES_OR_MANIFEST_DRIFT');
assert.equal(extra.editorFileCount,3);
const badSource=await simulate({current:[files[0],{...files[1],source:candidate+'\n// changed'}]});
assert.equal(badSource.reason,'EDITOR_CODE_NOT_PINNED_9288');
const changedManifest=await simulate({current:[{...files[0],source:'{"timeZone":"UTC"}'},files[1]]});
assert.equal(changedManifest.reason,'EXTRA_EDITOR_FILES_OR_MANIFEST_DRIFT');
const blocked=await simulate({gateBusy:true});
assert.equal(blocked.reason,'GATE_NOT_IDLE');
const invalidLedger=await simulate({rows:337});
assert.equal(invalidLedger.reason,'TRADE_V2_NOT_VERIFIED');
await assert.rejects(()=>simulate({published:[files[0],{...files[1],source:'UNKNOWN_SOURCE'}]}),
 /ISSUE860_EDITOR_PUBLISHED_PIN_DRIFT/);
console.log(JSON.stringify({kind:'ISSUE860_EDITOR_READINESS_OFFLINE_PASS',
 tests:7,permittedWrites:0,extraFilesFailClosed:true,
 actualNetworkCalls:0,gasDeployments:0}));
