import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import YAML from 'yaml';
import {assertGasReleaseReady,assertIssue507ManualReleasePermission,assertGas9298Prerequisites} from './deploy-gas.mjs';
import {readGas9298ReleaseProof} from './gas9298-release-readonly.mjs';
import {assertPublishedReleaseFundNavSupport} from './issue860-fund-nav-release-compat.mjs';
import {assessNhFinancialIncomeReadback,probeNhFinancialIncome} from './nh-financial-income-readback.mjs';
import {composeGas9298NhFinancialIncomePreview} from './compose-gas9298-nh-financial-income-preview.mjs';
const {parent,candidate,manifest}=composeGas9298NhFinancialIncomePreview();
assert.equal(manifest.parentGitBlob,'7d303bedb019150798ffdd21bab43849d28d63a8');
assert.equal(manifest.productionDeploymentApproved,false);
assert.equal(manifest.financialWrites,0);
assert.match(candidate,/params.action === 'diagnoseNhFinancialIncome'\) return handleDiagnoseNhFinancialIncome\(params\)/);
new vm.Script(candidate);
const extension=fs.readFileSync(new URL('./nh-financial-income-readonly-proposal.gs',import.meta.url),'utf8');
assert.doesNotMatch(extension,/\b(?:_nhAccessToken_|_nhForgetToken_)\s*\(/);
assert.doesNotMatch(extension,/SpreadsheetApp|\.setProperty\s*\(|\.setProperties\s*\(|\.deleteProperty\s*\(/);
const token='FAKE_PRIVATE_TOKEN',id='12345678901',privateMarker='PRIVATE_ORIGINAL_VALUE';
const sample={trd_dt:'20261118',int_amt:12345,tax_sum:1901,cur_cd:'KRW',sps_cd_krl_anm:'이자입금',opi_cus_fnm:privateMarker};
const accountRows=[{acct_no:id,acct_type:'01'},{acct_no:'12345678902',acct_type:'02'},{acct_no:'12345678903',acct_type:'03'}];
function fixture({authorized=true,cached=true,accounts=accountRows,pages=[{rows:[sample,{...sample,int_amt:null,tax_sum:'',cur_cd:'USD'}],cts:'NEXT_PRIVATE'}],mode='contract'}={}){
 const calls=[];
 class FixedDate extends Date{constructor(...a){super(...(a.length?a:['2026-11-18T03:00:00Z']));}static now(){return Date.parse('2026-11-18T03:00:00Z');}}
 const ctx=vm.createContext({Date:FixedDate,_nhProxyAuthenticated_:()=>authorized,
  _nhCredentials_:()=>({key:'FAKE_KEY',secret:'FAKE_SECRET'}),_nhEnabled_:()=>true,
  _nhTokenScope_:()=> 'SCOPE',_nhValidTokenRecord_:()=>cached?{token,expiresAt:Date.parse('2026-11-18T15:00:00Z')}:null,
  PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'MOCK_CACHE'})},
  Utilities:{formatDate:(d)=>new Date(d.getTime()+9*3600000).toISOString().slice(0,10).replace(/-/g,''),sleep:()=>{}},
  UrlFetchApp:{fetch(url,opt){
   const path=new URL(url).pathname,input=JSON.parse(opt.payload).Input_0;
   assert.equal(opt.headers.Authorization,'Bearer '+token);assert.equal(opt.followRedirects,false);
   calls.push({path,input});const p=path==='/n2/acctinfo'?{rows:accounts}:pages[calls.length-2]||{rows:[]};
   return {getResponseCode:()=>p.http||200,getAllHeaders:()=>p.cts?{CtS:p.cts}:{},
     getContentText:()=>JSON.stringify({rsp_msg:p.message??'조회가 완료되었습니다.',...(p.omit?{}:{Output_0:p.rows})})};
  }},
  jsonError:message=>({status:'error',message}),jsonOk:out=>({status:'ok',...out})
 });
 vm.runInContext(extension,ctx);
 return {out:ctx.handleDiagnoseNhFinancialIncome({mode}),calls};
}
let v=fixture();
assert.equal(v.out.status,'ok');assert.equal(v.out.ownLiveAccounts,1);assert.equal(v.out.otherAccountsSkipped,2);
assert.equal(v.out.rows,2);assert.equal(v.out.interestFieldRows,1);assert.equal(v.out.positiveInterestFieldRows,1);
assert.equal(v.out.taxFieldRows,1);assert.equal(v.out.continuationPresent,1);assert.equal(v.out.fullYearCoverage,false);
assert.equal(v.out.financialTaxClassificationVerified,false);assert.equal(v.out.accountTaxTypeVerified,false);
assert.deepEqual(v.calls.map(c=>c.path),['/n2/acctinfo','/common/inquiry/v1/totalTransaction']);
assert.equal(v.calls[1].input.act_no,id);assert.equal(v.calls[1].input.iqr_rge_cd,'2');
assert.equal(v.calls[1].input.iqr_sta_dt,'20261020');
assert.equal(v.calls[1].input.iqr_end_dt,'20261118');
assert.doesNotMatch(JSON.stringify(v.out),/FAKE_PRIVATE_TOKEN|12345678901|PRIVATE_ORIGINAL_VALUE|12345|1901|NEXT_PRIVATE|이자입금/);
for(const opt of [{authorized:false},{cached:false},{mode:'other'}]){
 v=fixture(opt);assert.equal(v.out.status,'error');assert.equal(v.calls.length,0);
}
v=fixture({accounts:[accountRows[0],accountRows[0]]});assert.equal(v.out.status,'error');assert.equal(v.calls.length,1);
v=fixture({accounts:[accountRows[0],{acct_no:'12345678905',acct_type:'01'}],pages:[{http:429}]});
assert.equal(v.out.stopped,'HTTP_429');assert.equal(v.out.accountsProbed,1);assert.equal(v.calls.length,2);
v=fixture({pages:[{omit:true,message:'조회가 완료되었습니다.'}]});
assert.equal(v.out.accountsRejected,1);assert.equal(v.out.accountsSucceeded,0);
v=fixture({pages:[{rows:[sample],message:'오류'}]});
assert.equal(v.out.accountsRejected,1);assert.equal(v.out.rows,0);
v=fixture({accounts:[]});assert.equal(v.out.ownLiveAccounts,0);assert.equal(v.out.fullYearCoverage,false);
console.log('PASS: 9.298 anchored read-only NH account/interest contract; no OAuth, no private amounts, no annual zero inference');


const sampleProof=fixture().out;
const readback=assessNhFinancialIncomeReadback({...sampleProof,unexpectedPrivateField:privateMarker});
assert.equal(readback.contractStatus,'FIELDS_OBSERVED');
assert.equal(readback.annualIncomeVerified,false);
assert.equal(readback.sampleHasContinuation,true);
assert.equal(readback.financeWrites,0);
assert.doesNotMatch(JSON.stringify(readback),/PRIVATE_ORIGINAL_VALUE|12345|1901|NEXT_PRIVATE/);
assert.equal(assessNhFinancialIncomeReadback(fixture({accounts:[]}).out).contractStatus,'NO_SELF_OWNED_ACCOUNTS');
assert.equal(assessNhFinancialIncomeReadback(fixture({pages:[{rows:[]}]}).out).contractStatus,'NO_SAMPLE_ROWS');
assert.equal(assessNhFinancialIncomeReadback(fixture({pages:[{http:429}]}).out).contractStatus,'PARTIAL_ACCOUNT_SAMPLE');
for(const invalid of [{gasVersion:'9.297'},{tokenIssued:true},{annualIncomeVerified:true,fullYearCoverage:true},
 {accountsSucceeded:2},{interestFieldRows:3},{krwRows:3},{stopped:'RAW_PRIVATE'}]){
 assert.throws(()=>assessNhFinancialIncomeReadback({...sampleProof,...invalid}),/NH_FINANCE_READBACK_/);
}
const simulated=await probeNhFinancialIncome({url:'https://script.google.com/macros/s/TEST_READ_ONLY/exec',
 token:'FAKE_GAS_ACCESS_TOKEN',fetchImpl:async(_url,options)=>{
  assert.equal(options.method,'POST');
  assert.equal(options.body.get('action'),'diagnoseNhFinancialIncome');
  assert.equal(options.body.get('mode'),'contract');
  return {ok:true,json:async()=>sampleProof};
 }});
assert.deepEqual(simulated,assessNhFinancialIncomeReadback(sampleProof));
console.log('GAS9298_REVIEWED_CANDIDATE '+JSON.stringify({version:manifest.version,parentGitBlob:manifest.parentGitBlob,
 candidateGitBlob:manifest.candidateGitBlob,productionDeploymentApproved:false,financeWrites:0}));

assert.equal(manifest.candidateGitBlob,'0674f15661314131e4bd16ea4c161d03227839bf');
assert.equal(assertGasReleaseReady(candidate),'9.298');
assert.throws(()=>assertGasReleaseReady(candidate+'\n// drift'),/GAS_RELEASE_SOURCE_NOT_APPROVED/);
assert.deepEqual(assertPublishedReleaseFundNavSupport('9.298'),{version:'9.298',kb:true,hanwha:true,financialWrites:0});
for(const eventName of ['push','workflow_run','workflow_dispatch'])assert.throws(()=>assertIssue507ManualReleasePermission({
 version:'9.298',eventName,approved9298:eventName!=='workflow_dispatch'}),/GAS_9298_EXPLICIT_MANUAL_RELEASE_REQUIRED/);
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({version:'9.298',eventName:'workflow_dispatch',approved9298:true}));
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({version:'9.298',eventName:'workflow_dispatch',dryRun:true}));
for(const [publishedVersion,liveIdleVerified] of [['9.296',true],['9.297',false],['9.298',true]])
 assert.throws(()=>assertGas9298Prerequisites({version:'9.298',publishedVersion,liveIdleVerified}),/GAS_9298_/);
