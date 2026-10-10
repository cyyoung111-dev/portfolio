import assert from 'node:assert/strict';
import {
  parseDates, validateWebAppUrl, summarizeKrxSource,
  buildSafeRequest, readGasAction, runDiagnosis, summarizeOfficialCloses,
} from './diagnose-krx-operational.mjs';
assert.deepEqual(parseDates('2026-10-07,2026-10-08'),['2026-10-07','2026-10-08']);
assert.throws(()=>parseDates('2026-02-30'),/INVALID_DATE/);
assert.throws(()=>parseDates('2026-10-08,2026-10-08'),/INVALID_DATES/);
assert.throws(()=>parseDates('2026-10-07,'),/INVALID_DATES/);
assert.throws(()=>parseDates(',2026-10-08'),/INVALID_DATES/);
assert.throws(()=>parseDates('2026-10-08,2026-10-07,2026-10-06,2026-10-05,2026-10-04,2026-10-03,2026-10-02,2026-10-01'),/INVALID_DATES/);
assert.equal(validateWebAppUrl('https://script.google.com/macros/s/Abcd/exec'),'https://script.google.com/macros/s/Abcd/exec');
for(const u of ['http://script.google.com/macros/s/x/exec','https://evil.example/path',
  'https://u:p@script.google.com/macros/s/x/exec',
  'https://script.google.com/macros/s/x/dev','https://script.google.com/macros/s/x/exec?token=abc'])
  assert.throws(()=>validateWebAppUrl(u),/INVALID_WEB_APP_URL/);
assert.throws(()=>buildSafeRequest('saveSnapshot','','dont-log-this'),/FORBIDDEN_ACTION/);
const key='test-token-never-log-this';
const params=buildSafeRequest('getKrxSourceDiagnostics','2026-10-08',key);
assert.equal(params.get('action'),'getKrxSourceDiagnostics');
assert.equal(params.get('date'),'2026-10-08');
assert.equal(params.get('accessToken'),key);
const closeParams=buildSafeRequest('getKrxOfficialStockCloses','2026-10-08',key);
assert.equal(closeParams.get('codes'),'005930,000660');
assert.throws(()=>buildSafeRequest('getKrxOfficialStockCloses','',key),/INVALID_DATE/);
const closePayload=date=>({status:'ok',requestedDate:date,closes:Object.fromEntries(
 ['005930','000660'].map((code,index)=>[code,{code,price:100000+index*100000,
 requestedDate:date,usedDate:date,source:'KRX_OFFICIAL',providerSource:'KRX'}]))});
assert.equal(summarizeOfficialCloses(closePayload('2026-10-08'),'2026-10-08').healthy,true);
assert.equal(summarizeOfficialCloses({...closePayload('2026-10-08'),
 closes:{'005930':closePayload('2026-10-08').closes['005930']}},'2026-10-08').healthy,false);
assert.equal(summarizeOfficialCloses({...closePayload('2026-10-08'),
 closes:{'005930':{...closePayload('2026-10-08').closes['005930'],usedDate:'2026-10-07'},
 '000660':closePayload('2026-10-08').closes['000660']}},'2026-10-08').healthy,false);
assert.throws(()=>summarizeOfficialCloses({status:'ok',requestedDate:'2026-10-08',closes:[]},'2026-10-08'),/INVALID_STOCK_RESPONSE/);

// Missing repo secret or rejected GAS bearer token are different from a KRX
// provider outage: fail before hitting the KRX market endpoints.
await assert.rejects(()=>runDiagnosis({
  url:'https://script.google.com/macros/s/Abcd/exec',token:'',
  dates:'2026-10-08',fetchImpl:async()=>{throw new Error('SHOULD_NOT_FETCH');},
}),/GAS_ACCESS_TOKEN_NOT_CONFIGURED/);
await assert.rejects(()=>runDiagnosis({
  url:'https://script.google.com/macros/s/Abcd/exec',token:'invalid-placeholder',
  dates:'2026-10-08',fetchImpl:async()=>({ok:true,json:async()=>({status:'error',message:'인증 실패'})}),
}),/GAS_ACCESS_DENIED/);
const markers=[
 {market:'KOSPI',httpStatus:200,rows:900,parseStatus:'ROWS'},
 {market:'KOSDAQ',httpStatus:200,rows:1200,parseStatus:'ROWS'},
 {market:'ETF',httpStatus:200,rows:1400,parseStatus:'ROWS'},
];
const payload=date=>({status:'ok',requestedDate:date,keyConfigured:true,networkStatus:'RECEIVED',
 markets:markers});
