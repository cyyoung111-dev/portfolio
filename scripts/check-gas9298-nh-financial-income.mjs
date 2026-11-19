import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import YAML from 'yaml';
import {assertGasReleaseReady,assertIssue507ManualReleasePermission,assertGas9298Prerequisites} from './deploy-gas.mjs';
import {readGas9298ReleaseProof,readReleaseVersionGate,assertReleaseVersionGateAfterHash} from './gas9298-release-readonly.mjs';
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
assert.equal(Object.hasOwn(inputs,'approve_9298'),false);
assert(!inputs.candidate_version.options.includes('9.298'));
assert.equal(wf.jobs.deploy.env.GAS_9298_NH_FINANCIAL_INCOME,'false');
assert.equal(wf.jobs.deploy.env.GAS_9298_RELEASE_APPROVAL,'false');
const deploySteps=wf.jobs.deploy.steps;
const pre=deploySteps.find(s=>s.id==='gas9304_gate'),dep=deploySteps.find(s=>s.name==='Deploy GAS');
const probe=deploySteps.find(s=>s.name==='Verify NH financial income live sample (no token issuance)');
assert(pre&&dep&&probe);
assert.equal(pre['continue-on-error'],undefined);
assert.match(dep.env.GAS_9304_LIVE_PREFLIGHT_VERIFIED,/gas9304_gate/);
assert(deploySteps.indexOf(pre)<deploySteps.indexOf(dep)&&deploySteps.indexOf(dep)<deploySteps.indexOf(probe));
assert.match(probe.if,/GAS_DEPLOY_DRY_RUN != 'true'/);
assert.match(deploySteps.find(s=>s.name==='Activate NH current prices after real GAS deployment').if,/GAS_9298_NH_FINANCIAL_INCOME != 'true'/);
console.log('PASS: 9.298 immutable manual release, exact ledger and NAV compatibility, no OAuth financial probe');

const oneShot=YAML.parse(fs.readFileSync('.github/workflows/gas-production-inventory-readonly.yml','utf8'));
const oneShotOn=oneShot.on??oneShot.true,job=oneShot.jobs.inspect;
assert.deepEqual(oneShotOn.push.branches,['main']);
assert.deepEqual(oneShotOn.push.paths,['.github/workflows/gas-production-inventory-readonly.yml']);
assert.equal(oneShotOn.schedule,undefined);
assert.equal(job.if,"github.repository == 'cyyoung111-dev/portfolio' && github.ref == 'refs/heads/main' && (github.event_name == 'workflow_dispatch' || github.event_name == 'push') && github.run_attempt <= 3");
assert.equal(oneShotOn.workflow_dispatch.inputs.verify_9304.default,false);
assert.equal(oneShotOn.workflow_dispatch.inputs.verify_9304.type,'boolean');
const mainStep=job.steps.find(s=>s.name==='Verify current main before release preflight or rerun');
assert(mainStep);
assert.match(mainStep.run,/assertCurrentMainRelease/);
assert.match(mainStep.run,/process.env.GITHUB_SHA/);
assert.equal(mainStep['continue-on-error'],undefined);
assert(job.steps.indexOf(mainStep)<job.steps.findIndex(s=>s.run?.includes('issue507-deployment-inventory-readonly.mjs')));
assert.equal(job.environment,'portfolio-production-gas');
assert.equal(job.concurrency.group,'gas-production-deploy');
const preStep=job.steps.find(s=>s.id==='finance_preflight');
const dryStep=job.steps.find(s=>s.name==='GAS 9.304 NH diagnostic dry-run only (no production code write)');
assert(preStep&&dryStep);
assert.equal(preStep.if,"github.event_name == 'push' || inputs.verify_9304 == true");
assert.equal(dryStep.if,"github.event_name == 'push' || inputs.verify_9304 == true");
assert.equal(mainStep.if,preStep.if);
assert.equal(job.steps[0].with.ref,'${{ github.sha }}');
assert.equal(job.steps[0].with['persist-credentials'],false);
assert.equal(dryStep.env.GAS_DEPLOY_DRY_RUN,'true');
assert.equal(dryStep.env.GAS_9304_RELEASE_APPROVAL,'false');
assert.match(dryStep.env.GAS_9304_LIVE_PREFLIGHT_VERIFIED,/finance_preflight\.outputs\.verified/);
assert.equal(dryStep.run,'node scripts/deploy-gas.mjs');
assert.equal(preStep['continue-on-error'],undefined);
assert(job.steps.findIndex(s=>s.run?.includes('issue507-deployment-inventory-readonly.mjs'))<job.steps.indexOf(preStep));
assert(job.steps.indexOf(preStep)<job.steps.indexOf(dryStep));
console.log('PASS: protected current-main 9.298 dry-run, bounded operator reruns, explicit production approval remains separate');

