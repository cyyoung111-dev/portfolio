import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {composeGASVkospiDerivativeProposal,gitBlobSha,
 CURRENT_INDEX_ENDPOINT,PROPOSED_DERIVATIVE_ENDPOINT}
 from './compose-gas-vkospi-derivative-proposal.mjs';
import {selectClosingVkospi,verifyClosingVkospi,readClosingVkospi}
 from './closing-vkospi-reference.mjs';
import {formatClose,prepareClose,deliverClose} from './telegram-close-workflow.mjs';
import {CLOSE_SOURCE_CATALOG,summarizeCloseCoverage} from './briefing-source-coverage.mjs';

const date='2026-11-02',us='2026-10-30';
const now=()=>new Date(date+'T17:05:00+09:00');
const payload={status:'ok',symbol:'KRX_OPEN_API:VKOSPI',
 points:[{date,value:25.42}]};
// Execute the real GAS handler, not an invented per-row source fixture.
const gas=fs.readFileSync('src/gas/apps_script.gs','utf8');
const start=gas.indexOf('function handleGetBenchmark(');
const end=gas.indexOf('function handleGetBenchmarks(',start);
assert.ok(start>=0&&end>start,'production GAS benchmark handler is present');
const ctx={
 _normalizeDate:x=>x,today:()=>date,
 _benchmarkSymbolMap:()=>({VKOSPI:['KRX_OPEN_API:VKOSPI']}),
 _readVkospiPointsFromKrx:()=>[{date,value:25.42}],
 fetchYahooIndexCurrent:()=>null,
 jsonOk:x=>({...x,status:'ok'}),jsonError:message=>({status:'error',message})
};
vm.createContext(ctx);
vm.runInContext(gas.slice(start,end),ctx);
const gasPayload=ctx.handleGetBenchmark('VKOSPI',date,date);
assert.equal(gasPayload.status,'ok');
assert.equal(gasPayload.symbol,'KRX_OPEN_API:VKOSPI');
assert.equal(gasPayload.points.length,1);
assert.equal(Object.hasOwn(gasPayload.points[0],'source'),false);
assert.deepEqual(selectClosingVkospi(date,gasPayload),selectClosingVkospi(date,payload));
const row=selectClosingVkospi(date,payload);
assert.equal(row.length,1);
assert.equal(row[0].value,25.42);
assert.deepEqual(verifyClosingVkospi(date,row),row);
assert.deepEqual(selectClosingVkospi(date,{...payload,points:payload.points.concat(payload.points)}),[]);
assert.deepEqual(selectClosingVkospi(date,{...payload,points:[{...payload.points[0],date:'2026-10-30'}]}),[]);
assert.deepEqual(selectClosingVkospi(date,{...payload,points:[{...payload.points[0],source:'NH_INDEX_DAILY'}]}),[]);
assert.deepEqual(selectClosingVkospi(date,{...payload,points:[{...payload.points[0],source:'KRX_OFFICIAL'}]}),row,
 'source may be explicitly KRX but production GAS omits it');
assert.deepEqual(selectClosingVkospi(date,{...payload,points:[{...payload.points[0],value:0}]}),[]);
assert.deepEqual(selectClosingVkospi(date,{...payload,symbol:'VKOSPI'}),[]);
assert.deepEqual(verifyClosingVkospi(date,[{...row[0],date:'2026-10-30'}]),[]);
assert.deepEqual(verifyClosingVkospi(date,[row[0],row[0]]),[]);

let calls=[];
const fetchImpl=async(endpoint,opts)=>{
 calls.push({endpoint,opts});
 return {ok:true,json:async()=>payload};
};
const endpoint='https://script.google.com/macros/s/TEST/exec';
assert.deepEqual(await readClosingVkospi(date,{url:endpoint,token:'TEST-GAS-ACCESS',now,fetchImpl}),row);
assert.equal(calls.length,1);
assert.equal(new URLSearchParams(calls[0].opts.body).get('action'),'getBenchmark');
assert.equal(new URLSearchParams(calls[0].opts.body).get('benchmark'),'VKOSPI');
assert.equal(new URLSearchParams(calls[0].opts.body).get('from'),date);
assert.equal(calls[0].opts.method,'POST');
assert.deepEqual(await readClosingVkospi(date,{url:endpoint,token:'TEST-GAS-ACCESS',
 now:()=>new Date(date+'T15:59:00+09:00'),fetchImpl}),[]);