const health=summarizeKrxSource(payload('2026-10-08'),'2026-10-08');
assert.equal(health.healthy,true);
assert.equal(health.credentialSource,'UNKNOWN','legacy GAS does not advertise auth-slot provenance');
const authShadow=summarizeKrxSource({...payload('2026-10-08'),
 credentialSource:'krx_auth_key',alternativeConfigured:true,
 alternateProbe:{httpStatus:200,hasRows:true},
 markets:markers.map(x=>({...x,httpStatus:401,rows:0,parseStatus:'NOT_PARSED'}))},'2026-10-08');
assert.equal(authShadow.healthy,false,'authenticated alternate probe does not validate active data');
assert.equal(authShadow.credentialSource,'krx_auth_key');
assert.equal(authShadow.alternativeConfigured,true);
assert.equal(authShadow.alternateProbe.hasRows,true);
assert.ok(!JSON.stringify(authShadow).includes('accessToken'));
assert.deepEqual(health.markets.map(x=>x.market),['KOSPI','KOSDAQ','ETF']);
assert.ok(!JSON.stringify(health).includes(key));
assert.equal(summarizeKrxSource({...payload('2026-10-08'),markets:markers.map(x=>x.market==='ETF'
 ?{...x,httpStatus:401,parseStatus:'NOT_PARSED',rows:0}:x)},'2026-10-08').healthy,false);
assert.equal(summarizeKrxSource({status:'ok',requestedDate:'2026-10-08',keyConfigured:false,markets:[]},'2026-10-08').healthy,false);
assert.throws(()=>summarizeKrxSource({...payload('2026-10-08'),markets:[markers[0],markers[0],markers[2]]},'2026-10-08'),/INVALID_MARKET_LIST/);
assert.throws(()=>summarizeKrxSource({...payload('2026-10-08'),markets:[null,markers[1],markers[2]]},'2026-10-08'),/INVALID_MARKET_LIST/,
 'malformed market elements must be classified, not trigger unhandled exceptions');
assert.throws(()=>summarizeKrxSource({...payload('2026-10-08'),markets:[{...markers[0],rows:-1},markers[1],markers[2]]},'2026-10-08'),/INVALID_MARKET_RESPONSE/);
assert.throws(()=>summarizeKrxSource(payload('2026-10-07'),'2026-10-08'),/INVALID_SOURCE_RESPONSE/);

// Codex P2: GAS networkStatus FETCH_FAILED returns status:ok and markets:[]. Preserve the cause.
const failedSource={status:'ok',requestedDate:'2026-10-08',keyConfigured:true,
 networkStatus:'FETCH_FAILED',markets:[],message:'KRX 네트워크 요청 실패'};
const failedSummary=summarizeKrxSource(failedSource,'2026-10-08');
assert.equal(failedSummary.networkStatus,'FETCH_FAILED','GAS fetchAll timeout must not become INVALID_MARKET_LIST');
assert.equal(failedSummary.healthy,false);
assert.deepEqual(failedSummary.markets.map(x=>x.httpStatus),[0,0,0]);
const partialNetwork=summarizeKrxSource({...failedSource,markets:[markers[0]]},'2026-10-08');
assert.equal(partialNetwork.networkStatus,'FETCH_FAILED');
assert.equal(partialNetwork.healthy,false);
assert.deepEqual(partialNetwork.markets.map(x=>x.httpStatus),[200,0,0]);
assert.throws(()=>summarizeKrxSource({...failedSource,markets:[markers[0],markers[0]]},'2026-10-08'),/INVALID_MARKET_LIST/);
assert.equal(summarizeKrxSource({...payload('2026-10-08'),networkStatus:'FETCH_FAILED'},'2026-10-08').healthy,false,
 'fetchAll failure cannot be marked healthy even with three individually valid market rows');
assert.ok(!JSON.stringify(failedSummary).includes('네트워크 요청'));
assert.equal(summarizeKrxSource({status:'ok',requestedDate:'2026-10-08',
 keyConfigured:false,markets:[]},'2026-10-08').networkStatus,'NOT_CONFIGURED');
assert.throws(()=>summarizeKrxSource({status:'ok',requestedDate:'2026-10-08',
 keyConfigured:true,networkStatus:'RECEIVED',markets:[]},'2026-10-08'),/INVALID_MARKET_LIST/);
