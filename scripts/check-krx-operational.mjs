import assert from 'node:assert/strict';
import {
  parseDates, validateWebAppUrl, summarizeKrxSource,
  buildSafeRequest, readGasAction, runDiagnosis as rawRunDiagnosis, summarizeOfficialCloses,
} from './diagnose-krx-operational.mjs';
const AUTH_PROBE='KRX_READ_ONLY_AUTH_PROBE_20261014';
// Simulate an authenticated GAS endpoint for all normal test fixtures.
const runDiagnosis=args=>rawRunDiagnosis({...args,fetchImpl:(url,opts)=>{
  if(opts.body?.get('accessToken')===AUTH_PROBE)
    return Promise.resolve({ok:true,json:async()=>({status:'error',message:'인증 실패'})});
  return args.fetchImpl(url,opts);
}});

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
await assert.rejects(()=>rawRunDiagnosis({
  url:'https://script.google.com/macros/s/Abcd/exec',token:'set-but-unprotected',
  dates:'2026-10-08',
  fetchImpl:async()=>({ok:true,json:async()=>({status:'ok',gasVersion:'9.192',
    settings:{apiKeyStatus:{requestAuthenticationEnabled:false}}})}),
}),/GAS_AUTHENTICATION_DISABLED/,'Configured repo secret must not mask public GAS deployment');
const markers=[
 {market:'KOSPI',httpStatus:200,rows:900,exactDateRows:900,parseStatus:'ROWS'},
 {market:'KOSDAQ',httpStatus:200,rows:1200,exactDateRows:1200,parseStatus:'ROWS'},
 {market:'ETF',httpStatus:200,rows:1400,exactDateRows:1400,parseStatus:'ROWS'},
];
const completedCoverage={
  status:'OK',expectedHeldCodes:2,expectedStock:2,expectedEtf:0,
  priceHistoryRows:2,officialExactDateCodes:2,nonOfficialHeldCodes:0,
  missingOfficialCodes:0,snapshotRows:2,snapshotHeldCodes:2,
  missingSnapshotCodes:0,queuedForBackfill:false
};
const payload=date=>({status:'ok',requestedDate:date,keyConfigured:true,networkStatus:'RECEIVED',
 markets:markers,storedCoverage:completedCoverage});
const health=summarizeKrxSource(payload('2026-10-08'),'2026-10-08');
assert.equal(health.healthy,true);
for (const stored of [
  undefined, {status:'READ_FAILED'}, {status:'SHEET_MISSING'},
  {status:'MASTER_EMPTY'},
  {...completedCoverage,missingOfficialCodes:1,officialExactDateCodes:1},
  {...completedCoverage,missingSnapshotCodes:1,snapshotHeldCodes:1},
  {...completedCoverage,queuedForBackfill:true},
]) {
  assert.equal(summarizeKrxSource({...payload('2026-10-08'),storedCoverage:stored},
    '2026-10-08').healthy,false,
    'verified KRX market API alone cannot pass with failed/partial/queued storage coverage');
}
assert.equal(summarizeKrxSource({...payload('2026-10-08'),
  storedCoverage:{...completedCoverage,expectedHeldCodes:0,expectedStock:0,
    officialExactDateCodes:0,snapshotHeldCodes:0,priceHistoryRows:0,snapshotRows:0}},
    '2026-10-08').healthy,true,
  'no domestic holdings and no missing storage is a healthy completed coverage state');
const legacyRowsOnly = markers.map(({exactDateRows, ...item})=>item);
const legacyHealth = summarizeKrxSource({...payload('2026-10-08'), markets:legacyRowsOnly},'2026-10-08');
assert.equal(legacyHealth.healthy,false,
  'Legacy HTTP200 generic rows are not proof of exact requested BAS_DD');
assert.deepEqual(legacyHealth.reachableMarkets.map(x=>x.reachable),[false,false,false]);
const mixedLegacy = summarizeKrxSource({...payload('2026-10-08'),
  markets:[markers[0], legacyRowsOnly[1], markers[2]]},'2026-10-08');
