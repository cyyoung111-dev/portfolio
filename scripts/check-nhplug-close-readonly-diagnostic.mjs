import assert from 'node:assert/strict';
import {diagnoseClose} from './nhplug-close-readonly-diagnostic.mjs';

const key='example-key',secret='example-secret',token='example-token';
const time=()=>new Date('2026-10-29T07:00:00Z'); // 16:00 KST
function response(body,status=200){return {ok:status>=200&&status<300,status,json:async()=>body};}
function fake(overrides={}){
  const calls=[];
  const request=async (url,options)=>{
    calls.push({url,options});
    if(url.includes('/oauth2/token'))return response({access_token:token});
    const input=JSON.parse(options.body).Input_0;
    if(url.endsWith('/etfCurrent'))return overrides.etf ?? response({Output_0:{iem_cd:'069500',stck_prpr:12345}});
    const daily={Output_0:[{bsop_date:'20261029',stck_clpr:'71300'}]};
    return (input.iem_cd==='005930'?overrides.stock:overrides.dailyEtf)??response(daily);
  };
  return {request,calls};
}
async function run(mock,options={}){
  const logs=[];
  const ok=await diagnoseClose({key,secret,request:mock.request,log:x=>logs.push(x),wait:async()=>{},now:time,...options});
  const joined=logs.join('\n');
  assert.doesNotMatch(joined,/example-(key|secret|token)|71300|12345|Output_0|https?:/);
  return {ok,logs:joined};
}
{
  const mock=fake();
  const {ok,logs}=await run(mock);
  assert.equal(ok,true);
  assert.equal(mock.calls.length,4,'one token request, two daily requests, one ETF quote');
  assert.deepEqual(mock.calls.slice(1,3).map(c=>JSON.parse(c.options.body).Input_0),[
    {market_cd:'KRX',iem_cd:'005930',array_cnt:'2',view_main_yn:'Y'},
    {market_cd:'KRX',iem_cd:'069500',array_cnt:'2',view_main_yn:'Y'},
  ]);
  assert.equal(JSON.parse(mock.calls[3].options.body).Input_0.iem_cd,'069500');
  assert.equal(mock.calls[1].options.headers.authorization,'Bearer '+token);
  assert.match(logs,/KR_STOCK_DAILY HTTP_200 EXACT_DATE_CLOSE_PRESENT/);
  assert.match(logs,/KR_ETF_DAILY HTTP_200 EXACT_DATE_CLOSE_PRESENT/);
  assert.match(logs,/REGULAR_CLOSE_PREFLIGHT PASS LIVE_EXCHANGE_FINALITY_UNVERIFIED/);
}
for(const [changes,pattern] of [
  [{stock:response({Output_0:[{bsop_date:'20261028',stck_clpr:70000}]})},/KR_STOCK_DAILY HTTP_200 EXACT_DATE_CLOSE_UNVERIFIED/],
  [{dailyEtf:response({Output_0:[{bsop_date:'26\/10\/29',stck_clpr:'0'}]})},/KR_ETF_DAILY HTTP_200 EXACT_DATE_CLOSE_UNVERIFIED/],
  [{stock:response({Output_0:[{bsop_date:'20261029',stck_clpr:71300},{bsop_date:'20261029',stck_clpr:71301}]})},/KR_STOCK_DAILY HTTP_200 EXACT_DATE_CLOSE_UNVERIFIED/],
  [{stock:response({Output_0:[{bsop_date:'20260230',stck_clpr:71300}]})},/KR_STOCK_DAILY HTTP_200 EXACT_DATE_CLOSE_UNVERIFIED/],
  [{stock:response({message:{error:secret}})},/KR_STOCK_DAILY HTTP_200 EXACT_DATE_CLOSE_UNVERIFIED/],
  [{etf:response({Output_0:{iem_cd:'005930',stck_prpr:12345}})},/KR_ETF_CURRENT HTTP_200 CODE_OR_PRICE_UNVERIFIED/],
]){const {ok,logs}=await run(fake(changes));assert.equal(ok,false);assert.match(logs,pattern);}
{
  const mock=fake({stock:response({},429)});
  const {ok,logs}=await run(mock);assert.equal(ok,false);assert.equal(mock.calls.length,2);assert.match(logs,/HTTP_429/);
}
{
  const mock=fake();
  const {ok,logs}=await run(mock,{now:()=>new Date('2026-10-29T05:00:00Z')});
  assert.equal(ok,false);assert.equal(mock.calls.length,0);assert.match(logs,/NOT_AFTER_REGULAR_CLOSE/);
}
{
  const logs=[];
  assert.equal(await diagnoseClose({key:'',secret,log:x=>logs.push(x)}),false);
  assert.match(logs.join('\n'),/CREDENTIALS_MISSING/);
}
console.log('NH PLUG regular session close diagnostic synthetic tests passed');
