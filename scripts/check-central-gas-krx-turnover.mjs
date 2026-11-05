import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {readClosingKrxTurnoverFromGas} from './closing-krx-turnover.mjs';
import {composeGasTurnoverProposal,BASE_GAS_BLOB_SHA} from './compose-gas-krx-turnover-proposal.mjs';

const date='2026-11-02';
const now=()=>new Date(date+'T17:05:00+09:00');
const approved=fs.readFileSync('reference/gas-v9.282.gs','utf8');
assert.doesNotMatch(approved,/function handleGetKrxMarketTurnover\(/,'approved original remains unchanged');
assert.equal(BASE_GAS_BLOB_SHA,'9c1a5f31d1abc4b44f7da9af7a50fe3f15967134');
const gas=composeGasTurnoverProposal(approved);
assert.notEqual(gas,approved);
assert.throws(()=>composeGasTurnoverProposal(approved+'\n'),/UNREVIEWED_BASE/);
const from=gas.indexOf('function _krxMarketTurnoverKrw_(');
const to=gas.indexOf('function handleGetBenchmarks(',from);
assert.ok(from>0&&to>from,'production GAS turnover functions must be present');
assert.match(gas,/params.action === 'getKrxMarketTurnover'\)\s+return handleGetKrxMarketTurnover/);
assert.match(gas,/'getBenchmark', 'getKrxMarketTurnover', 'getBenchmarks'/);

const fixtures={
 KOSPI:{OutBlock_1:[
  {IDX_NM:'코스피',BAS_DD:'20261102',ACC_TRDVAL:'20,250,000,000,000'},
  {IDX_NM:'코스피 200',BAS_DD:'20261102',ACC_TRDVAL:'18,000,000,000,000'}]},
 KOSDAQ:{OutBlock_1:[
  {IDX_NM:'코스닥',BAS_DD:'20261102',ACC_TRDVAL:'6,300,000,000,000'}]}
};
const response=(status,payload)=>({
 getResponseCode:()=>status,getContentText:()=>JSON.stringify(payload)
});
const calls=[];
let available=true,calendar='OPEN',slots={key:'TEST_PRIMARY',alternative:'TEST_LEGACY'};
let provider=(requests)=>{
 calls.push(requests.map(x=>({
  url:x.url,method:x.method,
  // deliberately exclude the key from captured test evidence
  credentialClass:x.headers.AUTH_KEY==='TEST_PRIMARY'?'PRIMARY':'ALTERNATE'
 })));
 return requests.map(x=>response(200,x.url.includes('kospi_dd_trd')?fixtures.KOSPI:fixtures.KOSDAQ));
};
const ctx={
 _normalizeDate:x=>/^\d{4}-\d{2}-\d{2}$/.test(x)?x:'',
 _krxCalendarStatus_:()=>calendar,
 _isKrxOfficialCloseAvailableTime_:()=>available,
 _getKrxAuthKeySlots_:()=>slots,
 UrlFetchApp:{fetchAll:reqs=>provider(reqs)},
 jsonOk:result=>({status:'ok',...result})
};
vm.createContext(ctx);
vm.runInContext(gas.slice(from,to),ctx);
const read=()=>ctx.handleGetKrxMarketTurnover(date);
const fresh=read();
assert.equal(fresh.status,'ok');
assert.equal(fresh.source,'KRX_OFFICIAL_INDEX_DAILY');
assert.equal(fresh.readOnly,true);
assert.equal(fresh.rows.length,2);
assert.equal(fresh.rows[0].valueKrw,20250000000000);
assert.equal(fresh.rows[1].valueKrw,6300000000000);
assert.deepEqual(Array.from(fresh.rows,x=>x.market),['KOSPI','KOSDAQ']);
assert.equal(calls.length,1);
assert.equal(calls[0].length,2);
assert.ok(calls[0].every(x=>x.url.includes('data-dbg.krx.co.kr')
 &&x.url.endsWith('basDd=20261102')&&x.method==='get'));
assert.ok(!JSON.stringify(fresh).includes('TEST_PRIMARY')
 &&!JSON.stringify(fresh).includes('TEST_LEGACY'));