assert.equal(mixedLegacy.healthy,false,'one unverified legacy market must fail overall');
assert.equal(mixedLegacy.reachableMarkets[1].reachable,false);
assert.equal(health.credentialSource,'UNKNOWN','legacy GAS does not advertise auth-slot provenance');
const authShadow=summarizeKrxSource({...payload('2026-10-08'),
 credentialSource:'krx_auth_key',alternativeConfigured:true,
 alternateProbe:{httpStatus:200,hasRows:true},
 markets:markers.map(x=>({...x,httpStatus:401,rows:0,exactDateRows:0,parseStatus:'NOT_PARSED'}))},'2026-10-08');
assert.equal(authShadow.healthy,false,'authenticated alternate probe does not validate active data');
assert.equal(authShadow.credentialSource,'krx_auth_key');
assert.equal(authShadow.alternativeConfigured,true);
assert.equal(authShadow.alternateProbe.hasRows,true);
assert.ok(!JSON.stringify(authShadow).includes('accessToken'));
// Per-service KRX approval is not one boolean per credential. An exact-date
// alternate approval on KOSPI does not prove the separate ETF/KOSDAQ product.
const storedCoverage={
  status:'OK',expectedHeldCodes:37,expectedStock:16,expectedEtf:21,
  priceHistoryRows:2,officialExactDateCodes:0,nonOfficialHeldCodes:0,
  missingOfficialCodes:37,snapshotRows:0,snapshotHeldCodes:0,
  missingSnapshotCodes:37,queuedForBackfill:true
};
const deniedMarkets=[
  {market:'KOSPI',httpStatus:401,rows:0,exactDateRows:0,parseStatus:'NOT_PARSED'},
  {market:'KOSDAQ',httpStatus:403,rows:0,exactDateRows:0,parseStatus:'NOT_PARSED'},
  {market:'ETF',httpStatus:200,rows:1400,exactDateRows:1400,parseStatus:'ROWS'}
];
const partialApproval=summarizeKrxSource({...payload('2026-10-08'),
  markets:deniedMarkets,credentialSource:'krx_auth_key',alternativeConfigured:true,
  alternateProbes:[
    {market:'KOSPI',httpStatus:200,rows:900,exactDateRows:900,parseStatus:'ROWS',hasRows:true},
    {market:'KOSDAQ',httpStatus:403,rows:0,exactDateRows:0,parseStatus:'NOT_PARSED',hasRows:false}
  ],storedCoverage},'2026-10-08');
assert.equal(partialApproval.healthy,false,'KOSDAQ rejection is not masked by other approved services');
assert.deepEqual(partialApproval.reachableMarkets.map(x=>x.reachable),[true,false,true]);
assert.equal(partialApproval.alternateProbes.length,2);
assert.deepEqual(partialApproval.storedCoverage,storedCoverage);
assert.equal(partialApproval.storedCoverage.missingOfficialCodes,37);
const allApproved=summarizeKrxSource({...payload('2026-10-08'),
  markets:deniedMarkets,
  alternateProbes:partialApproval.alternateProbes.map(x=>x.market==='KOSDAQ'
    ?{...x,httpStatus:200,rows:1200,exactDateRows:1200,parseStatus:'ROWS',hasRows:true}:x)
},'2026-10-08');
assert.equal(allApproved.healthy,true,'each market approved for exact date via primary OR alternate');
assert.equal(summarizeKrxSource({...payload('2026-10-08'),
  markets:markers.map(x=>({...x,exactDateRows:0}))},'2026-10-08').healthy,false,
  'HTTP200 rows of another session do not prove requested close');
assert.throws(()=>summarizeKrxSource({...payload('2026-10-08'),
  markets:[{...markers[0],exactDateRows:901},markers[1],markers[2]]},'2026-10-08'),
  /INVALID_MARKET_RESPONSE/,'exact-date count cannot exceed all rows');
assert.ok(!JSON.stringify(partialApproval).includes('SECRET_'));

assert.deepEqual(health.markets.map(x=>x.market),['KOSPI','KOSDAQ','ETF']);
assert.ok(!JSON.stringify(health).includes(key));
assert.equal(summarizeKrxSource({...payload('2026-10-08'),markets:markers.map(x=>x.market==='ETF'
 ?{...x,httpStatus:401,parseStatus:'NOT_PARSED',rows:0,exactDateRows:0}:x)},'2026-10-08').healthy,false);
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
 fetchImpl:async(url,opts)=>({ok:true,json:async()=>opts.body.get('action')==='getAutomationStatus'
  ?{status:'ok',gasVersion:'9.192',settings:{apiKeyStatus:{requestAuthenticationEnabled:true}}}:opts.body.get('action')==='getKrxOfficialStockCloses'
    ?closePayload('2026-10-08'):failedSource}),
});
assert.equal(networkDiag.healthy,false);
assert.equal(networkDiag.reports[0].networkStatus,'FETCH_FAILED');

