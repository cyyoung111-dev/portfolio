import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {completedKrxSession,probeOptionalKrxMetrics,auditDirectVkospiRows} from './probe-optional-krx-gas-readonly.mjs';
const sample=[{IDX_NM:'코스피 200 변동성지수',BAS_DD:'20261112',CLSPRC_IDX:'25.42'}];
assert.deepEqual(auditDirectVkospiRows('2026-11-12',sample),
 {candidateCount:1,exactDateCount:1,verified:true});
assert.deepEqual(auditDirectVkospiRows('2026-11-12',[{...sample[0],BAS_DD:'20261111'}]),
 {candidateCount:1,exactDateCount:0,verified:false});
assert.equal(auditDirectVkospiRows('2026-11-12',[...sample,...sample]).verified,false);
assert.equal(auditDirectVkospiRows('2026-11-12',[{...sample[0],CLSPRC_IDX:'NaN'}]).verified,false);
assert.equal(auditDirectVkospiRows('2026-11-12',[{...sample[0],IDX_NM:'KOSPI 200'}]).verified,false);
assert.equal(auditDirectVkospiRows('2026-11-12',[]).verified,false);
const when=s=>new Date(s);
assert.equal(completedKrxSession(when('2026-11-13T13:52:00+09:00')),'2026-11-12');
assert.equal(completedKrxSession(when('2026-11-13T16:00:00+09:00')),'2026-11-13');
assert.equal(completedKrxSession(when('2026-11-15T17:00:00+09:00')),'2026-11-13');
assert.equal(completedKrxSession(when('invalid')),null);
let fetchCalls=0,gasCalls=0,records=[];
const output=x=>records.push(x);
const done=await probeOptionalKrxMetrics({
 now:when('2026-11-13T13:52:00+09:00'),
 key:'',gasUrl:'https://script.google.com/macros/s/TEST/exec',gasToken:'TEST_ACCESS_VALID_123',
 output,fetchImpl:async()=>{fetchCalls++;throw Error('no direct KRX');},
 getVkospi:async(date,{onDiagnostic})=>{gasCalls++;onDiagnostic({status:'KRX_KEY_NOT_CONFIGURED'});return [];},
 getTurnover:async(date,{onDiagnostic})=>{gasCalls++;onDiagnostic({status:'GAS_EMPTY_ROWS'});return [];}
});
assert.equal(done.date,'2026-11-12');assert.equal(fetchCalls,0);
assert.equal(gasCalls,4,'2 dates x VKOSPI + turnover');
assert.equal(records.filter(x=>x.kind==='KRX_GAS_OPTIONAL_CONTRACT').length,2);
assert.equal(records[0].configured.githubKrxKey,false);
assert.equal(records.at(-1).status,'HISTORICAL_252_SESSIONS_REQUIRED');
assert.deepEqual(await probeOptionalKrxMetrics({now:when('2026-11-13T13:52:00+09:00'),
 output:()=>{},key:'',gasToken:'',gasUrl:'',fetchImpl:async()=>assert.fail('not called')}),{
 date:'2026-11-12',readOnly:true,gasConfigured:false,githubKrxKeyConfigured:false
});
const workflow=YAML.parse(fs.readFileSync('.github/workflows/optional-krx-gas-smoke.yml','utf8'));
assert.equal(workflow.jobs.probe.environment,'portfolio-production-gas');
assert.equal(workflow.jobs.probe.steps.at(-1).env.KRX_AUTH_KEY,'$'+'{{ secrets.KRX_AUTH_KEY }}');
assert.equal(workflow.jobs.probe.steps.at(-1).env.GAS_ACCESS_TOKEN,'$'+'{{ secrets.GAS_ACCESS_TOKEN }}');
assert.equal(workflow.jobs.probe.steps.at(-1).env.GAS_WEB_APP_URL,'$'+'{{ vars.GAS_WEB_APP_URL }}');
assert.deepEqual(workflow.on.pull_request,undefined);
assert.equal(workflow.permissions.contents,'read');
const script=fs.readFileSync('scripts/probe-optional-krx-gas-readonly.mjs','utf8');
assert.doesNotMatch(script,/setProperty|appendRow|dispatches|createToken|sendMessage/);
console.log('KRX_OPTIONAL_METRICS_READONLY_PASS exact_date provenance GAS and optional-key audit');
