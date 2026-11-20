import assert from 'node:assert/strict';
import vm from 'node:vm';
import {composeGas9303NhCoveragePreview} from './compose-gas9303-nh-coverage-preview.mjs';
import {composeGas9304NhContinuationPreview} from './compose-gas9304-nh-continuation-preview.mjs';
import {assessNhFinancialCoverage,assessNhFinancialCoverageStep} from './nh-financial-income-coverage-readback.mjs';
import {assertGasReleaseReady,extractExpectedGasVersion,assertIssue507ManualReleasePermission,assertGas9304Prerequisites} from './deploy-gas.mjs';
const {parent,candidate,extension,manifest}=composeGas9304NhContinuationPreview();
new vm.Script(candidate);
assert.equal(extractExpectedGasVersion(candidate),'9.304');
assert.equal(assertGasReleaseReady(parent),'9.303');
assert.equal(manifest.candidateGitBlob,'5b69d6b96f6ec26edc0772b561cc12125af4ebc3');
assert.equal(assertGasReleaseReady(candidate),'9.304');
assert.throws(()=>assertGasReleaseReady(candidate+'\n// drift'),/GAS_RELEASE_SOURCE_NOT_APPROVED/);
for(const eventName of ['push','workflow_run','workflow_dispatch'])
 assert.throws(()=>assertIssue507ManualReleasePermission({version:'9.304',eventName,approved9304:eventName!=='workflow_dispatch'}),/GAS_9304_EXPLICIT_MANUAL_RELEASE_REQUIRED/);
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({version:'9.304',eventName:'workflow_dispatch',approved9304:true}));
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({version:'9.304',eventName:'workflow_dispatch',dryRun:true}));
for(const [publishedVersion,liveIdleVerified] of [['9.302',true],['9.304',true],['9.303',false]])
 assert.throws(()=>assertGas9304Prerequisites({version:'9.304',publishedVersion,liveIdleVerified}),/GAS_9304_/);