assert.throws(()=>buildSafeRequest('getSettings','',key),/FORBIDDEN_ACTION/);
assert.throws(()=>buildSafeRequest('getAutomationStatus','',key),/FORBIDDEN_ACTION/);
const called=[];
const fakeFetch=async(url,opts)=>{
  called.push({url,action:opts.body.get('action'),date:opts.body.get('date')});
  assert.equal(opts.method,'POST');
  assert.equal(opts.headers['content-type'],'application/x-www-form-urlencoded;charset=UTF-8');
  assert.equal(opts.body.get('accessToken'),key);
  return {ok:true,json:async()=>opts.body.get('action')==='getAutomationStatus'
    ?{status:'ok',gasVersion:'9.192',settings:{apiKeyStatus:{requestAuthenticationEnabled:true}}}:opts.body.get('action')==='getKrxOfficialStockCloses'
      ?closePayload(opts.body.get('date')):payload(opts.body.get('date'))};
};
const report=await runDiagnosis({
  url:'https://script.google.com/macros/s/Abcd/exec',
  token:key,dates:'2026-10-07,2026-10-08',fetchImpl:fakeFetch,
});
assert.equal(report.mode,'READ_ONLY');
assert.equal(report.verifiedContract,'KRX_SOURCE_READ_ONLY');
assert.equal(report.healthy,true);
assert.ok(report.reports.every(item=>item.stockCloses?.healthy),
 'Source rows and exact-date stock code match must both pass');
const sourceOnly=await runDiagnosis({
  url:'https://script.google.com/macros/s/Abcd/exec',token:key,dates:'2026-10-08',
  fetchImpl:async(url,opts)=>({ok:true,json:async()=>opts.body.get('action')==='getAutomationStatus'
    ?{status:'ok',gasVersion:'9.192',settings:{apiKeyStatus:{requestAuthenticationEnabled:true}}}:opts.body.get('action')==='getKrxOfficialStockCloses'
      ?{status:'ok',requestedDate:'2026-10-08',closes:{}}
      :payload('2026-10-08')}),
});
assert.equal(sourceOnly.reports[0].networkStatus,'RECEIVED');
assert.equal(sourceOnly.reports[0].stockCloses.healthy,false);
assert.equal(sourceOnly.healthy,false,
 'Official market HTTP 200 with no matched closes is not operationally healthy');
assert.deepEqual(called.map(x=>[x.action,x.date]),[
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
  if(opts.body.get('action')==='getAutomationStatus')
   return {ok:true,json:async()=>({status:'ok',gasVersion:'9.192',settings:{apiKeyStatus:{requestAuthenticationEnabled:true}}})};
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
 fetchImpl:async(url,opts)=>({ok:true,json:async()=>opts.body.get('action')==='getAutomationStatus'
  ?{status:'ok',gasVersion:'9.192',settings:{apiKeyStatus:{requestAuthenticationEnabled:true}}}
  :{status:'ok',requestedDate:'2026-10-08',keyConfigured:true,networkStatus:'RECEIVED',markets:[]}}),
});
assert.equal(brokenStructure.reports[0].networkStatus,'INVALID_RESPONSE');
assert.equal(brokenStructure.reports[0].errorCode,'KRX_DIAG_INVALID_MARKET_LIST');
await assert.rejects(()=>readGasAction('https://script.google.com/macros/s/Abcd/exec',
 'getKrxSourceDiagnostics','2026-10-08',key,async()=>({ok:false,status:403})),/GAS_HTTP_403/);
await assert.rejects(()=>readGasAction('https://script.google.com/macros/s/Abcd/exec',
 'getKrxSourceDiagnostics','2026-10-08',key,async()=>{throw new Error('SECRET '+key)}),/FETCH_FAILED/);

