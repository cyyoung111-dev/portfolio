import assert from 'node:assert/strict';
import vm from 'node:vm';
import {composeGas9301NhDiagnosticPreview} from './compose-gas9301-nh-diagnostic-preview.mjs';
import {assessNhFinancialIncomeReadback} from './nh-financial-income-readback.mjs';
import fs from 'node:fs';
import YAML from 'yaml';
import {assertGasReleaseReady,extractExpectedGasVersion,assertIssue507ManualReleasePermission,assertGas9301Prerequisites} from './deploy-gas.mjs';
const {parent,candidate,extension,manifest}=composeGas9301NhDiagnosticPreview();
new vm.Script(candidate);
assert(candidate.includes(extension));
assert.equal(manifest.productionDeploymentApproved,false);
assert.equal(extractExpectedGasVersion(candidate),'9.301');
assert.equal(assertGasReleaseReady(parent),'9.300');
assert.match(candidate,/gasVersion:'9\.301'/);
assert.equal(manifest.candidateGitBlob,'d82ddb8fdf5893c61129ee533217de3c7637717a');
assert.equal(assertGasReleaseReady(candidate),'9.301');
assert.throws(()=>assertGasReleaseReady(candidate+'\n// drift'),/GAS_RELEASE_SOURCE_NOT_APPROVED/);
// The only executable delta apart from version literals is the diagnostic handler.
const original=fs.readFileSync('scripts/nh-financial-income-readonly-proposal.gs','utf8').replace("gasVersion: '9.298'","gasVersion: '9.300'");
assert.equal(candidate.replace(extension,original).replace(/9\.301/g,'9.300'),parent);
for(const eventName of ['push','workflow_run','workflow_dispatch'])
 assert.throws(()=>assertIssue507ManualReleasePermission({version:'9.301',eventName,approved9301:eventName!=='workflow_dispatch'}),/GAS_9301_EXPLICIT_MANUAL_RELEASE_REQUIRED/);
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({version:'9.301',eventName:'workflow_dispatch',approved9301:true}));
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({version:'9.301',eventName:'workflow_dispatch',dryRun:true}));
for(const [publishedVersion,liveIdleVerified] of [['9.297',true],['9.301',true],['9.300',false]])
 assert.throws(()=>assertGas9301Prerequisites({version:'9.301',publishedVersion,liveIdleVerified}),/GAS_9301_/);
assert.doesNotThrow(()=>assertGas9301Prerequisites({version:'9.301',publishedVersion:'9.300',liveIdleVerified:true}));
assert.doesNotMatch(extension,/\b(?:_nhAccessToken_|_nhForgetToken_)\s*\(|SpreadsheetApp|\.setProperty\s*\(/);
const token='FAKE_PRIVATE_TOKEN',id='12345678901',marker='PRIVATE_UPSTREAM_CONTENT';
function run(page){
 let calls=0;
 class FixedDate extends Date{constructor(...a){super(...(a.length?a:['2026-11-19T03:00:00Z']));}static now(){return Date.parse('2026-11-19T03:00:00Z');}}
 const ctx=vm.createContext({Date:FixedDate,_nhProxyAuthenticated_:()=>true,_nhCredentials_:()=>({key:'k',secret:'s'}),_nhEnabled_:()=>true,
 _nhTokenScope_:()=> 'SCOPE',_nhValidTokenRecord_:()=>({token,expiresAt:Date.parse('2026-11-19T15:00:00Z')}),
 PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'FAKE'})},
 Utilities:{formatDate:d=>new Date(d.getTime()+9*3600000).toISOString().slice(0,10).replace(/-/g,''),sleep:()=>{}},
 UrlFetchApp:{fetch(url,opt){
  calls++;assert.equal(opt.headers.Authorization,'Bearer '+token);
  if(calls===1){assert(url.endsWith('/n2/acctinfo'));return response(200,JSON.stringify({rsp_msg:'조회가 완료되었습니다.',Output_0:[{acct_no:id,acct_type:'01'}]}));}
  assert(url.endsWith('/common/inquiry/v1/totalTransaction'));assert.equal(JSON.parse(opt.payload).Input_0.act_no,id);
  if(page.network)throw Error(marker);
  return response(page.http??200,page.raw??JSON.stringify(page.body));
 }},
 jsonError:message=>({status:'error',message}),jsonOk:out=>({status:'ok',...out})});
 function response(http,raw){return {getResponseCode:()=>http,getContentText:()=>raw,getAllHeaders:()=>({})};}
 vm.runInContext(extension,ctx);
 const result=ctx.handleDiagnoseNhFinancialIncome({mode:'contract'});
 assert.equal(calls,2,'one query per account, no retry');
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_UPSTREAM_CONTENT|FAKE_PRIVATE_TOKEN|12345678901/);
 return result;
}
for(const [page,reason] of [
 [{http:500,raw:marker},'HTTP_OTHER'],[{http:429,raw:marker},'HTTP_429'],
 [{http:401,raw:marker},'HTTP_401'],[{http:403,raw:marker},'HTTP_403'],
 [{network:true},'NETWORK_UNVERIFIED'],[{raw:'not JSON '+marker},'INVALID_JSON'],
 [{body:{rsp_msg:marker}},'SUCCESS_MESSAGE_UNVERIFIED'],
 [{body:{rsp_msg:'조회가 완료되었습니다.'}},'OUTPUT_MISSING'],
 [{body:{rsp_msg:'조회가 완료되었습니다.',Output_0:{private:marker}}},'OUTPUT_INVALID']
]){
 const r=run(page);assert.equal(r.accountsRejected,1);assert.equal(r.rejectReasons[reason],1);
 const proof=assessNhFinancialIncomeReadback(r,'9.301');
 assert.equal(proof.contractStatus,'PARTIAL_ACCOUNT_SAMPLE');assert.equal(proof.rejectReasons[reason],1);assert.equal(proof.annualIncomeVerified,false);
 assert.throws(()=>assessNhFinancialIncomeReadback({...r,rejectReasons:{...r.rejectReasons,[reason]:0}},'9.301'),/REJECT_REASONS/);
}
const ok=run({body:{rsp_msg:'조회가 완료되었습니다.',Output_0:[{trd_dt:'20261119',int_amt:10,tax_sum:1,cur_cd:'KRW',sps_cd_krl_anm:marker}]}});
const proof=assessNhFinancialIncomeReadback(ok,'9.301');
assert.equal(proof.contractStatus,'FIELDS_OBSERVED');
assert.equal(proof.annualIncomeVerified,false);
assert.throws(()=>assessNhFinancialIncomeReadback({...ok,rejectReasons:{...ok.rejectReasons,unknown:0}},'9.301'),/REJECT_REASONS/);
const empty=run({body:{rsp_msg:'조회가 완료되었습니다.',Output_0:[]}});
assert.equal(assessNhFinancialIncomeReadback(empty,'9.301').contractStatus,'NO_SAMPLE_ROWS');
console.log('PASS: 9.301 preview preserves pinned 9.300, safe NH rejection categories, no retry, no production approval, no annual zero inference');