assert.doesNotThrow(()=>assertGas9298Prerequisites({version:'9.298',publishedVersion:'9.297',liveIdleVerified:true}));
const state=version=>({status:'VERIFIED',version,tradeRows:338,writerGateMode:'OPEN',activeCount:0,
 tradeSnapshotDeferredCount:0,pendingCount:0,financeWrites:0});
const hashes=version=>({status:'CONSISTENT',gasVersion:version,rows:338,uniqueIds:338,migrationPreview:{
 status:'VERIFIED',physicalRevisionMatchesGasGetTrades:true,physicalRevisionMatchesPcCanonical:true,
 rowCountMatchesApi:true,assignedIdsNeeded:0,existingIdsPreserved:338}});
for(const mode of ['pre','post']){
 const version=mode==='pre'?'9.297':'9.298';
 const result=await readGas9298ReleaseProof({mode,readState:async v=>state(v),readHash:async()=>hashes(version)});
 assert.equal(result.version,version);assert.equal(result.tradeV2HashVerified,true);
 await assert.rejects(()=>readGas9298ReleaseProof({mode,readState:async v=>({...state(v),activeCount:1}),readHash:async()=>hashes(version)}),/FINANCIAL_INTEGRITY_UNVERIFIED/);
 await assert.rejects(()=>readGas9298ReleaseProof({mode,readState:async v=>state(v),readHash:async()=>hashes('9.296')}),/GAS9298_LEDGER_INTEGRITY_UNVERIFIED/);
}
let proofAttempts=0;
const retried=await readGas9298ReleaseProof({readState:async v=>{
 if(++proofAttempts===1)throw Error('GAS9295_READONLY_NETWORK_UNVERIFIED');
 return state(v)},readHash:async()=>hashes('9.297'),delay:async()=>{}});
