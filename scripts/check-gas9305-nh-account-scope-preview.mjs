import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import YAML from 'yaml';
import {composeGas9304NhContinuationPreview} from './compose-gas9304-nh-continuation-preview.mjs';
import {composeGas9305NhAccountScopePreview} from './compose-gas9305-nh-account-scope-preview.mjs';
import {assessNhAccountScope,probeNhFinancialAccountScope} from './nh-financial-account-scope-readback.mjs';
import {assertGasReleaseReady,assertGas9305Prerequisites,assertIssue507ManualReleasePermission} from './deploy-gas.mjs';
import {assertPublishedReleaseFundNavSupport} from './issue860-fund-nav-release-compat.mjs';
const {candidate:parent,extension:old}=composeGas9304NhContinuationPreview();
const {parent:reviewed,candidate,extension,manifest}=composeGas9305NhAccountScopePreview();
assert.equal(parent,reviewed,'published parent must remain exact');
new vm.Script(candidate);
assert.equal(manifest.candidateGitBlob,'ed000678f26f1c3018880b7a556d5fb033328342');
assert.equal(assertGasReleaseReady(parent),'9.304');
assert.equal(assertGasReleaseReady(candidate),'9.305');
assert.throws(()=>assertGasReleaseReady(candidate+'\\n// unauthorized'),/GAS_RELEASE_SOURCE_NOT_APPROVED/);
assert.deepEqual(assertPublishedReleaseFundNavSupport('9.305'),{version:'9.305',kb:true,hanwha:true,financialWrites:0});
for(const eventName of ['push','workflow_run','workflow_dispatch'])
 assert.throws(()=>assertIssue507ManualReleasePermission({version:'9.305',eventName,approved9305:eventName!=='workflow_dispatch'}),/GAS_9305_EXPLICIT_MANUAL_RELEASE_REQUIRED/);
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({version:'9.305',eventName:'workflow_dispatch',approved9305:true}));
for(const [publishedVersion,liveIdleVerified] of [['9.303',true],['9.305',true],['9.304',false]])
 assert.throws(()=>assertGas9305Prerequisites({version:'9.305',publishedVersion,liveIdleVerified}),/GAS_9305_/);
