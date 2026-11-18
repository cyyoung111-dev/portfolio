// Source preview anchored to the exact published 9.297 candidate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {composeGas9297NavCollectorTwoStagePreview} from './compose-gas9297-nav-collector-two-stage-preview.mjs';
const parentBlob='7d303bedb019150798ffdd21bab43849d28d63a8';
const blob=s=>{const b=Buffer.from(s,'utf8');return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
function once(s,a,b){assert.equal(s.split(a).length,2,'NH_FINANCE_SOURCE_DRIFT');return s.replace(a,b);}
export function composeGas9298NhFinancialIncomePreview(){
 const parent=composeGas9297NavCollectorTwoStagePreview().candidate;
 assert.equal(blob(parent),parentBlob,'NH_FINANCE_UNREVIEWED_PARENT');
 let candidate=once(parent,"  if (params.action === 'getNhAuthStatusProxy') return handleGetNhAuthStatusProxy(params);",
   "  if (params.action === 'getNhAuthStatusProxy') return handleGetNhAuthStatusProxy(params);\n  if (params.action === 'diagnoseNhFinancialIncome') return handleDiagnoseNhFinancialIncome(params);");
 candidate=once(candidate,'//  📊 포트폴리오 대시보드 — Google Apps Script  v9.297','//  📊 포트폴리오 대시보드 — Google Apps Script  v9.298');
 assert.ok(candidate.split("gasVersion: '9.297'").length>=6);
 candidate=candidate.replaceAll("gasVersion: '9.297'","gasVersion: '9.298'");
 candidate=once(candidate,"var ISSUE507_GATE_API_VERSION='9.297'","var ISSUE507_GATE_API_VERSION='9.298'");
 const extension=fs.readFileSync(new URL('./nh-financial-income-readonly-proposal.gs',import.meta.url),'utf8');
 candidate+='\n'+extension;
 return {parent,candidate,manifest:{version:'9.298',parentVersion:'9.297',parentGitBlob:parentBlob,candidateGitBlob:blob(candidate),
   mode:'SOURCE_PREVIEW_ONLY',productionDeploymentApproved:false,requiresExplicitVersionReleaseGate:true,
   gasProjectWrites:0,financialWrites:0,oauthIssuance:false,changedBusinessFunctions:['doPost','handleDiagnoseNhFinancialIncome']}};
}