available=false;
assert.equal(read().rows.length,0);
assert.equal(calls.length,1,'prepublication must not fetch');
available=true;calendar='CLOSED';
assert.equal(read().rows.length,0);
assert.equal(calls.length,1,'closed day must not fetch');
calendar='UNKNOWN';
assert.equal(read().rows.length,0);
assert.equal(calls.length,1,'unknown calendar must fail closed');
calendar='OPEN';slots={key:'',alternative:''};
assert.equal(read().rows.length,0);
assert.equal(calls.length,1,'no credential must not fetch');
slots={key:'TEST_PRIMARY',alternative:'TEST_LEGACY'};

provider=reqs=>{
 calls.push(reqs.map(x=>({url:x.url,credentialClass:x.headers.AUTH_KEY})));
 return reqs.map(x=>x.headers.AUTH_KEY==='TEST_PRIMARY'
  ?response(x.url.includes('kospi_dd_trd')?403:200,
    x.url.includes('kospi_dd_trd')?{}:fixtures.KOSDAQ)
  :response(200,fixtures.KOSPI));
};
assert.equal(read().rows.length,2,'authenticated primary + approved alternate');
assert.equal(calls.at(-1).length,1,'retry denied markets only');
assert.ok(calls.at(-1)[0].url.includes('kospi_dd_trd'));

provider=reqs=>{
 calls.push(reqs.map(x=>({url:x.url})));
 return reqs.map(x=>response(200,x.url.includes('kospi_dd_trd')
  ?{OutBlock_1:[fixtures.KOSPI.OutBlock_1[0],fixtures.KOSPI.OutBlock_1[0]]}
  :{OutBlock_1:[{IDX_NM:'코스닥',BAS_DD:'20261030',ACC_TRDVAL:'6300000000000'}]}));
};
assert.equal(read().rows.length,0,'duplicate KOSPI and wrong-date KOSDAQ rejected');
provider=reqs=>{
 calls.push(reqs.map(x=>({url:x.url})));
 return reqs.map(x=>response(200,x.url.includes('kospi_dd_trd')
  ?{OutBlock_1:[{IDX_NM:'코스피',BAS_DD:'20261102',ACC_TRDVAL:'0'}]}
  :{OutBlock_1:[{IDX_NM:'코스닥',BAS_DD:'20261102',ACC_TRDVAL:'6.3'}]}));
};
assert.equal(read().rows.length,0,'invalid amounts rejected');

const exact={status:'ok',date,readOnly:true,source:'KRX_OFFICIAL_INDEX_DAILY',
 rows:JSON.parse(JSON.stringify(fresh.rows))};
let webCalls=0;
const webFetch=async(url,opts)=>{
 webCalls++;
 assert.equal(new URL(url).hostname,'script.google.com');
 assert.equal(new URLSearchParams(opts.body).get('action'),'getKrxMarketTurnover');
 assert.equal(new URLSearchParams(opts.body).get('date'),date);
 assert.equal(new URLSearchParams(opts.body).get('accessToken'),'TEST_GAS_ACCESS_0123456789');
 return {ok:true,json:async()=>exact};
};
const url='https://script.google.com/macros/s/TEST/exec';
const args={url,token:'TEST_GAS_ACCESS_0123456789',now,fetchImpl:webFetch};
const values=await readClosingKrxTurnoverFromGas(date,args);
assert.equal(values.length,2);
assert.equal(values[0].valueKrw,20250000000000);
assert.equal(webCalls,1);
assert.deepEqual(await readClosingKrxTurnoverFromGas(date,{...args,url:'https://evil.example/exec'}),[]);
assert.deepEqual(await readClosingKrxTurnoverFromGas(date,{...args,token:''}),[]);
assert.deepEqual(await readClosingKrxTurnoverFromGas(date,{
 ...args,now:()=>new Date(date+'T15:50:00+09:00')}),[]);
assert.equal(webCalls,1);
for(const bad of [
 {...exact,date:'2026-10-30'}, {...exact,readOnly:false},
 {...exact,source:'UNKNOWN'},
 {...exact,rows:[...exact.rows,exact.rows[0]]},
 {...exact,rows:[{...exact.rows[0],date:'2026-10-30'}]}
]){
 assert.deepEqual(await readClosingKrxTurnoverFromGas(date,{
  ...args,fetchImpl:async()=>({ok:true,json:async()=>bad})}),[]);
}
console.log('CENTRAL_GAS_KRX_TURNOVER_PASS reproducible production-handler candidate, approved blob unchanged, auth/date/partial failure/client');