const continuedOnTimeout=await runDiagnosis({
  url:'https://script.google.com/macros/s/Abcd/exec',token:key,
  dates:'2026-10-12,2026-10-13',
  fetchImpl:async(_url,opts)=>{
    const d=opts.body.get('date');
    if(d==='2026-10-12')throw new Error('sensitive transport detail');
    return {ok:true,json:async()=>opts.body.get('action')==='getKrxOfficialStockCloses'
      ?closePayload(d):payload(d)};
  },
});
assert.equal(continuedOnTimeout.reports.length,2);
assert.equal(continuedOnTimeout.reports[0].errorCode,'KRX_DIAG_FETCH_FAILED');
assert.equal(continuedOnTimeout.reports[1].healthy,true);
assert.ok(!JSON.stringify(continuedOnTimeout).includes('sensitive transport detail'));

console.log('KRX authenticated production diagnostic is read-only and sanitized: PASS');


import { runBackfillStatus, summarizeBackfillStatus, summarizeCloseStatus, classifyBackfillFailure } from './diagnose-backfill-status.mjs';
const statusFixture=()=>({status:'ok',gasVersion:'9.224',automation:{
  gasVersion:'9.224',overallStatus:'WARNING',
  trigger:{
    hasClose:true,hasWatchdog:true,hasBackfill:true,hasHistoricalBackfill:true,
    hasMidnightBackfill:true,hasIntegrityChange:true,hasClean:true,hasMortgage:true,
    closeCount:1,watchdogCount:1,backfillCount:1,
    historicalBackfillCount:1,midnightBackfillCount:1,
    hasDuplicateCloseTriggers:false,hasDuplicateWatchdogTriggers:false,
    hasDuplicateBackfillTriggers:false,hasDuplicateHistoricalBackfillTriggers:false,
    hasDuplicateMidnightBackfillTriggers:false,hasLegacySplitTriggers:false
  },
  pendingKrxCloseDates:['2026-10-08','2026-10-12','2026-10-13'],
  officialKrxPriceHistoryLastDate:'2026-10-08',snapshotLastDate:'2026-10-08',
  priceHistoryLastDate:'2026-10-14',
  backfillLastResult:{runDate:'2026-10-14',checkedAt:1791961200000,
    result:{attempted:true,ok:false,date:'2026-10-13',remaining:3,
      error:'private account and holdings must not be logged'}},
  historicalBackfillLastResult:null,
  secretValue:'must never be serialized'
}});
const statusSample=summarizeBackfillStatus(statusFixture());
assert.equal(statusSample.mode,'READ_ONLY');
assert.equal(statusSample.triggerReady,false);
assert.equal(statusSample.gasVersionReady,false,
  'legacy GAS without 08:45 writer must fail the readiness gate');
assert.equal(statusSample.pendingCount,3);
assert.deepEqual(statusSample.pendingDates,['2026-10-08','2026-10-12','2026-10-13']);
assert.equal(statusSample.latestBackfill.ok,false);
assert.equal(statusSample.latestBackfill.targetDate,'2026-10-13');

assert.equal(statusSample.latestBackfill.failureClass,'OTHER_UNCLASSIFIED');
for(const [input,expected] of [
  ['BACKFILL_PERSISTED_VERIFICATION_FAILED:SNAPSHOT_DATE_INVALID','SAVED_SNAPSHOT_DATE_INVALID'],
  ['BACKFILL_PERSISTED_VERIFICATION_FAILED:SNAPSHOT_CONFLICT','SAVED_SNAPSHOT_INTEGRITY_FAILED'],
  ['BACKFILL_PERSISTED_VERIFICATION_FAILED:OFFICIAL_KRX','SAVED_KRX_OR_SNAPSHOT_PROOF_FAILED'],
  ['BACKFILL_RECONCILIATION_FAILED','CLOSE_RECONCILIATION_FAILED'],
  ['TARGET_BACKUP_FAILED','BACKUP_SAFETY_FAILED'],
  ['백필 PRICE 저장 성공을 확인하지 못해 대상 날짜를 보존합니다.','PRICE_WRITE_NOT_CONFIRMED'],
  ['KRX missing exact-date held code private 123','KRX_PRICE_SOURCE_OR_COVERAGE'],
  ['SNAPSHOT write private account 123','SNAPSHOT_SAVE_OR_PROOF'],
  ['LOCK unavailable private 123','LEASE_OR_WRITER_CONFLICT'],
  ['NAV expected missing private 123','FUND_OR_NAV_PRECONDITION'],
  ['sensitive account and number 123','OTHER_UNCLASSIFIED']
]) {
  const summary=classifyBackfillFailure({attempted:true,ok:false,error:input});
  assert.equal(summary,expected);
  assert.doesNotMatch(summary,/private|account|123|token/i,
    'must never print any raw backfill error');
}
assert.equal(classifyBackfillFailure({attempted:false,ok:false,error:'secret'}),null);
assert.equal(classifyBackfillFailure({attempted:true,ok:true,error:'secret'}),null);
assert.equal(classifyBackfillFailure({attempted:true,ok:false}),'DETAIL_NOT_EXPOSED');

