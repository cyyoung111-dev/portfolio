import assert from 'node:assert/strict';
import vm from 'node:vm';
import {composeGas9301NhDiagnosticPreview} from './compose-gas9301-nh-diagnostic-preview.mjs';
import {composeGas9302NhStatusPreview} from './compose-gas9302-nh-status-preview.mjs';
import {assessNhFinancialIncomeReadback} from './nh-financial-income-readback.mjs';
import {assertGasReleaseReady,extractExpectedGasVersion} from './deploy-gas.mjs';
const {parent,candidate,extension,manifest}=composeGas9302NhStatusPreview();
new vm.Script(candidate);
assert(candidate.includes(extension));
assert.equal(manifest.productionDeploymentApproved,false);
assert.equal(extractExpectedGasVersion(candidate),'9.302');
assert.equal(assertGasReleaseReady(parent),'9.301');
assert.throws(()=>assertGasReleaseReady(candidate),/GAS_RELEASE_UNREVIEWED_VERSION: 9\.302/);
assert.equal(candidate.replace(extension,composeGas9301NhDiagnosticPreview().extension).replace(/9\.302/g,'9.301'),parent);
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

const row={trd_dt:'20261119',int_amt:10,tax_sum:1,cur_cd:'KRW',sps_cd_krl_anm:marker};
for(const msg of ['조회가 완료되었습니다.','정상적으로 조회되었습니다.','조회가 정상적으로 완료되었습니다','조회되었습니다.']){
 const r=run({body:{rsp_cd:'10000',rsp_msg:msg,Output_0:[row]}});
 assert.equal(r.accountsSucceeded,1);
 const proof=assessNhFinancialIncomeReadback(r,'9.302');
 assert.equal(proof.contractStatus,'FIELDS_OBSERVED');
 assert.equal(proof.annualIncomeVerified,false);
 assert.equal(Object.getPrototypeOf(proof.statusEvidence),Array.prototype);
 assert.deepEqual(proof.statusEvidence,[{code:'10000',envelope:'TOP',messageClass:'COMPLETE',outputClass:'NONEMPTY_ARRAY'}]);
}
for(const [body,reason,code,messageClass,outputClass] of [
 [{rsp_cd:'IGW40301',rsp_msg:'조회가 완료되었습니다.',Output_0:[row]},'SUCCESS_MESSAGE_UNVERIFIED','IGW40301','COMPLETE','NONEMPTY_ARRAY'],
 [{rsp_cd:'10000',rsp_msg:marker,Output_0:[row]},'SUCCESS_MESSAGE_UNVERIFIED','10000','OTHER','NONEMPTY_ARRAY'],
 [{rsp_cd:'12345678901',rsp_msg:'조회가 완료되었습니다.',Output_0:[row]},'SUCCESS_MESSAGE_UNVERIFIED','UNRECOGNIZED','COMPLETE','NONEMPTY_ARRAY'],
 [{rsp_msg:'조회가 완료되었습니다.',Output_0:[row]},'SUCCESS_MESSAGE_UNVERIFIED','ABSENT','COMPLETE','NONEMPTY_ARRAY'],
 [{rsp_cd:'10000',rsp_msg:'조회된 내역이 없습니다.'},'SUCCESS_MESSAGE_UNVERIFIED','10000','NO_DATA_REPORTED','MISSING'],
 [{rsp_cd:'10000',rsp_msg:'조회가 완료되었습니다.'},'OUTPUT_MISSING','10000','COMPLETE','MISSING'],
 [{rsp_cd:'10000',rsp_msg:'조회가 완료되었습니다.',Output_0:{private:marker}},'OUTPUT_INVALID','10000','COMPLETE','INVALID'],
 [{rsp_cd:'10000',rsp_msg:'조회가 완료되었습니다.',message:{rsp_cd:'IGW40301',rsp_msg:marker},Output_0:[row]},'SUCCESS_MESSAGE_UNVERIFIED','CONFLICT','CONFLICT','NONEMPTY_ARRAY'],
 [{rsp_cd:'10000',rsp_msg:'오류: 조회가 완료되었습니다.',Output_0:[row]},'SUCCESS_MESSAGE_UNVERIFIED','10000','OTHER','NONEMPTY_ARRAY']
]){
 const r=run({body}),p=assessNhFinancialIncomeReadback(r,'9.302');
 assert.equal(p.contractStatus,'PARTIAL_ACCOUNT_SAMPLE');assert.equal(p.annualIncomeVerified,false);
 assert.equal(p.rejectReasons[reason],1);assert.equal(p.statusEvidence[0].code,code);
 assert.equal(p.statusEvidence[0].messageClass,messageClass);assert.equal(p.statusEvidence[0].outputClass,outputClass);
 assert.doesNotMatch(JSON.stringify(p),/PRIVATE_UPSTREAM_CONTENT|FAKE_PRIVATE_TOKEN|12345678901/);
}
const nested=run({body:{message:{rsp_cd:'10001',rsp_msg:'조회가 완료되었습니다.'},Output_0:[]}});
const empty=assessNhFinancialIncomeReadback(nested,'9.302');
assert.equal(empty.contractStatus,'NO_SAMPLE_ROWS');assert.equal(empty.statusEvidence[0].envelope,'NESTED');
assert.equal(empty.annualIncomeVerified,false);
for(const patch of [{statusEvidence:[]},{statusEvidence:[{...empty.statusEvidence[0],code:marker}]},{statusEvidence:[{...empty.statusEvidence[0],outputClass:'MISSING'}]}]){
 assert.throws(()=>assessNhFinancialIncomeReadback({...nested,...patch},'9.302'),/STATUS_EVIDENCE/);
}
for(const page of [{http:429,raw:marker},{network:true},{raw:'not JSON'}]){
 const p=assessNhFinancialIncomeReadback(run(page),'9.302');assert.equal(p.statusEvidence.length,0);
 assert.equal(p.contractStatus,'PARTIAL_ACCOUNT_SAMPLE');
}
console.log('PASS: pinned 9.301 parent, documented code/message/block checks, no private response or annual zero inference');
console.log('GAS9302_SOURCE_PREVIEW '+JSON.stringify(manifest));