const networkDiag=await runDiagnosis({
 url:'https://script.google.com/macros/s/Abcd/exec',
 token:key,dates:'2026-10-08',
 fetchImpl:async(url,opts)=>({ok:true,json:async()=>opts.body.get('action')==='getSettings'
  ?{status:'ok',gasVersion:'9.192'}:opts.body.get('action')==='getKrxOfficialStockCloses'
    ?closePayload('2026-10-08'):failedSource}),
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
    ?{status:'ok',gasVersion:'9.192'}:opts.body.get('action')==='getKrxOfficialStockCloses'
      ?closePayload(opts.body.get('date')):payload(opts.body.get('date'))};
};
const report=await runDiagnosis({
  url:'https://script.google.com/macros/s/Abcd/exec',
  token:key,dates:'2026-10-07,2026-10-08',fetchImpl:fakeFetch,
});
assert.equal(report.mode,'READ_ONLY');
assert.equal(report.gasVersion,'9.192');
assert.equal(report.healthy,true);
assert.ok(report.reports.every(item=>item.stockCloses?.healthy),
 'Source rows and exact-date stock code match must both pass');
const sourceOnly=await runDiagnosis({
  url:'https://script.google.com/macros/s/Abcd/exec',token:key,dates:'2026-10-08',
  fetchImpl:async(url,opts)=>({ok:true,json:async()=>opts.body.get('action')==='getSettings'
    ?{status:'ok',gasVersion:'9.192'}:opts.body.get('action')==='getKrxOfficialStockCloses'
      ?{status:'ok',requestedDate:'2026-10-08',closes:{}}
      :payload('2026-10-08')}),
});
assert.equal(sourceOnly.reports[0].networkStatus,'RECEIVED');
assert.equal(sourceOnly.reports[0].stockCloses.healthy,false);
assert.equal(sourceOnly.healthy,false,
 'Official market HTTP 200 with no matched closes is not operationally healthy');
assert.deepEqual(called.map(x=>[x.action,x.date]),[
 ['getSettings',null],
 ['getKrxSourceDiagnostics','2026-10-07'],
 ['getKrxOfficialStockCloses','2026-10-07'],
 ['getKrxSourceDiagnostics','2026-10-08'],
 ['getKrxOfficialStockCloses','2026-10-08'],
]);
assert.ok(!JSON.stringify(report).includes(key));
// Multi-day report must preserve 10/07 results even if 10/08 GAS request fails.
const continued=await runDiagnosis({
 url:'https://script.google.com/macros/s/Abcd/exec', token:key,
 dates:'2026-10-07,2026-10-08',
 fetchImpl:async(url,opts)=>{
  if(opts.body.get('action')==='getSettings')
   return {ok:true,json:async()=>({status:'ok',gasVersion:'9.192'})};
  if(opts.body.get('date')==='2026-10-07')
   return {ok:false,status:403};
  return {ok:true,json:async()=>opts.body.get('action')==='getKrxOfficialStockCloses'
   ?closePayload('2026-10-08'):payload('2026-10-08')};
 },
});
assert.equal(continued.reports.length,2,'GAS per-day failures must not abort other dates');
assert.equal(continued.reports[0].errorCode,'KRX_DIAG_GAS_HTTP_403');
assert.equal(continued.reports[0].healthy,false);
assert.equal(continued.reports[1].healthy,true);
assert.equal(continued.reports[1].stockCloses.healthy,true);
assert.equal(continued.healthy,false);
assert.equal(continued.reports[0].networkStatus,'GAS_REQUEST_FAILED');
assert.ok(!JSON.stringify(continued).includes(key));
const brokenStructure=await runDiagnosis({
 url:'https://script.google.com/macros/s/Abcd/exec',token:key,dates:'2026-10-08',
 fetchImpl:async(url,opts)=>({ok:true,json:async()=>opts.body.get('action')==='getSettings'
  ?{status:'ok',gasVersion:'9.192'}
  :{status:'ok',requestedDate:'2026-10-08',keyConfigured:true,networkStatus:'RECEIVED',markets:[]}}),
});
assert.equal(brokenStructure.reports[0].networkStatus,'INVALID_RESPONSE');
assert.equal(brokenStructure.reports[0].errorCode,'KRX_DIAG_INVALID_MARKET_LIST');
await assert.rejects(()=>readGasAction('https://script.google.com/macros/s/Abcd/exec',
 'getSettings','',key,async()=>({ok:false,status:403})),/GAS_HTTP_403/);
await assert.rejects(()=>readGasAction('https://script.google.com/macros/s/Abcd/exec',
 'getSettings','',key,async()=>{throw new Error('SECRET '+key)}),/FETCH_FAILED/);
console.log('KRX authenticated production diagnostic is read-only and sanitized: PASS');