{
 const deploySource=fs.readFileSync('scripts/deploy-gas.mjs','utf8');
 const preflightSource=fs.readFileSync('scripts/gas9298-release-readonly.mjs','utf8');
 assert.match(preflightSource,/reportBlockedAutomation:row=>console\.log\(JSON\.stringify\(row\)\)/);
 assert.match(preflightSource,/expectedVersion,reportBlockedAutomation/);
 assert.match(deploySource,/if\(expectedVersion==='9\.298'\)\{\s*const integrityReadback=await verifyGas9298ReleaseReadOnly\(\{url,token:accessToken,mode:'post'\}\)/);
 assert.equal((deploySource.match(/await verifyGas9298ReleaseReadOnly\(/g)||[]).length,2);
}
console.log('PASS: 9.298 blocker evidence wired and existing in-deploy post-readback preserved');

// getTrades omits gasVersion, whereas the authenticated gate reports it.
{
 const getTrades=candidate.slice(candidate.indexOf('function handleGetTrades('),candidate.indexOf('\n}',candidate.indexOf('function handleGetTrades('))+2);
 const jsonOk=candidate.slice(candidate.indexOf('function jsonOk('),candidate.indexOf('\n}',candidate.indexOf('function jsonOk('))+2);
 assert.doesNotMatch(getTrades,/gasVersion\s*:/);
 assert.doesNotMatch(jsonOk,/gasVersion\s*:/);
 const gate=version=>({status:'ok',gasVersion:version,writerGate:{mode:'OPEN',activeCount:0,activeOwners:[],repairAuthorized:false,timeoutRetirementCandidates:0}});
 const readState=async v=>state(v),readHash=async()=>hashes('UNSPECIFIED');
 for(const [mode,candidateVersion,version] of [['pre','9.298','9.297'],['post','9.298','9.298'],['pre','9.300','9.297'],['post','9.300','9.300'],['pre','9.301','9.300'],['post','9.301','9.301'],['pre','9.302','9.301'],['post','9.302','9.302'],['pre','9.303','9.302'],['post','9.303','9.303'],['pre','9.304','9.303'],['post','9.304','9.304']]){
  let order=[];
  const result=await readGas9298ReleaseProof({mode,candidateVersion,
   readState:async v=>{order.push('state');assert.equal(v,version);return state(v)},
   readHash:async()=>{order.push('hash');return hashes('UNSPECIFIED')},
   readVersionGate:async v=>{order.push('gate');assert.equal(v,version);return gate(v)}});
  assert.deepEqual(order,['state','hash','gate']);
  assert.equal(result.version,version);assert.equal(result.tradeV2HashVerified,true);
  assert.equal(result.ledgerVersionEvidence,'VERSIONED_GATE_AFTER_HASH');
 }
 await assert.rejects(()=>readGas9298ReleaseProof({readState,readHash}),/LEDGER_VERSION_UNVERIFIED/);
 for(const patch of [{gasVersion:'9.298'},{status:'error'},{writerGate:{...gate('9.297').writerGate,activeCount:1}},{writerGate:{...gate('9.297').writerGate,timeoutRetirementCandidates:1}},{writerGate:{...gate('9.297').writerGate,activeOwners:[{}]}}]){
  await assert.rejects(()=>readGas9298ReleaseProof({readState,readHash,readVersionGate:async()=>({...gate('9.297'),...patch})}),/LEDGER_VERSION_UNVERIFIED/);
 }
 await assert.rejects(()=>readGas9298ReleaseProof({readState,readHash:async()=>hashes('9.296'),readVersionGate:async()=>assert.fail('explicit mismatch cannot fall back')}),/LEDGER_INTEGRITY_UNVERIFIED/);
 await assert.rejects(()=>readGas9298ReleaseProof({readState,readHash:async()=>({...hashes('UNSPECIFIED'),status:'MISMATCH'}),readVersionGate:async()=>assert.fail('hash mismatch cannot fall back')}),/FINANCIAL_INTEGRITY_UNVERIFIED/);
 await assert.rejects(()=>readGas9298ReleaseProof({readState,readHash:async()=>({...hashes('UNSPECIFIED'),migrationPreview:{...hashes('UNSPECIFIED').migrationPreview,assignedIdsNeeded:1}}),readVersionGate:async()=>assert.fail('ID mismatch cannot fall back')}),/LEDGER_INTEGRITY_UNVERIFIED/);
 const read=await readReleaseVersionGate({url:'https://script.google.com/macros/s/TEST_READ_ONLY/exec',token:'FAKE_GAS_ACCESS_TOKEN',fetchImpl:async(url,options)=>{
  assert.equal(options.method,'GET');assert.equal(new URL(url).searchParams.get('action'),'getWriterGateStatus');
  return {ok:true,json:async()=>gate('9.297')};
 }});
 assert.doesNotThrow(()=>assertReleaseVersionGateAfterHash(read,'9.297'));
 const gate9300=gate('9.300'),g=gate9300.writerGate;
 for(const [response,reason] of [
  [{status:'error',message:'PRIVATE_RAW_RESPONSE'},'RESPONSE_STATUS'],
  [{...gate9300,gasVersion:'PRIVATE_VERSION'},'VERSION_MISMATCH'],
  [{...gate9300,writerGate:{...g,mode:'DRAINING'}},'MODE'],
  [{...gate9300,writerGate:{...g,activeCount:null}},'ACTIVE_COUNT_INVALID'],
  [{...gate9300,writerGate:{...g,activeCount:1,activeOwners:[{owner:'PRIVATE_OWNER'}]}},'ACTIVE_WRITER'],
  [{...gate9300,writerGate:{...g,repairAuthorized:true}},'REPAIR_STATE'],
  [{...gate9300,writerGate:{...g,timeoutRetirementCandidates:1}},'RETIREMENT_STATE'],
  [{...gate9300,writerGate:{...g,activeOwners:[{owner:'PRIVATE_OWNER'}]}},'OWNER_STATE']
 ]){
  let reads=0;
  await assert.rejects(()=>readGas9298ReleaseProof({candidateVersion:'9.301',readState:async v=>state(v),readHash,
   readVersionGate:async()=>{reads++;return response;},delay:async()=>assert.fail('gate mismatch cannot retry')}),
   e=>e.message==='GAS9298_LEDGER_VERSION_UNVERIFIED_'+reason);
  assert.equal(reads,1);
 }
 // Recent, well-formed concurrent owners can delay ONE current preflight;
 // all prior status/hash evidence is discarded and the full proof is repeated.
 const busy={...gate9300,writerGate:{...g,activeCount:1,activeOwners:[
  {functionName:'doPost',ageMinutes:0,terminalReceiptPresent:false,retirementEligible:false,startedKst:'PRIVATE_OWNER'}
 ]}};
 async function recheck({gates,mode='pre',candidateVersion='9.301',hashVersion='UNSPECIFIED',secondHash}={}){
  const order=[],waits=[],reports=[];let hashReads=0,gateReads=0;
  const promise=readGas9298ReleaseProof({mode,candidateVersion,
   readState:async v=>{order.push('state');return state(v)},
   readHash:async()=>{order.push('hash');hashReads++;return hashReads===2&&secondHash?secondHash:hashes(hashVersion)},
   readVersionGate:async()=>{order.push('gate');return gates[Math.min(gateReads++,gates.length-1)]},
   delay:async ms=>{order.push('wait');waits.push(ms)},
   reportWriterWait:row=>reports.push(row)});
  return {promise,order,waits,reports};
 }
 const recovered=await recheck({gates:[busy,gate9300]});
 assert.equal((await recovered.promise).readbackAttempts,2);
 assert.deepEqual(recovered.order,['state','hash','gate','wait','state','hash','gate']);
 assert.deepEqual(recovered.waits,[45000]);assert.equal(recovered.reports.length,1);
 assert.deepEqual(recovered.reports[0].writerClasses,['doPost']);
 assert.equal(recovered.reports[0].financeWrites,0);
 assert(!JSON.stringify(recovered.reports).includes('PRIVATE_OWNER'));
 const busy9301={...busy,gasVersion:'9.301'};
 const recovered9302=await recheck({candidateVersion:'9.302',gates:[busy9301,gate('9.301')]});
 const result9302=await recovered9302.promise;
 assert.equal(result9302.kind,'GAS9302_RELEASE_READONLY');assert.equal(result9302.version,'9.301');
 assert.deepEqual(recovered9302.order,['state','hash','gate','wait','state','hash','gate']);
 assert.deepEqual(recovered9302.waits,[45000]);
 assert.equal(recovered9302.reports[0].kind,'GAS9302_READONLY_WRITER_WAIT');
 const busy9302={...busy,gasVersion:'9.302'};
 const recovered9303=await recheck({candidateVersion:'9.303',gates:[busy9302,gate('9.302')]});
 const result9303=await recovered9303.promise;
 assert.equal(result9303.kind,'GAS9303_RELEASE_READONLY');assert.equal(result9303.version,'9.302');
 assert.deepEqual(recovered9303.order,['state','hash','gate','wait','state','hash','gate']);
 assert.deepEqual(recovered9303.waits,[45000]);
 assert.equal(recovered9303.reports[0].kind,'GAS9303_READONLY_WRITER_WAIT');
 const busy9303={...busy,gasVersion:'9.303'};
 const recovered9304=await recheck({candidateVersion:'9.304',gates:[busy9303,gate('9.303')]});
 const result9304=await recovered9304.promise;
 assert.equal(result9304.kind,'GAS9304_RELEASE_READONLY');assert.equal(result9304.version,'9.303');
 assert.deepEqual(recovered9304.order,['state','hash','gate','wait','state','hash','gate']);
 assert.deepEqual(recovered9304.waits,[45000]);
 assert.equal(recovered9304.reports[0].kind,'GAS9304_READONLY_WRITER_WAIT');
 const stillBusy=await recheck({gates:[busy,busy]});
 await assert.rejects(stillBusy.promise,/LEDGER_VERSION_UNVERIFIED_ACTIVE_WRITER/);
 assert.deepEqual(stillBusy.waits,[45000]);
 const moved=await recheck({gates:[busy,gate9300],secondHash:{...hashes('UNSPECIFIED'),status:'MISMATCH'}});
 await assert.rejects(moved.promise,/FINANCIAL_INTEGRITY_UNVERIFIED/);
 assert.deepEqual(moved.waits,[45000]);
 const stale=await recheck({gates:[{...busy,writerGate:{...busy.writerGate,activeOwners:[{...busy.writerGate.activeOwners[0],ageMinutes:6}]}}]});
 await assert.rejects(stale.promise,/LEDGER_VERSION_UNVERIFIED_ACTIVE_WRITER/);
 assert.deepEqual(stale.waits,[]);
 const retirement=await recheck({gates:[{...busy,writerGate:{...busy.writerGate,timeoutRetirementCandidates:1}}]});
 await assert.rejects(retirement.promise,/LEDGER_VERSION_UNVERIFIED_RETIREMENT_STATE/);
 assert.deepEqual(retirement.waits,[]);
 const post=await recheck({mode:'post',gates:[{...busy,gasVersion:'9.301'}]});
 await assert.rejects(post.promise,/LEDGER_VERSION_UNVERIFIED_ACTIVE_WRITER/);
 assert.deepEqual(post.waits,[]);
 const legacy=await recheck({candidateVersion:'9.300',gates:[{...busy,gasVersion:'9.297'}]});
 await assert.rejects(legacy.promise,/LEDGER_VERSION_UNVERIFIED_ACTIVE_WRITER/);
 assert.deepEqual(legacy.waits,[]);
 for(const [status,reason] of [[401,'HTTP_AUTH'],[403,'HTTP_AUTH'],[429,'HTTP_RATE_LIMIT'],[502,'HTTP_GATEWAY'],[500,'HTTP_OTHER']]){
  await assert.rejects(()=>readReleaseVersionGate({url:'https://script.google.com/macros/s/TEST_READ_ONLY/exec',token:'FAKE_GAS_ACCESS_TOKEN',
   fetchImpl:async()=>({ok:false,status})}),e=>e.message==='GAS9298_LEDGER_VERSION_UNVERIFIED_'+reason);
 }
 await assert.rejects(()=>readReleaseVersionGate({url:'https://script.google.com/macros/s/TEST_READ_ONLY/exec',token:'FAKE_GAS_ACCESS_TOKEN',
  fetchImpl:async()=>({ok:true,json:async()=>{throw Error('PRIVATE_RAW_RESPONSE')}})}),/LEDGER_VERSION_UNVERIFIED_JSON/);
}
console.log('PASS: versionless trade response uses independent exact version and idle gate after full ledger hash/ID proof; mismatch still blocks');