console.log('GAS9301_SOURCE_PREVIEW '+JSON.stringify(manifest));

const wf=YAML.parse(fs.readFileSync('.github/workflows/gas-deploy.yml','utf8'));
const inputs=wf.on.workflow_dispatch.inputs;
assert.deepEqual(Object.keys(inputs),['operation']);
assert.equal(inputs.operation.default,'진단만');
assert.deepEqual(inputs.operation.options,['진단만','9.305 실제 배포']);
const job=wf.jobs.deploy,steps=job.steps,pre=steps.find(s=>s.id==='gas9304_gate'),dep=steps.find(s=>s.name==='Deploy GAS');
const dryInv=steps.find(s=>s.name==='Require clean full GAS deployment inventory on 9.304 dry-run');
const liveInv=steps.find(s=>s.name==='Require clean full GAS deployment inventory before real deploy');
const probe=steps.find(s=>s.name==='Verify NH financial income live sample (no token issuance)');
assert(pre&&dep&&dryInv&&liveInv&&probe);
assert.equal(pre.run,'node scripts/gas9298-release-readonly.mjs pre 9.304');
assert.equal(dryInv.run,liveInv.run);assert.equal(dryInv['continue-on-error'],undefined);
assert.match(dryInv.if,/GAS_9304_NH_DIAGNOSTIC == 'true'/);assert.match(dryInv.if,/GAS_DEPLOY_DRY_RUN == 'true'/);
assert(steps.indexOf(dryInv)<steps.indexOf(pre)&&steps.indexOf(liveInv)<steps.indexOf(pre)&&steps.indexOf(pre)<steps.indexOf(dep)&&steps.indexOf(dep)<steps.indexOf(probe));
assert.equal(pre['continue-on-error'],undefined);
assert.match(pre.if,/GAS_9304_RELEASE_APPROVAL == 'true'/);assert.match(pre.if,/GAS_DEPLOY_DRY_RUN == 'true'/);
assert.match(dep.env.GAS_9304_LIVE_PREFLIGHT_VERIFIED,/gas9304_gate/);
assert.equal(job.env.GAS_9304_RELEASE_APPROVAL,'false');
assert.match(job.env.GAS_9305_RELEASE_APPROVAL,/workflow_dispatch.*inputs\.operation == '9\.305 실제 배포'/);
assert.equal(probe.env.NH_FINANCE_EXPECTED_VERSION,'9.304');
assert.equal(probe.run,'node scripts/nh-financial-income-coverage-readback.mjs');
assert.match(probe.if,/GAS_DEPLOY_DRY_RUN != 'true'/);
assert.match(steps.find(s=>s.name==='Activate NH current prices after real GAS deployment').if,/GAS_9304_NH_DIAGNOSTIC != 'true'/);
console.log('PASS: pinned 9.304 source and exact 9.303 predecessor, explicit approval, ordered live/dry-run read-only checks');
