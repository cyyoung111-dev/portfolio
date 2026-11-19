// Unapproved source preview; preserve the exact published 9.300 parent.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {composeGas9300TaxScenarioSyncPreview} from './compose-gas9300-tax-scenario-sync-preview.mjs';
const PIN='984f8e6db408b8803827205682610b457f1e82ca';
const blob=s=>{const b=Buffer.from(s,'utf8');return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
function once(s,a,b){assert.equal(s.split(a).length,2,'NH_FINANCE_DIAGNOSTIC_SOURCE_DRIFT');return s.replace(a,b);}
export function composeGas9301NhDiagnosticPreview(){
 const parent=composeGas9300TaxScenarioSyncPreview().candidate;
 assert.equal(blob(parent),PIN,'NH_FINANCE_DIAGNOSTIC_UNREVIEWED_PARENT');
 const original=fs.readFileSync(new URL('./nh-financial-income-readonly-proposal.gs',import.meta.url),'utf8').replace("gasVersion: '9.298'","gasVersion: '9.300'");
 let extension=once(original,"gasVersion: '9.300'","gasVersion: '9.301'");
 extension=once(extension,"descriptionPresentRows:0,stopped:'NONE'","descriptionPresentRows:0,stopped:'NONE',rejectReasons:{TOKEN_EXPIRES:0,HTTP_401:0,HTTP_403:0,HTTP_429:0,HTTP_OTHER:0,NETWORK_UNVERIFIED:0,INVALID_JSON:0,SUCCESS_MESSAGE_UNVERIFIED:0,OUTPUT_MISSING:0,OUTPUT_INVALID:0}");
 extension=once(extension,"      var res=UrlFetchApp.fetch(","      var res;\n      try { res=UrlFetchApp.fetch(");
 extension=once(extension,"payload:JSON.stringify({Input_0:input})});","payload:JSON.stringify({Input_0:input})}); } catch(ignore){return {state:'NETWORK_UNVERIFIED'};}");
 extension=once(extension,"      if(!/조회가 완료되었습니다[.]?$/.test(msg)||!Array.isArray(body.Output_0))return {state:'RESPONSE_UNVERIFIED'};",
 "      if(!body||typeof body!=='object'||Array.isArray(body))return {state:'INVALID_JSON'};\n      if(!/조회가 완료되었습니다[.]?$/.test(msg))return {state:'SUCCESS_MESSAGE_UNVERIFIED'};\n      if(!Object.prototype.hasOwnProperty.call(body,'Output_0'))return {state:'OUTPUT_MISSING'};\n      if(!Array.isArray(body.Output_0))return {state:'OUTPUT_INVALID'};");
 extension=once(extension,"        out.accountsRejected++;","        out.accountsRejected++;\n        if(!Object.prototype.hasOwnProperty.call(out.rejectReasons,page.state))throw Error('NH_FINANCE_UNKNOWN_REJECT');\n        out.rejectReasons[page.state]++;");
 let candidate=once(parent,original,extension);
 candidate=once(candidate,'//  📊 포트폴리오 대시보드 — Google Apps Script  v9.300','//  📊 포트폴리오 대시보드 — Google Apps Script  v9.301');
 assert(candidate.split("gasVersion: '9.300'").length>=6);
 // Match exactly the deployment parser's recognized response fields, including compact tax sync literals.
 candidate=candidate.replace(/(gasVersion:\s*['"])9\.300(['"])/g,(_match,prefix,suffix)=>prefix+'9.301'+suffix);
 candidate=once(candidate,"var ISSUE507_GATE_API_VERSION='9.300'","var ISSUE507_GATE_API_VERSION='9.301'");
 return {parent,candidate,extension,manifest:{version:'9.301',parentGitBlob:PIN,candidateGitBlob:blob(candidate),mode:'SOURCE_PREVIEW_ONLY',productionDeploymentApproved:false,gasProjectWrites:0,financialWrites:0,oauthIssuance:false}};
}