assert.doesNotMatch(JSON.stringify(statusSample),/private account|secretValue|must never/);
let statusRequests=[];
const statusResult=await runBackfillStatus({
  url:'https://script.google.com/macros/s/Abcd/exec',token:key,
  fetchImpl:async(_,options)=>{
    statusRequests.push(options);
    assert.equal(options.method,'POST');
    assert.equal(options.body.get('action'),'getAutomationStatus');
    assert.equal(options.body.has('apply'),false);
    return {ok:true,json:async()=>options.body.get('accessToken')===key
      ?statusFixture():{status:'error',message:'인증 실패'}};
  }
});
assert.equal(statusRequests.length,2,'negative auth proof followed by one real read-only status');
assert.equal(statusResult.triggerReady,false);
assert.ok(!JSON.stringify(statusResult).includes(key));
const v9235=statusFixture();
v9235.gasVersion='9.235';v9235.automation.gasVersion='9.235';
Object.assign(v9235.automation.trigger,{
  hasMorningBackfill:true,morningBackfillCount:1,
  hasDuplicateMorningBackfillTriggers:false
});
assert.equal(summarizeBackfillStatus(v9235).triggerReady,true);
assert.equal(summarizeBackfillStatus(v9235).gasVersionReady,true);
const noMorning=structuredClone(v9235);
noMorning.automation.trigger.hasMorningBackfill=false;
noMorning.automation.trigger.morningBackfillCount=0;
assert.equal(summarizeBackfillStatus(noMorning).triggerReady,false);
assert.deepEqual(summarizeBackfillStatus(noMorning).triggerMissing,['hasMorningBackfill']);
const dupMorning=structuredClone(v9235);
dupMorning.automation.trigger.morningBackfillCount=2;
dupMorning.automation.trigger.hasDuplicateMorningBackfillTriggers=true;
assert.equal(summarizeBackfillStatus(dupMorning).triggerReady,false);
assert.deepEqual(summarizeBackfillStatus(dupMorning).duplicateTriggerFlags,
  ['hasDuplicateMorningBackfillTriggers']);
const malformedMorning=structuredClone(v9235);
delete malformedMorning.automation.trigger.morningBackfillCount;
assert.throws(()=>summarizeBackfillStatus(malformedMorning),/BAD_TRIGGER/);
const latest=statusFixture();
latest.gasVersion='9.237';latest.automation.gasVersion='9.237';
Object.assign(latest.automation.trigger,{hasMorningBackfill:true,
  morningBackfillCount:1,hasDuplicateMorningBackfillTriggers:false,
  hasIntegrityEdit:true,hasLedgerRebuild:true});
latest.automation.pendingTradeSnapshotRebuildFrom='2026-06-05';
latest.automation.tradeLedgerWriteUnverified=false;
const pendingProof=summarizeBackfillStatus(latest);
assert.equal(pendingProof.pendingTradeSnapshotRebuildFrom,'2026-06-05');
assert.equal(pendingProof.tradeLedgerWriteUnverified,false);
// v9.238 exposes proof of actual worker execution, not just trigger install.
const workerLive=structuredClone(latest);
workerLive.gasVersion='9.238';workerLive.automation.gasVersion='9.238';
workerLive.automation.tradeSnapshotDeferredCount=2;
workerLive.automation.tradeSnapshotDeferredOldestDate='2025-12-31';
workerLive.automation.tradeSnapshotWorkerLastResult={
  status:'PENDING',at:'2026-10-19T08:50:00.000Z',
  processed:0,deferred:2,blockedDate:'',sourceCheck:'UNCHANGED',
  secret:'PRIVATE_ACCOUNT_VALUE'
};
const workerSummary=summarizeBackfillStatus(workerLive);
assert.equal(workerSummary.tradeSnapshotDeferredCount,2);
assert.equal(workerSummary.tradeSnapshotDeferredOldestDate,'2025-12-31');
assert.equal(workerSummary.tradeSnapshotWorkerLastResult.status,'PENDING');
assert.equal(workerSummary.tradeSnapshotWorkerLastResult.processed,0);
assert.equal(workerSummary.tradeSnapshotWorkerLastResult.at,'2026-10-19T08:50:00.000Z');
assert.doesNotMatch(JSON.stringify(workerSummary),/PRIVATE_ACCOUNT_VALUE/,
  'worker proof must never leak source payload extensions');
