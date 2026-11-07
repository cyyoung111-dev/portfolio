import assert from 'node:assert/strict';
import {financialSourceCoverageStatus,isFinancialSourceCoverageStatus}
 from './briefing-financial-source-status.mjs';
import {collectAiFinancialEvidence}
 from './collect-ai-financial-evidence-readonly.mjs';
import {prefetchAiFinancialEvidence}
 from './prefetch-ai-financial-evidence-readonly.mjs';
const KST=()=>new Date('2026-11-09T06:20:00+09:00');
const ttm={statuses:[
 {symbol:'MSFT',status:'VERIFIED_TTM',ocfUsd:999999,secret:'DART_TOKEN_TEST_SHOULD_NOT_APPEAR'},
 {symbol:'AAPL',status:'PARTIAL_TTM'},
 {symbol:'NVDA',status:'FETCH_FAILED'},
 {symbol:'SNDK',status:'FY_ONLY'}]};
const fy={statuses:[
 {symbol:'MSFT',status:'VERIFIED_FY_BPS_PBR'},
 {symbol:'GOOGL',status:'PARTIAL_FY_VALUE'},
 {symbol:'NVDA',status:'QUOTE_UNVERIFIED'}, // unknown status => fail-closed
 {symbol:'META',status:'FETCH_FAILED'}]};
const dart={statuses:[
 {symbol:'005930',status:'DART_KEY_NOT_CONFIGURED',apiKey:'KEY_NEVER_EXPOSE'},
 {symbol:'000660',status:'DART_PARENT_EQUITY_UNVERIFIED',secret:'DO_NOT_COPY'}]};
const checked=financialSourceCoverageStatus({ttm,fy,dart});
assert.equal(checked.kind,'PUBLIC_SEC_DART_SOURCE_COVERAGE');
assert.deepEqual(checked.ttm.map(x=>x.symbol),
 ['MSFT','AAPL','GOOGL','AMZN','META','NVDA','MU','ORCL','SNDK']);
assert.deepEqual(checked.fyPbr.map(x=>x.symbol),checked.ttm.map(x=>x.symbol));
assert.deepEqual(checked.domestic.map(x=>x.symbol),['005930','000660']);
assert.equal(checked.ttm[0].status,'VERIFIED_TTM');
assert.equal(checked.ttm[2].status,'UNVERIFIED');
assert.equal(checked.ttm[5].status,'FETCH_FAILED');
assert.equal(checked.fyPbr[5].status,'UNVERIFIED');
assert.equal(checked.domestic[0].status,'DART_KEY_NOT_CONFIGURED');
assert.equal(checked.domestic[1].status,'DART_PARENT_EQUITY_UNVERIFIED');
assert.equal(isFinancialSourceCoverageStatus(checked),true);
const text=JSON.stringify(checked);
for(const secret of ['999999','KEY_NEVER_EXPOSE','DART_TOKEN_TEST_SHOULD_NOT_APPEAR',
 'DO_NOT_COPY','ocfUsd','apiKey'])assert.ok(!text.includes(secret),secret);
for(const malformed of [
 {...checked,domestic:[{symbol:'005930',status:'UNVERIFIED'}]},
 {...checked,domestic:[...checked.domestic,{symbol:'000660',status:'VERIFIED_SINGLECLASS_BPS'}]},
 {...checked,ttm:checked.ttm.map((x,i)=>i?x:{...x,account:'LEAK'})},
 {...checked,fyPbr:checked.fyPbr.map((x,i)=>i?x:{...x,status:'PRIVATE_SECRET'})},
 {...checked,ttm:checked.ttm.map((x,i)=>i?x:{...x,symbol:'SECRET'})},
 {...checked,secret:'LEAK'}
])assert.equal(isFinancialSourceCoverageStatus(malformed),false);
const duplicate=financialSourceCoverageStatus({ttm:{statuses:[
 {symbol:'MSFT',status:'VERIFIED_TTM'}, {symbol:'MSFT',status:'FETCH_FAILED'}]}});
assert.equal(duplicate.ttm[0].status,'UNVERIFIED','duplicate source claims never win');
let observed=null,readOrder=[];
const result=await collectAiFinancialEvidence({
 now:KST,usSessionDate:'2026-11-06',
 readTtm:async()=>{readOrder.push('SEC_TTM');return ttm;},
 readValues:async()=>{readOrder.push('SEC_FY');return fy;},
 readDart:async()=>{readOrder.push('DART');return dart;},
 onSourceStatus:status=>{assert.equal(observed,null);observed=status;}
});
assert.deepEqual(readOrder,['DART','SEC_TTM','SEC_FY']);
assert.deepEqual(observed,checked);
assert.equal(result.kind,'AI_FINANCIAL_EVIDENCE_READ_ONLY');
assert.equal(JSON.stringify(result).includes('sourceStatus'),false,
 'status-only logs must not be added to financial artifact schema');
const swallowed=await collectAiFinancialEvidence({
 now:KST,usSessionDate:'2026-11-06',
 readTtm:async()=>ttm,readValues:async()=>fy,readDart:async()=>dart,
 onSourceStatus:()=>{throw Error('CLIENT_DIAGNOSTIC_CALLBACK');}
});
assert.deepEqual(swallowed,result,'metrics unaffected by reporting observer failures');
let provided=null;
const noFacts=await prefetchAiFinancialEvidence({
 now:KST,collector:async opt=>{
  provided=opt;
  opt.onSourceStatus(checked);
  return result;
 }
});
assert.equal(typeof provided.onSourceStatus,'function');
assert.equal(noFacts.ready,false,'no verified financial metrics cannot produce artifact');
assert.equal(noFacts.status,'PUBLIC_EVIDENCE_UNVERIFIED');
assert.deepEqual(noFacts.sourceStatus,checked,
 'missing source reason remains diagnosable without an artifact');
assert.equal(noFacts.data,undefined);
const noDiagnostic=await prefetchAiFinancialEvidence({
 now:KST,collector:async opt=>{
  opt.onSourceStatus({kind:'PRIVATE_API_RESPONSE',token:'NEVER_LOG'});
  return result;
 }
});
assert.equal(noDiagnostic.sourceStatus,null,'untrusted diagnostics must not pass');
console.log('FINANCIAL_SOURCE_COVERAGE_PASS US9*2 DART2 isolated reasons no secrets no financial writes');
