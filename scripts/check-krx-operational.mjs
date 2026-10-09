import assert from 'node:assert/strict';
import {
  parseDates, validateWebAppUrl, summarizeKrxSource,
  buildSafeRequest, readGasAction, runDiagnosis,
} from './diagnose-krx-operational.mjs';
assert.deepEqual(parseDates('2026-10-07,2026-10-08'),['2026-10-07','2026-10-08']);
assert.throws(()=>parseDates('2026-02-30'),/INVALID_DATE/);
assert.throws(()=>parseDates('2026-10-08,2026-10-08'),/INVALID_DATES/);
assert.throws(()=>parseDates('2026-10-08,2026-10-07,2026-10-06,2026-10-05,2026-10-04,2026-10-03,2026-10-02,2026-10-01'),/INVALID_DATES/);
assert.equal(validateWebAppUrl('https://script.google.com/macros/s/Abcd/exec'),'https://script.google.com/macros/s/Abcd/exec');
for(const u of ['http://script.google.com/macros/s/x/exec','https://evil.example/path',
  'https://script.google.com/macros/s/x/dev','https://script.google.com/macros/s/x/exec?token=abc'])
  assert.throws(()=>validateWebAppUrl(u),/INVALID_WEB_APP_URL/);
assert.throws(()=>buildSafeRequest('saveSnapshot','','dont-log-this'),/FORBIDDEN_ACTION/);
const key='test-token-never-log-this';
const params=buildSafeRequest('getKrxSourceDiagnostics','2026-10-08',key);
assert.equal(params.get('action'),'getKrxSourceDiagnostics');
assert.equal(params.get('date'),'2026-10-08');
assert.equal(params.get('accessToken'),key);

const markers=[
 {market:'KOSPI',httpStatus:200,rows:900,parseStatus:'ROWS'},
 {market:'KOSDAQ',httpStatus:200,rows:1200,parseStatus:'ROWS'},
 {market:'ETF',httpStatus:200,rows:1400,parseStatus:'ROWS'},
];
const payload=date=>({status:'ok',requestedDate:date,keyConfigured:true,networkStatus:'RECEIVED',
 markets:markers});
const health=summarizeKrxSource(payload('2026-10-08'),'2026-10-08');
assert.equal(health.healthy,true);
assert.deepEqual(health.markets.map(x=>x.market),['KOSPI','KOSDAQ','ETF']);
assert.ok(!JSON.stringify(health).includes(key));
assert.equal(summarizeKrxSource({...payload('2026-10-08'),markets:markers.map(x=>x.market==='ETF'
 ?{...x,httpStatus:401,parseStatus:'NOT_PARSED',rows:0}:x)},'2026-10-08').healthy,false);
assert.equal(summarizeKrxSource({status:'ok',requestedDate:'2026-10-08',keyConfigured:false,markets:[]},'2026-10-08').healthy,false);
assert.throws(()=>summarizeKrxSource({...payload('2026-10-08'),markets:[markers[0],markers[0],markers[2]]},'2026-10-08'),/INVALID_MARKET_LIST/);
assert.throws(()=>summarizeKrxSource(payload('2026-10-07'),'2026-10-08'),/INVALID_SOURCE_RESPONSE/);

// Codex P2: GAS networkStatus FETCH_FAILED returns status:ok and markets:[]. Preserve the cause.
const failedSource={status:'ok',requestedDate:'2026-10-08',keyConfigured:true,
 networkStatus:'FETCH_FAILED',markets:[],message:'KRX 네트워크 요청 실패'};
const failedSummary=summarizeKrxSource(failedSource,'2026-10-08');
assert.equal(failedSummary.networkStatus,'FETCH_FAILED','GAS fetchAll timeout must not become INVALID_MARKET_LIST');
assert.equal(failedSummary.healthy,false);
assert.deepEqual(failedSummary.markets.map(x=>x.httpStatus),[0,0,0]);
assert.ok(!JSON.stringify(failedSummary).includes('네트워크 요청'));
assert.equal(summarizeKrxSource({status:'ok',requestedDate:'2026-10-08',
 keyConfigured:false,markets:[]},'2026-10-08').networkStatus,'NOT_CONFIGURED');
assert.throws(()=>summarizeKrxSource({status:'ok',requestedDate:'2026-10-08',
 keyConfigured:true,networkStatus:'RECEIVED',markets:[]},'2026-10-08'),/INVALID_MARKET_LIST/);
const networkDiag=await runDiagnosis({
 url:'https://script.google.com/macros/s/Abcd/exec',
 token:key,dates:'2026-10-08',
 fetchImpl:async(url,opts)=>({ok:true,json:async()=>opts.body.get('action')==='getSettings'
  ?{status:'ok',gasVersion:'9.192'}:failedSource}),
});
assert.equal(networkDiag.healthy,false);
assert.equal(networkDiag.reports[0].networkStatus,'FETCH_FAILED');

const called=[];
const fakeFetch=async(url,opts)=>{
  called.push({url,action:opts.body.get('action'),date:opts.body.get('date')});
  assert.equal(opts.method,'POST');
  assert.equal(opts.headers['content-type'],'application/x-www-form-urlencoded;charset=UTF-8');
  assert.equal(opts.body.get('accessToken'),key);
  return {ok:true,json:async()=>opts.body.get('action')==='getSettings'
    ?{status:'ok',gasVersion:'9.192'}:payload(opts.body.get('date'))};
};
const report=await runDiagnosis({
  url:'https://script.google.com/macros/s/Abcd/exec',
  token:key,dates:'2026-10-07,2026-10-08',fetchImpl:fakeFetch,
});
assert.equal(report.mode,'READ_ONLY');
assert.equal(report.gasVersion,'9.192');
assert.equal(report.healthy,true);
assert.deepEqual(called.map(x=>[x.action,x.date]),[
 ['getSettings',null],
 ['getKrxSourceDiagnostics','2026-10-07'],
 ['getKrxSourceDiagnostics','2026-10-08'],
]);
assert.ok(!JSON.stringify(report).includes(key));
await assert.rejects(()=>readGasAction('https://script.google.com/macros/s/Abcd/exec',
 'getSettings','',key,async()=>({ok:false,status:403})),/GAS_HTTP_403/);
await assert.rejects(()=>readGasAction('https://script.google.com/macros/s/Abcd/exec',
 'getSettings','',key,async()=>{throw new Error('SECRET '+key)}),/FETCH_FAILED/);
console.log('KRX authenticated production diagnostic is read-only and sanitized: PASS');
