import fs from 'node:fs';
import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
export function buildIssue507LiveRelease(){
 const base=fs.readFileSync('reference/gas-v9.281.gs','utf8');
 if(sha(base)!=='ef01cde455f3f42447c718a4cb2efc62e2bfb984f05e354c6ef807d3dea65b1c')throw Error('BASE_CHANGED');
 const gate=fs.readFileSync('ops/issue507/writer-gate.gs','utf8');
 const repair=fs.readFileSync('ops/issue507/f00001-snapshot-repair.gs','utf8');
 const releaseId=sha(base+'\n'+gate+'\n'+repair+'\nLIVE_INLINE_9.282');
 let count=0;
 let source=base.replace(/^function (\w+)\s*\(([^)]*)\)\s*\{/gm,(all,name)=>{
  count++;return all+`\n  if (typeof _issue507GateInside_ !== 'undefined' && !_issue507GateInside_) return _issue507GateInvoke_('${name}', ${name}, this, arguments);`;
 });
 if(count!==555)throw Error('ENTRYPOINT_INVENTORY');
 source=source.replace(/(Google Apps Script\s+v)9\.281\b/,'$19.282')
  .replace(/(gasVersion\s*:\s*['"])9\.281(?=['"])/g,'$19.282');
 const note='//  v9.282 변경사항 (2026.10.31):\n//  • 전체 writer 진입/종료 gate, 무금융 OPEN bootstrap, 승인된 F00001 단건 복구\n//  • metadata 상태 조회 및 gate 제거 rollback 차단\n//\n';
 source=source.replace('//  v9.281 변경사항',note+'//  v9.281 변경사항');
 source+=`\nvar ISSUE507_GATE_RELEASE_ID='${releaseId}';\n${gate}\n${repair}\n`;
 source=source.trimEnd()+'\n';
 return {source,releaseId,entrypointCount:count};
}
