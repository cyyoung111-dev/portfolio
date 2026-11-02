import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
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
console.log('CLOSING_VKOSPI_PASS exact KRX date, trusted GAS, QC, send-time protection');