for(const [change,expect] of [
  [x=>{delete x.automation.tradeSnapshotDeferredCount},'BAD_DEFERRED_COUNT'],
  [x=>{x.automation.tradeSnapshotDeferredOldestDate='2026-99-99'},'BAD_DATE'],
  [x=>{x.automation.tradeSnapshotDeferredCount=0},'BAD_DEFERRED_DATE'],
  [x=>{x.automation.tradeSnapshotWorkerLastResult.status='PRIVATE'},'BAD_LEDGER_WORKER_CHECKPOINT'],
  [x=>{x.automation.tradeSnapshotWorkerLastResult.at='not-a-timestamp'},'BAD_LEDGER_WORKER_CHECKPOINT'],
  [x=>{x.automation.tradeSnapshotWorkerLastResult.processed=400},'BAD_LEDGER_WORKER_CHECKPOINT'],
]) {
  const altered=structuredClone(workerLive);change(altered);
  assert.throws(()=>summarizeBackfillStatus(altered),new RegExp(expect));
}
// v9.239: worker RUNNING is written before any sheet I/O; a separate BUSY
// record cannot overwrite an executing worker's last attempt checkpoint.
const workerEntry=structuredClone(workerLive);
workerEntry.gasVersion='9.239';
workerEntry.automation.gasVersion='9.239';
workerEntry.automation.tradeSnapshotWorkerLastResult={
  status:'RUNNING',at:'2026-10-19T08:51:00.000Z',
  processed:0,deferred:0,blockedDate:'',sourceCheck:''
};
workerEntry.automation.tradeSnapshotWorkerLastBusy={
  status:'BUSY',at:'2026-10-19T08:52:00.000Z',
  sensitive:'SECRET_LEDGER'
};
const workerEntryStatus=summarizeBackfillStatus(workerEntry);
assert.equal(workerEntryStatus.tradeSnapshotWorkerLastResult.status,'RUNNING');
assert.equal(workerEntryStatus.tradeSnapshotWorkerLastBusy.status,'BUSY');
assert.equal(workerEntryStatus.tradeSnapshotWorkerLastBusy.at,'2026-10-19T08:52:00.000Z');
assert.doesNotMatch(JSON.stringify(workerEntryStatus),/SECRET_LEDGER/);
const invalidBusy=structuredClone(workerEntry);
invalidBusy.automation.tradeSnapshotWorkerLastBusy.at='INVALID';
assert.throws(()=>summarizeBackfillStatus(invalidBusy),/BAD_LEDGER_WORKER_BUSY/);
const invalidPhase=structuredClone(workerEntry);
invalidPhase.automation.tradeSnapshotWorkerLastResult.status='SECRET';
assert.throws(()=>summarizeBackfillStatus(invalidPhase),/BAD_LEDGER_WORKER_CHECKPOINT/);
const workerNeverRun=structuredClone(workerLive);
workerNeverRun.automation.tradeSnapshotDeferredCount=0;
workerNeverRun.automation.tradeSnapshotDeferredOldestDate='';
workerNeverRun.automation.tradeSnapshotWorkerLastResult=null;
assert.equal(summarizeBackfillStatus(workerNeverRun).tradeSnapshotWorkerLastResult,null);
const unsafeLedger=structuredClone(latest);
unsafeLedger.automation.tradeLedgerWriteUnverified=true;
assert.equal(summarizeBackfillStatus(unsafeLedger).tradeLedgerWriteUnverified,true);
assert.equal(pendingProof.triggerReady,true);
const missingLedger=structuredClone(latest);
delete missingLedger.automation.trigger.hasLedgerRebuild;
assert.throws(()=>summarizeBackfillStatus(missingLedger),/BAD_TRIGGER/);
const malformedLedgerDate=structuredClone(latest);
malformedLedgerDate.automation.pendingTradeSnapshotRebuildFrom='2026-99-99';
assert.throws(()=>summarizeBackfillStatus(malformedLedgerDate),/BAD_DATE/);
latest.automation.historical2310Checkpoint={runDate:'2026-10-18',
  startedAt:1792280000000,finishedAt:1792280001000,state:'DEFERRED',
  attempted:false,ok:null,deferred:true,reason:'BACKFILL_BUSY',secret:'PRIVATE'};
