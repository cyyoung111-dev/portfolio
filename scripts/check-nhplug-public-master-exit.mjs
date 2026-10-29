import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir=mkdtempSync(join(tmpdir(),'nh-master-test-'));
try {
  const preload=join(dir,'mock.mjs');
  writeFileSync(preload, `
    const scenario=process.env.MASTER_SCENARIO;
    const header='@record 164\\nchar sGIC[15]; /* @0 */\\nchar sNationCode[3]; /* @95 */\\nchar sSymbol[12]; /* @98 */';
    function row(symbol, code) { const b=Buffer.alloc(164,32); b.write(code,0); b.write('USA',95); b.write(symbol,98); b[163]=10; return b; }
    const bytes=Buffer.concat([row('AAPL','USAAAPL'), ...(scenario==='missing'?[]:[row('QQQ','USAQQQ')]), ...(scenario==='ambiguous'?[row('QQQ','OTHER')]:[])]);
    globalThis.fetch=async url=>({ok:scenario!=='http',status:scenario==='http'?503:200,headers:{get:()=>null},text:async()=>scenario==='schema'?'invalid':header,arrayBuffer:async()=>bytes});
  `);
  const target=fileURLToPath(new URL('./nhplug-us-master-public-check.mjs',import.meta.url));
  for(const [scenario, expected] of [['ok',0],['http',1],['schema',1],['missing',1],['ambiguous',1]]) {
    const result=spawnSync(process.execPath,['--import',preload,target],{env:{...process.env,MASTER_SCENARIO:scenario},encoding:'utf8'});
    assert.equal(result.status,expected,`${scenario}: ${result.stdout} ${result.stderr}`);
  }
  console.log('Public master success and failure exit status checks passed');
} finally { rmSync(dir,{recursive:true,force:true}); }
