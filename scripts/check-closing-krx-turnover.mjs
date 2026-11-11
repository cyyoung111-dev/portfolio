import assert from 'node:assert/strict';
import {selectOfficialKrxTurnover,verifyOfficialKrxTurnover,
 fetchOfficialKrxTurnover,formatKrxTurnover,readClosingKrxTurnoverFromGas} from './closing-krx-turnover.mjs';

const date='2026-11-02',clock=()=>new Date(date+'T17:10:00+09:00');
const payload={
 KOSPI:{OutBlock_1:[
  {BAS_DD:'20261102',IDX_NM:'코스피',ACC_TRDVAL:'20,250,000,000,000'},
  {BAS_DD:'20261102',IDX_NM:'코스피 200',ACC_TRDVAL:'18,000,000,000,000'}]},
 KOSDAQ:{OutBlock_1:[
  {BAS_DD:'20261102',IDX_NM:'코스닥',ACC_TRDVAL:'6,300,000,000,000'}]}
};
const k=selectOfficialKrxTurnover(date,'KOSPI',payload.KOSPI);
const d=selectOfficialKrxTurnover(date,'KOSDAQ',payload.KOSDAQ);
assert.equal(k.valueKrw,20250000000000);
assert.equal(d.valueKrw,6300000000000);
assert.deepEqual(verifyOfficialKrxTurnover(date,[k,d]),[k,d]);
assert.match(formatKrxTurnover(date,[k,d]),/KOSPI 지수 구성종목 거래대금: 20\.25조원/);
assert.match(formatKrxTurnover(date,[k,d]),/KOSDAQ 지수 구성종목 거래대금: 6\.30조원/);
assert.deepEqual(verifyOfficialKrxTurnover(date,[k,k]),[]);
assert.deepEqual(verifyOfficialKrxTurnover(date,[{...k,date:'2026-10-30'}]),[]);
assert.equal(selectOfficialKrxTurnover(date,'KOSPI',{OutBlock_1:[
 ...payload.KOSPI.OutBlock_1,payload.KOSPI.OutBlock_1[0]]}),null);
for(const invalid of ['1,00,000','-1','0','1.5','not-a-number','10,000원','010000','1000000000000000']){
 assert.equal(selectOfficialKrxTurnover(date,'KOSPI',{OutBlock_1:[
 {BAS_DD:'20261102',IDX_NM:'코스피',ACC_TRDVAL:invalid}]}),null,invalid);
}
assert.equal(selectOfficialKrxTurnover(date,'KOSPI',{OutBlock_1:[
 {BAS_DD:'20261030',IDX_NM:'코스피',ACC_TRDVAL:'10000000000000'}]}),null);
assert.equal(selectOfficialKrxTurnover(date,'KOSPI',{OutBlock_1:[
 {BAS_DD:'20261102',IDX_NM:'코스닥',ACC_TRDVAL:'10000000000000'}]}),null);
assert.equal(selectOfficialKrxTurnover(date,'KOSPI',{OutBlock_1:new Array(251).fill({})}),null);
let calls=[];
const fetchImpl=async(url,options)=>{
 const u=new URL(url);calls.push({u,options});
 assert.equal(u.hostname,'data-dbg.krx.co.kr');
 assert.ok(['/svc/apis/idx/kospi_dd_trd','/svc/apis/idx/kosdaq_dd_trd'].includes(u.pathname));
 assert.equal(u.searchParams.get('basDd'),'20261102');
 assert.equal(options.headers.AUTH_KEY,'TEST_KRX_AUTH_KEY_VALID_123456');
 assert.equal(options.method,'GET');
 return {ok:true,headers:{get:()=>null},
  json:async()=>u.pathname.includes('kospi')?payload.KOSPI:payload.KOSDAQ};
};
const args={now:clock,authKey:'TEST_KRX_AUTH_KEY_VALID_123456',fetchImpl};
assert.deepEqual(await fetchOfficialKrxTurnover(date,args),[k,d]);
assert.equal(calls.length,2);
assert.deepEqual(await fetchOfficialKrxTurnover(date,{...args,authKey:''}),[]);
assert.deepEqual(await fetchOfficialKrxTurnover(date,{...args,
 now:()=>new Date(date+'T15:59:00+09:00')}),[]);
assert.equal(calls.length,2,'unauthorized and preclose calls must not reach network');
const partial=await fetchOfficialKrxTurnover(date,{...args,fetchImpl:async url=>
 url.includes('kospi_dd_trd')?{ok:true,headers:{get:()=>null},json:async()=>payload.KOSPI}:{ok:false}});
assert.deepEqual(partial,[k],'one confirmed market survives independent source failure');
assert.equal(verifyOfficialKrxTurnover(date,[{...k,source:'YAHOO'}]).length,0);
const gasReasons=[];
const gasRows=await readClosingKrxTurnoverFromGas(date,{
 url:'https://script.google.com/macros/s/TEST/exec',token:'TEST_KRX_ACCESS_TOKEN',
 now:clock,fetchImpl:async()=>({ok:true,json:async()=>({
  status:'ok',date,readOnly:true,source:'KRX_OFFICIAL_INDEX_DAILY',rows:[k,d]
 })}),onDiagnostic:r=>gasReasons.push(r)
});
assert.deepEqual(gasRows,[k,d]);
assert.deepEqual(gasReasons,[{kind:'KRX_TURNOVER_READ',status:'BOTH_VERIFIED'}]);
gasReasons.length=0;
assert.deepEqual(await readClosingKrxTurnoverFromGas(date,{
 url:'https://script.google.com/macros/s/TEST/exec',token:'TEST_KRX_ACCESS_TOKEN',
 now:clock,fetchImpl:async()=>({ok:true,json:async()=>({
  status:'ok',date,readOnly:true,source:'KRX_OFFICIAL_INDEX_DAILY',rows:[]
 })}),onDiagnostic:r=>gasReasons.push(r)
}),[]);
assert.deepEqual(gasReasons,[{kind:'KRX_TURNOVER_READ',status:'GAS_EMPTY_ROWS'}]);
console.log('KRX_TURNOVER_PROVIDER_PASS official KOSPI/KOSDAQ, units, date, duplicates, auth, optional');
