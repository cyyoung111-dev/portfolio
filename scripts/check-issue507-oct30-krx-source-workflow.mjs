#!/usr/bin/env node
// #507: prove the 2026-10-30 official KRX source audit stays read-only and
// runs even after expected domestic price-history incompleteness.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {summarizeHeldCoverage,runCoverage} from './diagnose-krx-held-coverage.mjs';

const DATE='2026-10-30';
const workflow=fs.readFileSync('.github/workflows/issue507-oct30-domestic-close-readonly.yml','utf8');
const parsed=YAML.parseDocument(workflow,{uniqueKeys:true,version:'1.2'});
assert.equal(parsed.errors.length,0);
const doc=parsed.toJS({maxAliasCount:0});
assert.equal(doc.permissions.contents,'read');
assert.ok(Object.hasOwn(doc.on,'workflow_dispatch'));
const job=doc.jobs['operational-readonly'];
assert.equal(job.environment,'portfolio-production-gas');
assert.equal(job.if,"github.ref == 'refs/heads/main' && github.event_name == 'workflow_dispatch'");
const steps=job.steps;
const domestic=steps.findIndex(s=>s.run==='node scripts/issue507-oct30-domestic-close-readonly.mjs');
const krx=steps.findIndex(s=>s.run==='node scripts/diagnose-krx-held-coverage.mjs --dates "2026-10-30"');
assert.ok(domestic>=0 && krx>domestic,'official audit follows existing read-only diagnostic');
assert.equal(steps[krx].if,'always()','KRX source audit still runs after expected incomplete data');
assert.equal(steps[krx].env.GAS_ACCESS_TOKEN,'${{ secrets.GAS_ACCESS_TOKEN }}');
assert.equal(steps[krx].env.GAS_WEB_APP_URL,'${{ vars.GAS_WEB_APP_URL }}');
assert.equal(steps[domestic].env.GAS_ACCESS_TOKEN,'${{ secrets.GAS_ACCESS_TOKEN }}');
const safeScript=fs.readFileSync('scripts/diagnose-krx-held-coverage.mjs','utf8');
assert.match(safeScript,/action:'getKrxHeldCloseCoverage'/);
assert.match(safeScript,/mode:'READ_ONLY'/);
assert.doesNotMatch(safeScript,/action:\s*['"](?:update|save|apply|repair|delete)/i);
const payload=(confirmed=37)=>({status:'ok',coverage:{
  mode:'READ_ONLY',requestedDate:DATE,expectedHeldCodes:37,
  officialExactDateCodes:confirmed,missingCodes:37-confirmed,
  staleCodes:0,duplicateMasterCodes:0,orphanLedgerCodes:0,
  market:{STOCK:{expected:16,confirmed:Math.min(16,confirmed)},
    ETF:{expected:21,confirmed:confirmed-Math.min(16,confirmed)}},
  ready:confirmed===37,privateValue:'SENSITIVE_37'
}});
const ready=summarizeHeldCoverage(payload(),DATE);
assert.equal(ready.ready,true);
assert.deepEqual(ready.market,{STOCK:{expected:16,confirmed:16},ETF:{expected:21,confirmed:21}});
const missing=summarizeHeldCoverage(payload(36),DATE);
assert.equal(missing.ready,false);
assert.equal(missing.missing,1);
const wrong=payload();wrong.coverage.requestedDate='2026-10-29';
assert.throws(()=>summarizeHeldCoverage(wrong,DATE),/BAD_RESPONSE/);
const stale=payload();stale.coverage.staleCodes=1;
assert.equal(summarizeHeldCoverage(stale,DATE).ready,false);
const secret='SENSITIVE_TOKEN';
const calls=[];
const mock=async(_url,request)=>{
  const data=request.body,action=data.get('action');
  calls.push({action,date:data.get('date'),hasApply:data.has('apply')});
  return {ok:true,json:async()=>data.get('accessToken')===secret
    ?payload(36):{status:'error',message:'인증 실패'}};
};
const result=await runCoverage({url:'https://script.google.com/macros/s/TEST/exec',
  token:secret,dates:DATE,fetchImpl:mock});
assert.equal(result.ready,false,'incomplete official source must block recovery');
assert.equal(result.results[0].exact,36);
assert.deepEqual(calls.map(x=>x.action),['getKrxHeldCloseCoverage','getKrxHeldCloseCoverage']);
assert.ok(calls.every(x=>x.date===DATE&&!x.hasApply));
for(const hidden of [secret,'SENSITIVE_37'])
  assert.ok(!JSON.stringify(result).includes(hidden));
console.log(JSON.stringify({mode:'ISSUE507_OCT30_KRX_READONLY_CONTRACT',result:'PASS',
 date:DATE,readOnly:true,requestsInMock:calls.length,realExternalCalls:0,
 realFinancialWrites:0,originalGASModified:false}));
