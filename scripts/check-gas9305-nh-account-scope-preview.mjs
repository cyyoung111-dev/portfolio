import assert from 'node:assert/strict';
import vm from 'node:vm';
import {composeGas9304NhContinuationPreview} from './compose-gas9304-nh-continuation-preview.mjs';
import {composeGas9305NhAccountScopePreview} from './compose-gas9305-nh-account-scope-preview.mjs';
import {assessNhAccountScope} from './nh-financial-account-scope-readback.mjs';
const {candidate:parent,extension:old}=composeGas9304NhContinuationPreview();
const {parent:reviewed,candidate,extension,manifest}=composeGas9305NhAccountScopePreview();
assert.equal(parent,reviewed,'published parent must remain exact');
new vm.Script(candidate);
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
console.log('PASS: 9.305 candidate, account-types-only, no transaction routes, no token issuance, no identifiers or tax assertions');
console.log('GAS9305_SOURCE_PREVIEW '+JSON.stringify(manifest));
