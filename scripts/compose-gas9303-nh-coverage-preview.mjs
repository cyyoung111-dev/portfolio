// Immutable published 9.302 parent. No deployment approval in this preview.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {composeGas9302NhStatusPreview} from './compose-gas9302-nh-status-preview.mjs';
const PIN='3ce5accf9289e5a156342f6a8ca4a89fae3c128d';
const blob=s=>{const b=Buffer.from(s,'utf8');return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
function once(s,a,b){assert.equal(s.split(a).length,2,'NH_FINANCE_COVERAGE_SOURCE_DRIFT');return s.replace(a,b);}
export function composeGas9303NhCoveragePreview(){
 const {candidate:parent,extension:old}=composeGas9302NhStatusPreview();
 assert.equal(blob(parent),PIN,'NH_FINANCE_COVERAGE_UNREVIEWED_PARENT');
 let extension=once(old,"gasVersion: '9.302'","gasVersion: '9.303'");
 extension=once(extension,"  if (String(params.mode||'')!=='contract') return jsonError('NH_FINANCE_MODE_REQUIRED');",
 "  var coverage=String(params.mode||'')==='coverage';\n  if (!coverage&&String(params.mode||'')!=='contract') return jsonError('NH_FINANCE_MODE_REQUIRED');");
 extension=once(extension,"if(path!=='/n2/acctinfo'&&path!=='/common/inquiry/v1/totalTransaction')",
 "if(path!=='/n2/acctinfo'&&path!=='/common/inquiry/v1/totalTransaction'&&!(coverage&&path==='/common/inquiry/v1/depositWithdrawal'))");
 extension=once(extension,"var evidence=path==='/common/inquiry/v1/totalTransaction'?statusEvidence(body):null;",
 "var evidence=path==='/common/inquiry/v1/totalTransaction'||coverage&&path==='/common/inquiry/v1/depositWithdrawal'?statusEvidence(body):null;");
 extension=once(extension,"        out.statusEvidence.push(evidence);\n        if(evidence.messageClass!=='COMPLETE'||!/^[0-9]{5}$/.test(evidence.code))return {state:'SUCCESS_MESSAGE_UNVERIFIED'};",
 "        if(!coverage)out.statusEvidence.push(evidence);\n        if(coverage&&evidence.code==='13578'&&evidence.messageClass==='NO_DATA_REPORTED'&&evidence.outputClass==='EMPTY_ARRAY'){\n          var h=res.getAllHeaders(),hasCts=Object.keys(h||{}).some(function(k){return k.toLowerCase()==='cts'&&String(h[k]||'').trim();});\n          if(!hasCts)return {state:'NO_DATA_REPORTED',evidence:evidence};\n        }\n        if(evidence.messageClass!=='COMPLETE'||!/^[0-9]{5}$/.test(evidence.code)||coverage&&['13578','11512','16935'].includes(evidence.code))return {state:'SUCCESS_MESSAGE_UNVERIFIED',evidence:evidence};");
 extension=once(extension,"return {state:'OUTPUT_MISSING'};","return {state:'OUTPUT_MISSING',evidence:evidence};");
 extension=once(extension,"return {state:'OUTPUT_INVALID'};","return {state:'OUTPUT_INVALID',evidence:evidence};");
 extension=once(extension,"return {state:'OK',rows:body.Output_0,continuation:continuation};","return {state:'OK',rows:body.Output_0,continuation:continuation,evidence:evidence};");
 const helper=fs.readFileSync(new URL('./nh-financial-income-coverage-proposal.gs',import.meta.url),'utf8');
 extension=once(extension,"    for(var j=0;j<Math.min(ids.length,12);j++){",helper+"\n    if(coverage)return coverageSample();\n    for(var j=0;j<Math.min(ids.length,12);j++){");
 let candidate=once(parent,old,extension);
 candidate=once(candidate,'//  📊 포트폴리오 대시보드 — Google Apps Script  v9.302','//  📊 포트폴리오 대시보드 — Google Apps Script  v9.303');
 candidate=candidate.replace(/(gasVersion:\s*['"])9\.302(['"])/g,(_m,p,s)=>p+'9.303'+s);
 candidate=once(candidate,"var ISSUE507_GATE_API_VERSION='9.302'","var ISSUE507_GATE_API_VERSION='9.303'");
 return {parent,candidate,extension,manifest:{version:'9.303',parentGitBlob:PIN,candidateGitBlob:blob(candidate),mode:'SOURCE_PREVIEW_ONLY',productionDeploymentApproved:false,gasProjectWrites:0,financialWrites:0,oauthIssuance:false}};
}
