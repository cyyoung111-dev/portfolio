import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {completedKrxSession,probeOptionalKrxMetrics,auditDirectVkospiRows} from './probe-optional-krx-gas-readonly.mjs';
const sample=[{IDX_NM:'코스피 200 변동성지수',BAS_DD:'20261112',CLSPRC_IDX:'25.42'}];
assert.deepEqual(auditDirectVkospiRows('2026-11-12',sample),
 {candidateCount:1,candidateNames:['코스피 200 변동성지수'],
  primaryCount:1,exactDateCount:1,verified:true});
assert.deepEqual(auditDirectVkospiRows('2026-11-12',[{...sample[0],BAS_DD:'20261111'}]),
 {candidateCount:1,candidateNames:['코스피 200 변동성지수'],
  primaryCount:1,exactDateCount:0,verified:false});
assert.deepEqual(auditDirectVkospiRows('2026-11-12',[
 ...sample,{...sample[0],IDX_NM:'코스피 200 변동성지수 단기선물'}]),
 {candidateCount:2,candidateNames:['코스피 200 변동성지수','코스피 200 변동성지수 단기선물'],
  primaryCount:1,exactDateCount:1,verified:true});
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

// A new business-day stock/index payload may still be unpublished.
// Re-query the preceding completed market session to distinguish an entirely
// unavailable API from a same-day publication/schema mismatch.
const directLogs=[],queries=[];
const dual=await probeOptionalKrxMetrics({
 now:when('2026-11-13T21:08:00+09:00'),
 key:'TEST_KRX_AUTH_APPROVED_12345678',gasUrl:'',gasToken:'',
 output:x=>directLogs.push(x),
 fetchImpl:async (u,options)=>{
  const url=new URL(u),requested=url.searchParams.get('basDd');
  assert.equal(options.method,'GET');
  assert.equal(options.headers.AUTH_KEY,'TEST_KRX_AUTH_APPROVED_12345678');
  assert.ok(['20261113','20261112'].includes(requested));
  queries.push(requested);
  const before=requested==='20261112',derivative=url.pathname.endsWith('/drvprod_dd_trd');
  const rows=!before?[]:derivative
   ?[{BAS_DD:'20261112',IDX_NM:'코스피 200 변동성지수',CLSPRC_IDX:'21.55'}]
   :[{BAS_DD:'20261112',IDX_NM:'코스피',ACC_TRDVAL:'1234'}];
  return {ok:true,status:200,json:async()=>({OutBlock_1:rows})};
 }
});
assert.equal(dual.date,'2026-11-13');
assert.deepEqual(queries,[
 ...Array(5).fill('20261113'),...Array(5).fill('20261112')
]);
const directRecords=directLogs.filter(x=>x.kind==='KRX_DIRECT_OPTIONAL_CONTRACT');
assert.equal(directRecords.length,10);
assert.equal(directRecords.filter(x=>x.date==='2026-11-13').length,5);
assert.equal(directRecords.filter(x=>x.date==='2026-11-12').length,5);
assert.ok(directRecords.filter(x=>x.date==='2026-11-13')
 .every(x=>x.payloadShape==='EMPTY_OUTBLOCK'&&x.rowCount===0&&x.exactDate===false));
assert.ok(directRecords.filter(x=>x.date==='2026-11-12')
 .every(x=>x.payloadShape==='OUTBLOCK_PRESENT'&&x.rowCount===1&&x.exactDate===true));
assert.equal(directRecords.find(x=>x.date==='2026-11-12'&&x.id==='INDEX_DERIVATIVE').vkospiVerified,true);
assert.ok(directRecords.every(x=>x.provenance==='HISTORIC_READ_ACTUAL_REQUEST_TIME'));
assert.ok(!JSON.stringify(directLogs).includes('TEST_KRX_AUTH_APPROVED'));
assert.ok(!JSON.stringify(directLogs).includes('21.55'));
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
