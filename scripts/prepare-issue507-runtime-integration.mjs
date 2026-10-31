// Pure local candidate builder. No CLI, network, file writes or deploy action.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
export const BASE_SOURCE_SHA256='ef01cde455f3f42447c718a4cb2efc62e2bfb984f05e354c6ef807d3dea65b1c';
export function prepareIssue507Runtime({source=fs.readFileSync('reference/gas-v9.281.gs','utf8'),
 gate=fs.readFileSync('ops/issue507/writer-gate.gs','utf8'),
 repair=fs.readFileSync('ops/issue507/f00001-snapshot-repair.gs','utf8')}={}) {
 if(sha(source)!==BASE_SOURCE_SHA256)throw Error('ISSUE507_BASE_SOURCE_CHANGED');
 // Pinned source only: every original top-level declaration gets an admission
 // wrapper, including underscore helpers reachable through editor/API aliases.
 const names=[...source.matchAll(/^function (\w+)\s*\(/gm)].map(m=>m[1]);
 if(new Set(names).size!==names.length || names.length!==555)throw Error('ISSUE507_FUNCTION_INVENTORY');
 const releaseId=sha(source+'\n'+gate+'\n'+repair);
 const renamed=source.replace(/^function (\w+)\s*\(/gm,(_,name)=>`function _issue507Original_${name}_(`);
 const wrappers=names.map(name=>`function ${name}(){return _issue507GateInvoke_('${name}',_issue507Original_${name}_,this,arguments);}`).join('\n');
 const candidate=`${renamed}\nvar ISSUE507_GATE_RELEASE_ID='${releaseId}';\n${gate.replace("ISSUE507_GATE_API_VERSION='9.282'","ISSUE507_GATE_API_VERSION='9.281'")}\n${repair}\n${wrappers}\n`;
 return {candidate,manifest:{baseSourceSha256:sha(source),candidateSha256:sha(candidate),releaseId,
  entrypoints:names,entrypointCount:names.length,preparedOnly:true,deployable:false,
  productionSourceChanged:false,financeWriteAuthorized:false}};
}