assert.equal(retried.readbackAttempts,2);
await assert.rejects(()=>readGas9298ReleaseProof({readState:async()=>{throw Error('GAS9295_READONLY_VERSION_MISMATCH')},readHash:async()=>hashes('9.297'),delay:async()=>assert.fail('preflight version mismatch cannot retry')}),/VERSION_MISMATCH/);
const wf=YAML.parse(fs.readFileSync('.github/workflows/gas-deploy.yml','utf8'));
const inputs=(wf.on??wf.true).workflow_dispatch.inputs;
assert.equal(inputs.approve_9298.default,false);
assert(inputs.candidate_version.options.includes('9.298'));
const deploySteps=wf.jobs.deploy.steps;
const pre=deploySteps.find(s=>s.id==='gas9298_gate'),dep=deploySteps.find(s=>s.name==='Deploy GAS');
const probe=deploySteps.find(s=>s.name==='Verify NH financial income live sample (no token issuance)');
assert(pre&&dep&&probe);
assert.equal(pre['continue-on-error'],undefined);
assert.match(dep.env.GAS_9298_LIVE_PREFLIGHT_VERIFIED,/gas9298_gate/);
assert(deploySteps.indexOf(pre)<deploySteps.indexOf(dep)&&deploySteps.indexOf(dep)<deploySteps.indexOf(probe));
assert.match(probe.if,/GAS_DEPLOY_DRY_RUN != 'true'/);
assert.match(deploySteps.find(s=>s.name==='Activate NH current prices after real GAS deployment').if,/GAS_9298_NH_FINANCIAL_INCOME != 'true'/);
console.log('PASS: 9.298 immutable manual release, exact ledger and NAV compatibility, no OAuth financial probe');