assert.equal(calls.length,1,'before official close window, no request');
assert.deepEqual(await readClosingVkospi(date,{url:'https://untrusted.example/exec',
 token:'TEST-GAS-ACCESS',now,fetchImpl}),[]);
assert.equal(calls.length,1,'untrusted host blocked');
assert.deepEqual(await readClosingVkospi(date,{url:endpoint,token:'TEST-GAS-ACCESS',
 now,fetchImpl:async()=>({ok:true,json:async()=>({...payload,points:[]})})}),[]);

const vkReasons=[];
assert.deepEqual(await readClosingVkospi(date,{url:endpoint,token:'TEST-GAS-ACCESS',
 now,authKey:'',fetchImpl:async()=>({ok:true,json:async()=>({...payload,points:[]})}),
 onDiagnostic:r=>vkReasons.push(r)}),[]);
assert.deepEqual(vkReasons.map(x=>x.status),
 ['NO_EXACT_VALID_ROW','KRX_DIRECT_CONFIG_OR_SESSION_UNVERIFIED']);
vkReasons.length=0;
assert.deepEqual(await readClosingVkospi(date,{url:endpoint,token:'TEST-GAS-ACCESS',
 now,authKey:'',fetchImpl:async()=>({ok:true,json:async()=>({
  status:'error',message:'TEST_SECRET_NOT_TO_LOG'})}),
 onDiagnostic:r=>vkReasons.push(r)}),[]);
assert.deepEqual(vkReasons.map(x=>x.status),
 ['GAS_STATUS_ERROR','KRX_DIRECT_CONFIG_OR_SESSION_UNVERIFIED']);
assert.doesNotMatch(JSON.stringify(vkReasons),/TEST_SECRET_NOT_TO_LOG/);

const reviewedVkErrors=[
 ['선택 기간의 VKOSPI 데이터를 조회하지 못했습니다.','KRX_NO_DATED_VKOSPI_POINT'],
 ['getBenchmark 실패: VKOSPI 조회에는 KRX AUTH_KEY가 필요합니다. 설정에서 KRX 인증키를 등록하세요.','KRX_KEY_NOT_CONFIGURED'],
 ['getBenchmark 실패: KRX AUTH_KEY가 유효하지 않거나 지수 API 이용 권한이 없습니다.','KRX_KEY_OR_INDEX_PERMISSION_DENIED'],
 ['getBenchmark 실패: VKOSPI 날짜 배치 네트워크 오류','KRX_VKOSPI_BATCH_NETWORK_FAILURE'],
 ['인증 실패','GAS_AUTH_REJECTED']
];
for(const [message,expectedStatus] of reviewedVkErrors){
 const reason=[];
 const rows=await readClosingVkospi(date,{
  url:endpoint,token:'TEST-GAS-ACCESS',now,authKey:'',
  fetchImpl:async()=>({ok:true,json:async()=>({status:'error',message})}),
  onDiagnostic:x=>reason.push(x)
 });
 assert.deepEqual(rows,[]);
 assert.deepEqual(reason.map(x=>x.status),
  [expectedStatus,'KRX_DIRECT_CONFIG_OR_SESSION_UNVERIFIED']);
 assert.ok(!JSON.stringify(reason).includes(message),
  'raw provider message must never be emitted');
}

const coverage=summarizeCloseCoverage(date,{vkospi:row,expectedUsDate:us});
assert.equal(coverage.volatility.verified,1);
assert.equal(coverage.statuses.find(x=>x.id==='VKOSPI').status,'VERIFIED');
assert.equal(CLOSE_SOURCE_CATALOG.notConnected.includes('VKOSPI'),false);
assert.equal(summarizeCloseCoverage(date,{expectedUsDate:us}).volatility.verified,0);
const nh=[{label:'S&P 500',symbol:'^GSPC',date:us,value:7580,source:'NH_INDEX_DAILY',changePercent:0.5}];
const formatted=formatClose(date,nh,[],[],[],[],[],[],now(),[],row);
assert.match(formatted,/VKOSPI: 25\.42 \[2026-11-02 · KRX\]/);
assert.match(formatted,/VKOSPI 1\/1/);
assert.ok(formatted.length<4000);
assert.match(formatClose(date,nh),/VKOSPI: 당일 확정치 미확보/);
const prepared=await prepareClose({
 now,githubToken:'DUMMY',repository:'cyyoung111-dev/portfolio',
 fetchImpl:async()=>({ok:true,json:async()=>({total_count:0,artifacts:[]})}),
 fetchNh:async()=>nh,fetchDomestic:async()=>[],fetchSecondary:async()=>[],
 fetchStocks:async()=>[],fetchMacros:async()=>[],fetchMarkets:async()=>[],
 fetchFutures:async()=>[],fetchRates:async()=>[],fetchVkospi:async()=>row
});
assert.equal(prepared.ready,true);
assert.equal(prepared.vkospiCount,1);
assert.deepEqual(prepared.reportInputs.vkospi,row);
let sent='';
await deliverClose(prepared,{now:()=>new Date(date+'T17:42:00+09:00'),
 send:async(_token,_chat,message)=>{sent=message;}});
