// Source preview only. Preserve the exact published 9.301 parent and all other handlers.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {composeGas9301NhDiagnosticPreview} from './compose-gas9301-nh-diagnostic-preview.mjs';
const PIN='d82ddb8fdf5893c61129ee533217de3c7637717a';
const blob=s=>{const b=Buffer.from(s,'utf8');return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
function once(s,a,b){assert.equal(s.split(a).length,2,'NH_FINANCE_STATUS_SOURCE_DRIFT');return s.replace(a,b);}
export function composeGas9302NhStatusPreview(){
 const prior=composeGas9301NhDiagnosticPreview(),parent=prior.candidate;
 assert.equal(blob(parent),PIN,'NH_FINANCE_STATUS_UNREVIEWED_PARENT');
 let extension=once(prior.extension,"gasVersion: '9.301'","gasVersion: '9.302'");
 extension=once(extension,"descriptionPresentRows:0,stopped:'NONE',rejectReasons:","descriptionPresentRows:0,stopped:'NONE',statusEvidence:[],rejectReasons:");
 // Accept only complete, narrowly anchored wording with a valid response
 // code and actual Output_0 array. Never infer success from HTTP or code alone.
 const helper=String.raw`    function statusEvidence(body){
      var nested=body.message&&typeof body.message==='object'&&!Array.isArray(body.message)?body.message:{};
      var norm=function(v){return typeof v==='string'?v.trim():'';};
      var topCode=norm(body.rsp_cd),nestedCode=norm(nested.rsp_cd);
      var topMsg=norm(body.rsp_msg),nestedMsg=norm(nested.rsp_msg);
      var conflict=!!(topCode&&nestedCode&&topCode!==nestedCode||topMsg&&nestedMsg&&topMsg!==nestedMsg);
      var code=topCode||nestedCode,msg=topMsg||nestedMsg;
      var safeCode=/^(?:[0-9]{5}|IGW[0-9]{5})$/.test(code)?code:code?'UNRECOGNIZED':'ABSENT';
      // Never return the original message or other fields. Keep status code
      // only when it matches the documented five-digit/gateway code format.
      var messageClass=conflict?'CONFLICT':
       /^(?:조회가 완료되었습니다|정상적으로 조회되었습니다|조회가 정상적으로 완료되었습니다|조회되었습니다)[.]?$/.test(msg)?'COMPLETE':
       /^(?:조회 결과가 없습니다|조회된 내역이 없습니다|조회된 데이터가 없습니다|조회할 내역이 없습니다|조회 내역이 없습니다)[.]?$/.test(msg)?'NO_DATA_REPORTED':
       msg?'OTHER':'ABSENT';
      var outputClass=!Object.prototype.hasOwnProperty.call(body,'Output_0')?'MISSING':
       !Array.isArray(body.Output_0)?'INVALID':body.Output_0.length?'NONEMPTY_ARRAY':'EMPTY_ARRAY';
      return {code:conflict?'CONFLICT':safeCode,messageClass:messageClass,outputClass:outputClass,
       envelope:topCode||topMsg?nestedCode||nestedMsg?'BOTH':'TOP':nestedCode||nestedMsg?'NESTED':'ABSENT'};
    }
`;
 extension=once(extension,'    function read(path,input){',helper+'    function read(path,input){');
 extension=once(extension,
 "      if(!/조회가 완료되었습니다[.]?$/.test(msg))return {state:'SUCCESS_MESSAGE_UNVERIFIED'};\n      if(!Object.prototype.hasOwnProperty.call(body,'Output_0'))return {state:'OUTPUT_MISSING'};\n      if(!Array.isArray(body.Output_0))return {state:'OUTPUT_INVALID'};",
 "      var evidence=path==='/common/inquiry/v1/totalTransaction'?statusEvidence(body):null;\n      if(evidence){\n        out.statusEvidence.push(evidence);\n        if(evidence.messageClass!=='COMPLETE'||!/^[0-9]{5}$/.test(evidence.code))return {state:'SUCCESS_MESSAGE_UNVERIFIED'};\n      }else if(!/조회가 완료되었습니다[.]?$/.test(msg))return {state:'SUCCESS_MESSAGE_UNVERIFIED'};\n      if(!Object.prototype.hasOwnProperty.call(body,'Output_0'))return {state:'OUTPUT_MISSING'};\n      if(!Array.isArray(body.Output_0))return {state:'OUTPUT_INVALID'};");
 let candidate=once(parent,prior.extension,extension);
 candidate=once(candidate,'//  📊 포트폴리오 대시보드 — Google Apps Script  v9.301','//  📊 포트폴리오 대시보드 — Google Apps Script  v9.302');
 candidate=candidate.replace(/(gasVersion:\s*['"])9\.301(['"])/g,(_match,prefix,suffix)=>prefix+'9.302'+suffix);
 candidate=once(candidate,"var ISSUE507_GATE_API_VERSION='9.301'","var ISSUE507_GATE_API_VERSION='9.302'");
 return {parent,candidate,extension,manifest:{version:'9.302',parentGitBlob:PIN,candidateGitBlob:blob(candidate),mode:'SOURCE_PREVIEW_ONLY',productionDeploymentApproved:false,gasProjectWrites:0,financialWrites:0,oauthIssuance:false}};
}
