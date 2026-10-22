import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/krx-operational-diagnostics.yml', 'utf8');
const nightBlock = workflow.split('      - name: Read-only KRX K200 night match diagnostics\n')[1]
  ?.split('      - name: Preview stale KRX pending dates without mutation\n')[0];
assert.ok(nightBlock, 'K200 diagnostic workflow step must exist');
assert.match(nightBlock, /DIAGNOSTIC_DATES:\s*\$\{\{\s*inputs\.dates\s*\}\}/,
  'manual diagnostic date input must reach K200 step');
assert.match(nightBlock, /--dates "\$\{DIAGNOSTIC_DATES:-2026-10-13,2026-10-14\}"/,
  'K200 step must use manual dates with safe push-only fallback');
assert.doesNotMatch(nightBlock, /--dates "2026-10-13,2026-10-14"/,
  'K200 step must not discard user-selected dates');
import {runNightDiagnosis,summarizeK200Diagnostic,summarizeNightFinal} from './diagnose-k200-night-operational.mjs';

const url='https://script.google.com/macros/s/test-id/exec';
const token='sensitive-token-never-print';
const dates=['2026-10-13','2026-10-14'];
const numbers={
  totalRows:22,nightMarketRows:18,exactDateRows:20,
  exactDateNightRows:16,exactNightProductRows:12,
  exactProductLabelVariants:2,validExpiryRows:8,
  unexpiredExpiryRows:6,positiveCloseRows:3,nearestExpiryRows:1,wouldSelect:true
};
const diag=date=>({status:'ok',diagnostic:{
  requestedDate:date,mode:'READ_ONLY',keyConfigured:true,alternativeConfigured:false,
  source:'PRIMARY',primaryHttpStatus:200,alternativeHttpStatus:0,
  parseStatus:'ROWS',beforeNightFinalCutoff:false,stats:numbers,
  rawSource:'SENSITIVE:never-exposed'
}});
const close=date=>({status:'ok',observation:{
  seriesId:'K200_NIGHT',tradingDate:date,sourceDate:date,
  source:'KRX_OFFICIAL',market:'KRX',session:'NIGHT',
  status:'FINAL',finality:'NIGHT_FINAL',fallback:false,value:999.25,
  contract:'SENSITIVE-contract'
}});
assert.equal(summarizeK200Diagnostic(diag(dates[0]),dates[0]).stats.wouldSelect,true);
assert.throws(()=>summarizeK200Diagnostic(diag(dates[0]),dates[1]),/INVALID_RESPONSE/);
assert.throws(()=>summarizeK200Diagnostic({...diag(dates[0]),diagnostic:{
  ...diag(dates[0]).diagnostic,stats:{...numbers,validExpiryRows:50}
}},dates[0]),/INVALID_STATS/);
assert.deepEqual(summarizeNightFinal(close(dates[0]),dates[0]),{
  date:dates[0],officialNightFinal:true
});
assert.equal(summarizeNightFinal({...close(dates[0]),observation:{
  ...close(dates[0]).observation,finality:'REGULAR_CLOSE'
}},dates[0]).officialNightFinal,false);
const requests=[];
const fetchImpl=async (_url,opts)=>{
  const body=opts.body;const action=body.get('action'),date=body.get('date');
  if(body.get('accessToken')!==token)
    return {ok:true,json:async()=>({status:'error',message:'인증 실패'})};
  requests.push({action,date,method:opts.method,keys:[...body.keys()]});
  assert.equal(body.get('accessToken'),token);
  assert.equal(opts.method,'POST');
  const result=action==='getKrxK200NightDiagnostics' ? diag(date)
    : action==='getKrxK200NightClose'
      ? (date===dates[0]?close(date):{status:'ok',observation:null,error:'KRX_K200_NIGHT_NOT_READY'})
    : {status:'error'};
  return {ok:true,json:async()=>result};
};
const data=await runNightDiagnosis({url,token,dates:dates.join(','),fetchImpl});
assert.equal(data.mode,'READ_ONLY');
assert.equal(data.requiredDiagnosticContract,'K200_NIGHT_DIAGNOSTICS_V1');
assert.deepEqual(data.results.map(x=>x.officialNightFinal),[true,false]);
assert.equal(data.results[0].stats.totalRows,22);
assert.equal(data.results[0].stats.wouldSelect,true);
assert.equal(requests.length,4);
assert.deepEqual([...new Set(requests.map(x=>x.action))].sort(),
 ['getKrxK200NightClose','getKrxK200NightDiagnostics']);
assert.doesNotMatch(JSON.stringify(data),/sensitive-token|SENSITIVE|999\.25/);
await assert.rejects(()=>runNightDiagnosis({url,token,dates:dates[0],
  fetchImpl:async()=>({ok:true,json:async()=>diag(dates[0])})}),
  /NIGHT_DIAG_GAS_AUTH_NOT_ENFORCED/, 'public diagnostics must fail closed');
await assert.rejects(()=>runNightDiagnosis({url,token:'',dates:'2026-10-13',fetchImpl}),
  /AUTH_NOT_CONFIGURED/);
await assert.rejects(()=>runNightDiagnosis({url,token,dates:'2026-02-30',fetchImpl}),
  /INVALID_DATE/);
console.log('KRX K200 live read-only diagnostic validation, privacy and finality tests passed');

assert.throws(()=>summarizeNightFinal({
  status:'ok',observation:null,error:'KRX_K200_NIGHT_HTTP_503'
},dates[0]),/NIGHT_FINAL_PROVIDER_ERROR/,
'KRX network/provider fault must not be labeled as clean no-match');
assert.deepEqual(summarizeNightFinal({
  status:'ok',observation:null,error:'KRX_K200_NIGHT_NOT_READY'
},dates[0]),{date:dates[0],officialNightFinal:false});