assert.doesNotThrow(()=>assertGas9304Prerequisites({version:'9.304',publishedVersion:'9.303',liveIdleVerified:true}));
assert.equal(candidate.replace(extension,composeGas9303NhCoveragePreview().extension).replace(/9\.304/g,'9.303'),parent);
assert.equal(manifest.productionDeploymentApproved,false);
assert.doesNotMatch(extension,/\b(?:_nhAccessToken_|_nhForgetToken_)\s*\(|SpreadsheetApp|\.setProperty\s*\(/);
const token='FAKE_PRIVATE_TOKEN',id='12345678901',marker='PRIVATE_UPSTREAM_CONTENT';
const noData={rsp_cd:'13578',rsp_msg:'조회된 내역이 없습니다.',Output_0:[]};
const ok=(rows=[])=>({rsp_cd:'00166',rsp_msg:'조회가 완료되었습니다.',Output_0:rows});
function run(responder=()=>({body:noData}),count=1){
 const calls=[];
 class FixedDate extends Date{constructor(...a){super(...(a.length?a:['2026-11-19T03:00:00Z']));}static now(){return Date.parse('2026-11-19T03:00:00Z');}}
 const ctx=vm.createContext({Date:FixedDate,_nhProxyAuthenticated_:()=>true,_nhCredentials_:()=>({key:'k',secret:'s'}),_nhEnabled_:()=>true,
 _nhTokenScope_:()=> 'SCOPE',_nhValidTokenRecord_:()=>({token,expiresAt:Date.parse('2026-11-19T15:00:00Z')}),
 PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'FAKE'})},
 Utilities:{formatDate:d=>new Date(d.getTime()+9*3600000).toISOString().slice(0,10).replace(/-/g,''),sleep:()=>{}},
 UrlFetchApp:{fetch(url,opt){
  assert.equal(opt.headers.Authorization,'Bearer '+token);
  const input=JSON.parse(opt.payload).Input_0;
  if(url.endsWith('/n2/acctinfo')){
    assert.equal(calls.length,0);calls.push({route:'ACCOUNT'});
    return response({body:ok([...Array.from({length:count},(_,i)=>({acct_no:String(BigInt(id)+BigInt(i)),acct_type:'01'})),{acct_no:'99999999999',acct_type:'03'}])});
  }
  const route=url.endsWith('/totalTransaction')?'TOTAL':url.endsWith('/depositWithdrawal')?'DEPOSIT':'INVALID';
  assert.notEqual(route,'INVALID');assert.equal(input.iqr_tp_cd,'2');
  assert.equal(input.act_trd_dtl_cd,route==='TOTAL'?'00':'01');
  if(route==='TOTAL'){assert.equal(input.iqr_rge_cd,'2');assert.equal(input.iem_llf_cd,'00');}
  else{assert.equal(Object.hasOwn(input,'iqr_rge_cd'),false);assert.equal(Object.hasOwn(input,'iem_llf_cd'),false);}
  calls.push({route,from:input.iqr_sta_dt,to:input.iqr_end_dt});
  const page=responder({route,input},calls.length-1);if(page.network)throw Error(marker);return response(page);
 }},jsonError:message=>({status:'error',message}),jsonOk:out=>({status:'ok',...out})});
 function response({body,headers={},http=200,raw}){return {getResponseCode:()=>http,getContentText:()=>raw??JSON.stringify(body),getAllHeaders:()=>headers};}
 vm.runInContext(extension,ctx);
 const result=ctx.handleDiagnoseNhFinancialIncome({mode:'coverage'});
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_UPSTREAM_CONTENT|FAKE_PRIVATE_TOKEN|12345678901/);
 const p=assessNhFinancialCoverage(result,{asOf:'20261119',expectedVersion:'9.304'});
 assert.equal(p.annualIncomeVerified,false);assert.equal(p.fullYearCoverage,false);
 assert.equal(p.queryCount,calls.length-1);return {p,result,calls};
}
const empty=run();
assert.deepEqual(assessNhFinancialCoverageStep(empty.p),{kind:'NO_ROWS_REPORTED_WARNING',exitCode:0,annualIncomeVerified:false});
assert.throws(()=>assessNhFinancialCoverageStep({...empty.p,annualIncomeVerified:true}),/NH_FINANCE_COVERAGE_UNVERIFIED/);
assert.equal(empty.p.contractStatus,'NO_ROWS_REPORTED_YEAR_TO_DATE');
assert.equal(empty.p.noDataWindows,12);assert.equal(empty.p.accountsSampled,1);
assert.deepEqual(empty.calls[1],{route:'TOTAL',from:'20261101',to:'20261119'});
assert.deepEqual(empty.calls[11],{route:'TOTAL',from:'20260101',to:'20260131'});
assert.deepEqual(empty.calls[12],{route:'DEPOSIT',from:'20261021',to:'20261119'});
const historical=run(({route,input})=>({body:route==='TOTAL'&&input.iqr_sta_dt==='20260901'?ok([{trd_dt:'20260915',int_amt:10,tax_sum:1,sps_cd_krl_anm:marker}]):noData}));
assert.equal(assessNhFinancialCoverageStep(historical.p).exitCode,0);
assert.equal(historical.p.contractStatus,'TOTAL_ROWS_OBSERVED');assert.equal(historical.p.queryCount,11);assert.equal(historical.p.interestFieldRows,1);
const deposit=run(({route})=>({body:route==='DEPOSIT'?ok([{trd_dt:'20261101',trd_amt:1000,act_trd_tp_nm:marker}]):noData}));
assert.equal(assessNhFinancialCoverageStep(deposit.p).exitCode,2);
assert.equal(deposit.p.contractStatus,'DEPOSIT_ROWS_ONLY');assert.equal(deposit.p.depositRows,1);assert.equal(deposit.p.interestFieldRows,0);
const continued=run((_p,i)=>i===1?{body:ok([]),headers:{cts:'PRIVATE_UPSTREAM_CONTENT',cts_flag:'Y'}}:{body:noData});
assert.equal(assessNhFinancialCoverageStep(continued.p).exitCode,2);
assert.equal(continued.p.contractStatus,'CONTINUATION_UNVERIFIED');assert.equal(continued.p.queryCount,11);
for(const [page,reason] of [[{body:noData,headers:{cts:'PRIVATE_UPSTREAM_CONTENT',cts_flag:'Y'}},'CONTINUATION_UNVERIFIED'],[{body:noData,headers:{cts_flag:'Y'}},'CONTINUATION_UNVERIFIED'],[{body:noData,headers:{cts_flag:['Y','N']}},'CONTINUATION_UNVERIFIED'],[{body:{...noData,Output_0:[{}]}},'SUCCESS_MESSAGE_UNVERIFIED'],[{body:{...noData,rsp_msg:'조회가 완료되었습니다.'}},'SUCCESS_MESSAGE_UNVERIFIED'],[{http:429},'HTTP_429'],[{network:true},'NETWORK_UNVERIFIED']]){
 const got=run(()=>page);assert.equal(assessNhFinancialCoverageStep(got.p).exitCode,2);assert.equal(got.p.stopped,reason);assert.equal(got.p.queryCount,1);assert.equal(got.p.contractStatus,'PARTIAL_COVERAGE_SAMPLE');
}
const capped=run(()=>({body:noData}),2);
assert.equal(capped.p.stopped,'QUERY_LIMIT');assert.equal(capped.p.queryCount,16);assert.equal(capped.p.accountsSampled,1);
for(const patch of [{windows:[]},{accountsSampled:0},{windows:[{...empty.result.windows[0],from:'20261102'},...empty.result.windows.slice(1)]},{windows:[{...empty.result.windows[0],rows:1},...empty.result.windows.slice(1)]}]){
 assert.throws(()=>assessNhFinancialCoverage({...empty.result,...patch},{expectedVersion:'9.304'}),/NH_FINANCE_COVERAGE_UNVERIFIED/);
}
for(const headers of [{cts:marker,cts_flag:'N'},{CTS:marker},{cts:[marker],CTS_FLAG:['n']}]){
 const got=run(()=>({body:noData,headers}));
 assert.equal(got.p.noDataWindows,12);
 assert.equal(got.p.queryCount,12);
 assert.equal(got.p.contractStatus,'NO_ROWS_REPORTED_YEAR_TO_DATE');
 assert.equal(got.p.windows[0].pagination.state,'LAST');
 assert.equal(got.p.windows[0].pagination.keyClass,'HEADER');
 assert.doesNotMatch(JSON.stringify(got.p),/PRIVATE_UPSTREAM_CONTENT/);
}
const continuedByCode=run((_p,i)=>i===1?{body:{...ok([]),rsp_cd:'00165'},headers:{cts:marker}}:{body:noData});
assert.equal(continuedByCode.p.continuationWindows,1);
const bodyKey=run((_p,i)=>i===1?{body:{...ok([]),Output_1:{ctsz16:marker}}}:{body:noData});
assert.equal(bodyKey.p.windows[0].pagination.keyClass,'BODY');
assert.equal(bodyKey.p.continuationWindows,1);
const rejectedBodyKey=run(()=>({body:{...noData,Output_1:{ctsz16:marker}}}));
assert.equal(rejectedBodyKey.p.stopped,'CONTINUATION_UNVERIFIED');
const invalidMeta={...empty.result,windows:[{...empty.result.windows[0],pagination:{flagClass:'Y',keyClass:'HEADER',state:'LAST'}},...empty.result.windows.slice(1)]};
assert.throws(()=>assessNhFinancialCoverage(invalidMeta,{expectedVersion:'9.304'}),/NH_FINANCE_COVERAGE_UNVERIFIED/);
console.log('PASS: official SDK pagination semantics, masked 13578 terminal/ambiguous distinction, prior exact source and bounded sample');
console.log('GAS9304_SOURCE_PREVIEW '+JSON.stringify(manifest));