assert.match(sent,/VKOSPI: 25\.42/);
await assert.rejects(deliverClose({...prepared,reportInputs:{...prepared.reportInputs,
 vkospi:[{...row[0],date:'2026-10-30'}]}},{now,send:async()=>assert.fail('stale value sent')}),
 /TELEGRAM_CLOSE_PAYLOAD_INVALID/);

// Pinned 9.284 predecessor is immutable: preview the historical one-URL change.
// Never install/deploy this historical proposal into the promoted 9.285 runtime.
const sourceGas=fs.readFileSync('reference/gas-v9.284.gs','utf8');
const proposal=composeGASVkospiDerivativeProposal(sourceGas);
assert.notEqual(proposal.candidate,sourceGas);
assert.equal(proposal.candidate.replace(PROPOSED_DERIVATIVE_ENDPOINT,
 CURRENT_INDEX_ENDPOINT),sourceGas);
assert.equal(proposal.reviewedBlob,gitBlobSha(sourceGas));
assert.equal(proposal.financialWrites,0);
assert.equal(proposal.gasDeployments,0);
assert.equal(proposal.telegramSends,0);
assert.equal(proposal.externalRequests,0);
assert.throws(()=>composeGASVkospiDerivativeProposal(sourceGas+'\\n'),
 /GAS_VKOSPI_REVIEWED_SOURCE_MISMATCH/);
const i=proposal.candidate.indexOf('function _readVkospiPointsFromKrx(');
const j=proposal.candidate.indexOf(String.fromCharCode(10)+'}',i)+2;
assert.ok(i>=0&&j>i);
const fn=proposal.candidate.slice(i,j);
let dailyRows=[{IDX_NM:'코스피 200 변동성지수',BAS_DD:'20261105',
 CLSPRC_IDX:'25.42'}],captured=[];
const proofContext={
 _issue507GateInside_:true,
 _getKrxAuthKeySlots_:()=>({key:'SYNTHETIC_ONLY_KRX_KEY',alternative:''}),
 CacheService:{getScriptCache:()=>({get:()=>null,getAll:()=>({}),
  put:()=>{},putAll:()=>{}})},
 _buildDateRangeYmd:()=>['20261105'],
 _ymdToDate:()=>new Date('2026-11-05T00:00:00Z'),
 _krxCalendarStatus_:()=> 'OPEN',
 _normalizeYmd:x=>x,
 UrlFetchApp:{fetchAll:reqs=>{
  captured.push(...reqs.map(r=>({url:r.url,method:r.method,
   hasApprovedHeader:r.headers.AUTH_KEY==='SYNTHETIC_ONLY_KRX_KEY'})));
  return reqs.map(()=>({getResponseCode:()=>200,
   getContentText:()=>JSON.stringify({OutBlock_1:dailyRows})}));
 }},
 Logger:{log:()=>{}}
};
const candidateFn=vm.runInNewContext(fn+String.fromCharCode(10)+
 '_readVkospiPointsFromKrx;',proofContext);
const officialRows=JSON.parse(JSON.stringify(
 candidateFn('2026-11-05','2026-11-05')));
assert.deepEqual(officialRows,[{date:'2026-11-05',value:25.42}]);
assert.equal(captured.length,1);
assert.match(captured[0].url,/\/svc\/apis\/idx\/drvprod_dd_trd\?basDd=20261105/);
assert.equal(captured[0].hasApprovedHeader,true);
dailyRows=[{IDX_NM:'코스피 200 변동성지수',BAS_DD:'20261104',
 CLSPRC_IDX:'25.42'}];