latest.automation.historical0030Checkpoint={runDate:'2026-10-19',
  startedAt:1792290000000,finishedAt:null,state:'RUNNING',
  attempted:false,ok:null,deferred:false,reason:'STARTED'};
assert.equal(summarizeBackfillStatus(latest).historical2310.reason,'BACKFILL_BUSY');
assert.equal(summarizeBackfillStatus(latest).historical0030.state,'RUNNING');
assert.doesNotMatch(JSON.stringify(summarizeBackfillStatus(latest)),/PRIVATE/);
const badCheckpoint=structuredClone(latest);
badCheckpoint.automation.historical0030Checkpoint.reason='PRIVATE';
assert.throws(()=>summarizeBackfillStatus(badCheckpoint),/BAD_HISTORICAL_CHECKPOINT/);
const statusNoMidnight=statusFixture();
statusNoMidnight.automation.trigger.hasMidnightBackfill=false;
statusNoMidnight.automation.trigger.midnightBackfillCount=0;
assert.equal(summarizeBackfillStatus(statusNoMidnight).triggerReady,false);
assert.deepEqual(summarizeBackfillStatus(statusNoMidnight).triggerMissing,['hasMidnightBackfill']);
const statusDuplicate=statusFixture();
statusDuplicate.automation.trigger.backfillCount=2;
statusDuplicate.automation.trigger.hasDuplicateBackfillTriggers=true;
assert.equal(summarizeBackfillStatus(statusDuplicate).triggerReady,false);
const statusInvalidQueue=statusFixture();
statusInvalidQueue.automation.pendingKrxCloseDates.push('2026-10-08');
assert.throws(()=>summarizeBackfillStatus(statusInvalidQueue),/BAD_QUEUE/);
const statusMissingField=statusFixture();
delete statusMissingField.automation.trigger.hasClose;
assert.throws(()=>summarizeBackfillStatus(statusMissingField),/BAD_TRIGGER/);
const statusBadVersion=statusFixture();
statusBadVersion.gasVersion='9.223';
assert.throws(()=>summarizeBackfillStatus(statusBadVersion),/BAD_RESPONSE/);
await assert.rejects(()=>runBackfillStatus({
  url:'https://script.google.com/macros/s/Abcd/exec',token:key,
  fetchImpl:async()=>({ok:true,json:async()=>statusFixture()})
}),/AUTH_DISABLED/);
await assert.rejects(()=>runBackfillStatus({
  url:'https://script.google.com/macros/s/Abcd/exec',token:key,
  fetchImpl:async()=>{throw new Error('sensitive credentials');}
}),/NETWORK_FAILED/);
console.log('KRX/GAS 트리거·큐·백필 체크포인트 읽기 전용 인증·안전 출력 회귀 통과');

import {runTargetedRecovery} from './run-krx-targeted-recovery.mjs';
const targetedRequests=[];
const targetedConfig={url:'https://script.google.com/macros/s/Abcd/exec',token:key,date:'2026-10-12',
  fetchImpl:async(_,options)=>{
    assert.equal(options.method,'POST');
    assert.equal(options.body.get('action'),'recoverPendingKrxClose');
    assert.equal(options.body.get('date'),'2026-10-12');
    const apply=options.body.get('apply');targetedRequests.push(apply);
    return {ok:true,json:async()=>options.body.get('accessToken')!==key
      ? {status:'error',message:'인증 실패'}:apply==='0'
      ? {status:'ok',mode:'DRY_RUN',date:'2026-10-12',ready:true,expected:37}
      : {status:'ok',mode:'APPLY',date:'2026-10-12',attempted:true,ok:true,remaining:7}};
  }};