assert.doesNotThrow(()=>assertGas9305Prerequisites({version:'9.305',publishedVersion:'9.304',liveIdleVerified:true}));
const wf=YAML.parse(fs.readFileSync('.github/workflows/gas-deploy.yml','utf8'));
const inputs=wf.on.workflow_dispatch.inputs;
assert.deepEqual(Object.keys(inputs),['operation']);
assert.equal(inputs.operation.default,'진단만');
assert.deepEqual(inputs.operation.options,['진단만','9.305 실제 배포']);
assert.equal(inputs.operation.type,'choice');
assert.equal(inputs.operation.required,true);
const job=wf.jobs.deploy,steps=job.steps;
const inventoryLive=steps.find(s=>s.name==='Require clean full GAS deployment inventory before real deploy');
const inventoryDry=steps.find(s=>s.name==='Require clean full GAS deployment inventory on 9.305 dry-run');
const preflight=steps.find(s=>s.id==='gas9305_gate');
const deploy=steps.find(s=>s.name==='Deploy GAS');
const post=steps.find(s=>s.name==='Verify NH account scope types after 9.305 deployment (no transaction inquiry)');
assert(inventoryLive&&inventoryDry&&preflight&&deploy&&post);
assert.equal(inventoryDry.run,inventoryLive.run);
assert.equal(preflight.run,'node scripts/gas9298-release-readonly.mjs pre 9.305');
assert.equal(preflight['continue-on-error'],undefined);
assert(steps.indexOf(inventoryLive)<steps.indexOf(preflight)&&steps.indexOf(inventoryDry)<steps.indexOf(preflight)&&steps.indexOf(preflight)<steps.indexOf(deploy)&&steps.indexOf(deploy)<steps.indexOf(post));
assert.match(job.env.GAS_9305_RELEASE_APPROVAL,/workflow_dispatch.*inputs\.operation == '9\.305 실제 배포'/);
assert.match(job.env.GAS_DEPLOY_DRY_RUN,/workflow_dispatch.*inputs\.operation == '진단만'/);
assert.match(job.env.GAS_9305_ACCOUNT_SCOPE,/inputs\.operation == '진단만'.*inputs\.operation == '9\.305 실제 배포'/);
assert.match(job.concurrency.group,/inputs\.operation == '진단만'/);
assert.equal(job.env.GAS_9304_RELEASE_APPROVAL,'false');
assert.equal(job.env.GAS_9304_NH_DIAGNOSTIC,'false');
assert.match(deploy.env.GAS_9305_LIVE_PREFLIGHT_VERIFIED,/gas9305_gate/);
assert.match(post.if,/GAS_9305_RELEASE_APPROVAL == 'true'/);
assert.equal(post.run,'node scripts/nh-financial-account-scope-readback.mjs');
assert.match(steps.find(s=>s.name==='Activate NH current prices after real GAS deployment').if,/GAS_9305_ACCOUNT_SCOPE != 'true'/);
assert.equal(manifest.mode,'SOURCE_PREVIEW_ONLY');
assert.equal(manifest.productionDeploymentApproved,false);
assert.equal(manifest.gasProjectWrites,0);
assert.equal(manifest.financialWrites,0);
assert.equal(manifest.oauthIssuance,false);
assert.equal(manifest.transactionQueriesAdded,0);
assert.equal(candidate.replace(extension,old).replace(/9\.305/g,'9.304'),parent);
assert.doesNotMatch(extension,/\b(?:_nhAccessToken_|_nhForgetToken_)\s*\(|SpreadsheetApp|\.setProperty\s*\(/);
const accountNo='12345678901',otherNo='12345678902',simNo='12345678903',token='PRIVATE_CACHED_TEST_TOKEN';
const ok=rows=>({rsp_cd:'00166',rsp_msg:'조회가 완료되었습니다.',Output_0:rows});
function run(rows,auth=true){
 let calls=0;
 class FixedDate extends Date{
  constructor(...a){super(...(a.length?a:['2026-11-19T03:00:00Z']));}
  static now(){return Date.parse('2026-11-19T03:00:00Z');}
 }
 const ctx=vm.createContext({
  Date:FixedDate,_nhProxyAuthenticated_:()=>auth,_nhCredentials_:()=>({key:'k',secret:'s'}),_nhEnabled_:()=>true,
  _nhTokenScope_:()=> 'SCOPE',_nhValidTokenRecord_:()=>({token,expiresAt:Date.parse('2026-11-19T15:00:00Z')}),
  PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'TOKEN_RECORD'})},
  Utilities:{formatDate:d=>new Date(d.getTime()+9*3600000).toISOString().slice(0,10).replace(/-/g,''),sleep:()=>{throw Error('NO_TRANSACTION_SLEEP_ALLOWED');}},
  UrlFetchApp:{fetch(url,options){
   calls++;assert.equal(url,'https://api.nhplug.com:8443/n2/acctinfo');
   assert.equal(options.method,'post');
   assert.equal(JSON.parse(options.payload).Input_0?.act_no,undefined);
   assert.equal(options.headers.Authorization,'Bearer '+token);
   return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(ok(rows)),getAllHeaders:()=>({})};
  }},
  jsonError:message=>({status:'error',message}),jsonOk:value=>({status:'ok',...value})
 });
 vm.runInContext(extension,ctx);
 const result=ctx.handleDiagnoseNhFinancialIncome({mode:'accountScope'});
 return {result,calls};
}
const self={acct_no:accountNo,acct_type:'01'},operating={acct_no:otherNo,acct_type:'02'},sim={acct_no:simNo,acct_type:'03'};
const normal=run([self,operating,sim]);
assert.equal(normal.calls,1,'only account-list API is permitted');
const report=assessNhAccountScope(normal.result);
assert.equal(report.state,'OPERATING_02_REQUIRES_OWNERSHIP_REVIEW');
assert.equal(report.operating01,1);assert.equal(report.operating02,1);assert.equal(report.simulation03,1);
assert.equal(report.totalAccounts,3);
assert.equal(report.accountOwnershipVerified,false);
assert.equal(report.annualIncomeVerified,false);
assert.equal(report.transactionQueries,0);
assert.doesNotMatch(JSON.stringify(normal.result),/1234567890|PRIVATE_CACHED_TEST_TOKEN|act_no|acct_no|acct_type/);
assert.equal(assessNhAccountScope(run([self,sim]).result).state,'ONLY_OPERATING_01_VISIBLE');
assert.equal(assessNhAccountScope(run([operating,sim]).result).state,'OPERATING_02_REQUIRES_OWNERSHIP_REVIEW');
assert.equal(assessNhAccountScope(run([sim]).result).state,'NO_OPERATING_01_OR_02_VISIBLE');
assert.equal(assessNhAccountScope(run([]).result).totalAccounts,0);
const unknown=run([{acct_no:'12345678904',acct_type:'04'}]);
assert.equal(unknown.result.status,'error');
assert.equal(unknown.calls,1);
const duplicate=run([self,self]);assert.equal(duplicate.result.status,'error');
for(const invalidAccounts of [
 [operating,operating],
 [sim,sim],
 [{acct_type:'02'}],
 [{acct_type:'03'}],
 [self,{acct_no:accountNo,acct_type:'02'}],
 [operating,{acct_no:otherNo,acct_type:'03'}],
 [{acct_no:'invalid',acct_type:'02'}]
]) {
 const rejection=run(invalidAccounts);
 assert.equal(rejection.result.status,'error','malformed or duplicate 02/03 must be rejected');
 assert.equal(rejection.calls,1);
 assert.doesNotMatch(JSON.stringify(rejection.result),/1234567890|PRIVATE_CACHED_TEST_TOKEN/);
}
const denied=run([self],false);assert.equal(denied.calls,0);assert.equal(denied.result.status,'error');
for(const bad of [
 {...normal.result,accountOwnershipVerified:true},
 {...normal.result,annualIncomeVerified:true},
 {...normal.result,tokenIssued:true},
 {...normal.result,accountCounts:{...normal.result.accountCounts,operating02:0}},
 {...normal.result,accountCounts:{...normal.result.accountCounts,operating02:1,acct_no:accountNo}},
 {...normal.result,acct_no:accountNo},
 {...normal.result,transactionQueries:1},
 {...normal.result,totalAccounts:99}
])assert.throws(()=>assessNhAccountScope(bad),/NH_ACCOUNT_SCOPE_UNVERIFIED/);
let probeCount=0;
const fakeFetch=async(_endpoint,options)=>{
 probeCount++;
 assert.equal(options.method,'POST');
 assert.equal(options.body.get('action'),'diagnoseNhFinancialIncome');
 assert.equal(options.body.get('mode'),'accountScope');
 return {ok:true,json:async()=>normal.result};
};
const probed=await probeNhFinancialAccountScope({url:'https://script.google.com/macros/s/fake/exec',token:'FAKE_TEST_PRIVATE_TOKEN',fetchImpl:fakeFetch});
assert.equal(probeCount,1);
assert.equal(probed.transactionQueries,0);
assert.equal(probed.operating02,1);
await assert.rejects(()=>probeNhFinancialAccountScope({url:'https://script.google.com/macros/s/fake/exec',token:'FAKE_TEST_PRIVATE_TOKEN',fetchImpl:async()=>({ok:true,json:async()=>({...normal.result,acct_no:accountNo})})}),/NH_ACCOUNT_SCOPE_UNVERIFIED/);
console.log('PASS: 9.305 candidate, account-types-only, no transaction routes, no token issuance, no identifiers or tax assertions');
console.log('GAS9305_SOURCE_PREVIEW '+JSON.stringify(manifest));
