// Exact published 9.303 parent; no deployment permission in this preview.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {composeGas9303NhCoveragePreview} from './compose-gas9303-nh-coverage-preview.mjs';
const PIN='fb0810c39f332d739214d31fbfe3876713a40c80';
const blob=s=>{const b=Buffer.from(s,'utf8');return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
function once(s,a,b){assert.equal(s.split(a).length,2,'NH_FINANCE_CTS_SOURCE_DRIFT');return s.replace(a,b);}
export function composeGas9304NhContinuationPreview(){
 const {candidate:parent,extension:old}=composeGas9303NhCoveragePreview();
 assert.equal(blob(parent),PIN,'NH_FINANCE_CTS_UNREVIEWED_PARENT');
 let extension=once(old,"gasVersion: '9.303'","gasVersion: '9.304'");
 extension=once(extension,"gasVersion:'9.303'","gasVersion:'9.304'");
 const helper=fs.readFileSync(new URL('./nh-financial-income-cts-proposal.gs',import.meta.url),'utf8');
 extension=once(extension,'    function read(path,input){',helper+'    function read(path,input){');
 extension=once(extension,
 "        if(!coverage)out.statusEvidence.push(evidence);\n        if(coverage&&evidence.code==='13578'&&evidence.messageClass==='NO_DATA_REPORTED'&&evidence.outputClass==='EMPTY_ARRAY'){\n          var h=res.getAllHeaders(),hasCts=Object.keys(h||{}).some(function(k){return k.toLowerCase()==='cts'&&String(h[k]||'').trim();});\n          if(!hasCts)return {state:'NO_DATA_REPORTED',evidence:evidence};\n        }",
 "        if(!coverage)out.statusEvidence.push(evidence);\n        var pagination=coverage?coverageContinuation(res.getAllHeaders(),body,evidence.code):null;\n        if(coverage&&evidence.code==='13578'&&evidence.messageClass==='NO_DATA_REPORTED'&&evidence.outputClass==='EMPTY_ARRAY'){\n          if(pagination.state==='LAST')return {state:'NO_DATA_REPORTED',evidence:evidence,pagination:pagination};\n          return {state:'CONTINUATION_UNVERIFIED',evidence:evidence,pagination:pagination};\n        }");
 extension=once(extension,"return {state:'SUCCESS_MESSAGE_UNVERIFIED',evidence:evidence};","return {state:'SUCCESS_MESSAGE_UNVERIFIED',evidence:evidence,pagination:pagination||null};");
 extension=once(extension,"return {state:'OUTPUT_MISSING',evidence:evidence};","return {state:'OUTPUT_MISSING',evidence:evidence,pagination:pagination||null};");
 extension=once(extension,"return {state:'OUTPUT_INVALID',evidence:evidence};","return {state:'OUTPUT_INVALID',evidence:evidence,pagination:pagination||null};");
 extension=once(extension,
 "return {state:'OK',rows:body.Output_0,continuation:continuation,evidence:evidence};",
 "if(coverage&&pagination&&pagination.state==='UNVERIFIED')return {state:'CONTINUATION_UNVERIFIED',evidence:evidence,pagination:pagination};\n      return {state:'OK',rows:body.Output_0,continuation:coverage&&pagination?pagination.state==='NEXT':continuation,evidence:evidence,pagination:pagination||null};");
 extension=once(extension,"continuation:false,evidence:page.evidence||null};","continuation:false,evidence:page.evidence||null,pagination:page.pagination||null};");
 let candidate=once(parent,old,extension);
 candidate=once(candidate,'//  📊 포트폴리오 대시보드 — Google Apps Script  v9.303','//  📊 포트폴리오 대시보드 — Google Apps Script  v9.304');
 candidate=candidate.replace(/(gasVersion:\s*['"])9\.303(['"])/g,(_m,p,s)=>p+'9.304'+s);
 candidate=once(candidate,"var ISSUE507_GATE_API_VERSION='9.303'","var ISSUE507_GATE_API_VERSION='9.304'");
 return {parent,candidate,extension,manifest:{version:'9.304',parentGitBlob:PIN,candidateGitBlob:blob(candidate),mode:'SOURCE_PREVIEW_ONLY',productionDeploymentApproved:false,gasProjectWrites:0,financialWrites:0,oauthIssuance:false}};
}
