import assert from 'node:assert/strict';
import vm from 'node:vm';
import {composeGas9301NhDiagnosticPreview} from './compose-gas9301-nh-diagnostic-preview.mjs';
import {assessNhFinancialIncomeReadback} from './nh-financial-income-readback.mjs';
import {assertGasReleaseReady} from './deploy-gas.mjs';
const {candidate,extension,manifest}=composeGas9301NhDiagnosticPreview();
new vm.Script(candidate);
assert(candidate.includes(extension));
assert.equal(manifest.productionDeploymentApproved,false);
assert.throws(()=>assertGasReleaseReady(candidate),/GAS_RELEASE_SOURCE_NOT_APPROVED/);
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