assert.deepEqual(JSON.parse(JSON.stringify(
 candidateFn('2026-11-05','2026-11-05'))),[]);
dailyRows=[{IDX_NM:'KOSPI 200',BAS_DD:'20261105',CLSPRC_IDX:'25.42'}];
assert.deepEqual(JSON.parse(JSON.stringify(
 candidateFn('2026-11-05','2026-11-05'))),[]);
console.log('GAS_VKOSPI_DERIVATIVE_PROPOSAL_PASS only 1 URL, exact source/date, no deploy');

// Official derivative endpoint is a strict read-only backup for a missing GAS row.
const {selectOfficialKrxVkospiDaily,readOfficialKrxVkospiDaily}
 =await import('./krx-vkospi-daily.mjs');
const dateRaw='20261102',directRow={IDX_NM:'코스피 200 변동성지수',
 BAS_DD:dateRaw,CLSPRC_IDX:'25.42'};
const derivative={OutBlock_1:[directRow,{...directRow,IDX_NM:'코스피 200 변동성매칭 양매도지수'}]};
assert.deepEqual(selectOfficialKrxVkospiDaily(date,derivative),row);
assert.deepEqual(selectOfficialKrxVkospiDaily(date,{OutBlock_1:[directRow,directRow]}),[]);
assert.deepEqual(selectOfficialKrxVkospiDaily(date,{OutBlock_1:[{...directRow,BAS_DD:'20261101'}]}),[]);
assert.deepEqual(selectOfficialKrxVkospiDaily(date,{OutBlock_1:[{...directRow,CLSPRC_IDX:'NaN'}]}),[]);
let directCalls=0;
const official=await readOfficialKrxVkospiDaily(date,{
 authKey:'KRX_APPROVED_TEST_KEY_123456',now,
 fetchImpl:async(target,options)=>{
  directCalls++;
  assert.match(target,/\/idx\/drvprod_dd_trd\?basDd=20261102$/);
  assert.equal(options.method,'GET');
  assert.equal(options.headers.AUTH_KEY,'KRX_APPROVED_TEST_KEY_123456');
  return {ok:true,status:200,json:async()=>derivative};
 }});
assert.deepEqual(official,row);
assert.equal(directCalls,1);
const directMiss=[];
assert.deepEqual(await readOfficialKrxVkospiDaily(date,{
 authKey:'KRX_APPROVED_TEST_KEY_123456',now,
 onDiagnostic:status=>directMiss.push(status),
 fetchImpl:async()=>({ok:false,status:403})}),[]);
assert.deepEqual(directMiss,['KRX_DIRECT_ACCESS_DENIED']);
directMiss.length=0;
assert.deepEqual(await readOfficialKrxVkospiDaily(date,{
 authKey:'KRX_APPROVED_TEST_KEY_123456',now,
 onDiagnostic:status=>directMiss.push(status),
 fetchImpl:async()=>({ok:true,status:200,json:async()=>({OutBlock_1:[]})})}),[]);
assert.deepEqual(directMiss,['KRX_DIRECT_NO_EXACT_ROW']);
assert.deepEqual(await readOfficialKrxVkospiDaily(date,{
 authKey:'',now,fetchImpl:async()=>assert.fail('must not query without auth')}),[]);
assert.deepEqual(await readOfficialKrxVkospiDaily(date,{
 authKey:'KRX_APPROVED_TEST_KEY_123456',
 now:()=>new Date(date+'T15:40:00+09:00'),
 fetchImpl:async()=>assert.fail('must not query before final close')}),[]);
const diag=[];
const recovered=await readClosingVkospi(date,{url:endpoint,token:'TEST-GAS-ACCESS',
 authKey:'KRX_APPROVED_TEST_KEY_123456',now,onDiagnostic:x=>diag.push(x),
 fetchImpl:async(target,options)=>target.startsWith('https://script.google.com')
  ?{ok:true,json:async()=>({status:'error',message:'선택 기간의 VKOSPI 데이터를 조회하지 못했습니다.'})}
  :{ok:true,status:200,json:async()=>derivative}
});
assert.deepEqual(recovered,row);
assert.deepEqual(diag.map(x=>x.status),['KRX_NO_DATED_VKOSPI_POINT','KRX_DIRECT_VERIFIED']);

console.log('CLOSING_VKOSPI_PASS exact KRX date, trusted GAS, QC, send-time protection');
