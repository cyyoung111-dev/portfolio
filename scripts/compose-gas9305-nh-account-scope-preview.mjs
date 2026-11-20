// Source preview only: 9.305 is not approved for deployment.
// Extend the exact published 9.304 candidate with account-type counts only.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {composeGas9304NhContinuationPreview} from './compose-gas9304-nh-continuation-preview.mjs';
const PIN='5b69d6b96f6ec26edc0772b561cc12125af4ebc3';
const blob=s=>{const b=Buffer.from(s,'utf8');return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
function once(s,oldText,newText){
 assert.equal(s.split(oldText).length,2,'NH_ACCOUNT_SCOPE_SOURCE_DRIFT');
 return s.replace(oldText,newText);
}
export function composeGas9305NhAccountScopePreview(){
 const {candidate:parent,extension:old}=composeGas9304NhContinuationPreview();
 assert.equal(blob(parent),PIN,'NH_ACCOUNT_SCOPE_UNREVIEWED_PARENT');
 let extension=once(old,"gasVersion: '9.304'","gasVersion: '9.305'");
 extension=once(extension,"gasVersion:'9.304'","gasVersion:'9.305'");
 extension=once(extension,
  "  var coverage=String(params.mode||'')==='coverage';\n  if (!coverage&&String(params.mode||'')!=='contract') return jsonError('NH_FINANCE_MODE_REQUIRED');",
  "  var coverage=String(params.mode||'')==='coverage';\n  var accountScope=String(params.mode||'')==='accountScope';\n  if (!coverage&&!accountScope&&String(params.mode||'')!=='contract') return jsonError('NH_FINANCE_MODE_REQUIRED');");
 extension=once(extension,
  "    var seen={},ids=[];",
  "    var seen={},ids=[],scopeCounts={operating01:0,operating02:0,simulation03:0};");
 extension=once(extension,
  "      if(a.acct_type!=='01'){out.otherAccountsSkipped++;continue;}",
  "      if(a.acct_type!=='01'){\n        out.otherAccountsSkipped++;\n        // For accountScope only, validate every account ID and its uniqueness.\n        // Existing contract/coverage behavior remains unchanged.\n        if(accountScope){\n          if(typeof a.acct_no!=='string'||!/^\\d{11}$/.test(a.acct_no)||seen[a.acct_no])return jsonError('NH_FINANCE_ACCOUNT_IDENTITY');\n          seen[a.acct_no]=true;\n        }\n        scopeCounts[a.acct_type==='02'?'operating02':'simulation03']++;\n        continue;\n      }");
 extension=once(extension,
  "      seen[a.acct_no]=true;ids.push(a.acct_no);",
  "      seen[a.acct_no]=true;ids.push(a.acct_no);scopeCounts.operating01++;");
 extension=once(extension,
  "    out.ownLiveAccounts=ids.length;",
  "    out.ownLiveAccounts=ids.length;\n    // Account type is the NH live/mock route, NOT ownership or tax type.\n    // No transaction inquiry, account number, balance, identifier or digest.\n    if(accountScope)return jsonOk({\n      provider:'NH',gasVersion:'9.305',mode:'ACCOUNT_SCOPE_ONLY',\n      readOnly:true,diagnosticOnly:true,accountListVerified:true,\n      accountOwnershipVerified:false,accountTaxTypeVerified:false,\n      annualIncomeVerified:false,fullYearCoverage:false,\n      financialTaxClassificationVerified:false,\n      financialOriginalWritten:false,tokenIssued:false,bearerExposed:false,\n      transactionQueries:0,\n      accountCounts:scopeCounts,\n      totalAccounts:scopeCounts.operating01+scopeCounts.operating02+scopeCounts.simulation03\n    });");
 let candidate=once(parent,old,extension);
 candidate=once(candidate,
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.304',
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.305');
 candidate=candidate.replace(/(gasVersion:\s*['"])9\.304(['"])/g,(_m,p,s)=>p+'9.305'+s);
 candidate=once(candidate,
  "var ISSUE507_GATE_API_VERSION='9.304'",
  "var ISSUE507_GATE_API_VERSION='9.305'");
 return {parent,candidate,extension,manifest:{
   version:'9.305',parentGitBlob:PIN,candidateGitBlob:blob(candidate),
   mode:'SOURCE_PREVIEW_ONLY',productionDeploymentApproved:false,
   gasProjectWrites:0,financialWrites:0,oauthIssuance:false,
   accountTypesOnly:true,transactionQueriesAdded:0
 }};
}