assert.equal((await runTargetedRecovery(targetedConfig)).mode,'DRY_RUN');
assert.deepEqual(targetedRequests,['0','0']);targetedRequests.length=0;
assert.equal((await runTargetedRecovery({...targetedConfig,apply:true})).ok,true);
assert.deepEqual(targetedRequests,['0','0','1']);
await assert.rejects(()=>runTargetedRecovery({...targetedConfig,date:'2026-10-12,2026-10-13'}),/TARGET_INVALID_INPUT/);
await assert.rejects(()=>runTargetedRecovery({...targetedConfig,apply:'false'}),/TARGET_INVALID_APPLY/);
console.log('✅ 지정일 복구 클라이언트: 기본 dry-run·인증 거부 확인·단일 날짜·명시 apply 계약');

// Close lifecycle diagnosis must explain INCOMPLETE without leaking raw errors.
const closePrivate={closeRun:{state:'INCOMPLETE',stage:'FUND',runDate:'2026-10-23',private:'SECRET'},portfolioClose:{runDate:'2026-10-23',priceOk:true,fundOk:false,errors:['SECRET_ACCOUNT']},portfolioCloseLastError:'SECRET',fundLastError:'SECRET',fundAttempt:{state:'TIMEOUT_SUSPECTED',date:'2026-10-23',token:'SECRET'}};
const closeSafe=summarizeCloseStatus(closePrivate);
assert.equal(closeSafe.state,'INCOMPLETE');assert.equal(closeSafe.stage,'FUND');
assert.equal(closeSafe.priceOk,true);assert.equal(closeSafe.fundOk,false);
assert.equal(closeSafe.closeErrorCount,1);assert.equal(closeSafe.fundState,'TIMEOUT_SUSPECTED');
assert.ok(!JSON.stringify(closeSafe).includes('SECRET'));
assert.equal(summarizeCloseStatus({closeRun:{stage:'SECRET'}}).stage,'UNKNOWN');
assert.throws(()=>summarizeCloseStatus({fundLastDate:'2026-02-30'}),/AUTOMATION_DIAG_BAD_DATE/);
assert.equal(summarizeBackfillStatus({...statusFixture(),automation:{...statusFixture().automation,...closePrivate}}).close.stage,'FUND');
console.log('Close lifecycle read-only diagnosis: stage, price/NAV, failure, private data exclusion PASS');

// End-to-end client orchestration uses real auth/status parser and bounded POSTs.
{
 const {resumeClose}=await import('./run-incomplete-close-resume.mjs');
 const fixture=structuredClone(workerLive);fixture.gasVersion=fixture.automation.gasVersion='9.261';
 fixture.automation.tradeSnapshotWorkerTriggerAudit={scope:'CURRENT_USER',visibleCount:1,clockCount:1,nonClockCount:0,unknownCount:0};
 fixture.automation.closeRun={state:'INCOMPLETE',stage:'FUND',runDate:'2026-10-24'};
 let scheduled=0,continued=0;const emitted=[];
 const fetchImpl=async(_url,o)=>{
  const p=Object.fromEntries(o.body);let data;
  if(p.accessToken==='AUTOMATION_READONLY_AUTH_PROBE')data={status:'error',message:'인증 실패'};
  else if(p.action==='getAutomationStatus')data=fixture;
  else if(p.action==='resumeIncompletePortfolioClose'&&p.phase==='continue'&&p.apply==='0')data={status:'error',message:'PRIVATE'};
  else if(p.action==='resumeIncompletePortfolioClose'&&p.phase==='schedule'){scheduled++;data={status:'ok',scheduled:true};}
  else if(p.action==='resumeIncompletePortfolioClose'&&p.phase==='continue'&&p.apply==='1'){
   continued++;fixture.automation.closeRun.state='COMPLETE';fixture.automation.closeRun.stage='COMPLETE';data={status:'ok',continued:true};
  }else throw Error('Unexpected action');
  return {ok:true,json:async()=>structuredClone(data)};
 };
 const done=await resumeClose({url:'https://script.google.com/macros/s/TEST/exec',token:'TEST',fetchImpl,emit:x=>emitted.push(x)});
 assert.equal(done.complete,true);assert.equal(scheduled,1);assert.equal(continued,1);
 assert.equal(emitted.length,1);assert.ok(!JSON.stringify(done).includes('PRIVATE'));
}
console.log('Incomplete close client: authentication, explicit schedule, bounded continuation, verified completion PASS');
