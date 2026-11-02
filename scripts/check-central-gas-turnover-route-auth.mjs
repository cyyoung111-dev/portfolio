import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {composeGasTurnoverProposal} from './compose-gas-krx-turnover-proposal.mjs';

// Execute real production GAS functions, including doGet/doPost and
// _isAuthorizedRequest. Stub only GAS platform services and time/market data.
// The approved apps_script.gs blob remains immutable.
const approved=fs.readFileSync('src/gas/apps_script.gs','utf8');
const source=composeGasTurnoverProposal(approved);
function extractFunction(name){
 const start=source.indexOf('function '+name+'(');
 assert.ok(start>=0,'missing production function '+name);
 const end=source.indexOf('\n}',start);
 assert.ok(end>start,'missing close for '+name);
 return source.slice(start,end+2);
}
const functions=[
 '_isAuthorizedRequest','_getKrxAuthKeySlots_',
 'doGet','doPost','jsonOk','jsonError',
 '_krxMarketTurnoverKrw_','_selectKrxMarketTurnover_','handleGetKrxMarketTurnover'
];
const actual=functions.map(extractFunction).join('\n\n');
const date='2026-11-02';
const expectedToken='GAS_ACCESS_AUTH_VALID_20261102';
const responses={
 KOSPI:{OutBlock_1:[{BAS_DD:'20261102',IDX_NM:'코스피',ACC_TRDVAL:'20,250,000,000,000'}]},
 KOSDAQ:{OutBlock_1:[{BAS_DD:'20261102',IDX_NM:'코스닥',ACC_TRDVAL:'6,300,000,000,000'}]}
};
const fakeHttp=payload=>({
 getResponseCode:()=>200,getContentText:()=>JSON.stringify(payload)
});
const makeContext=code=>{
 let requests=0;
 const properties={
  access_token:expectedToken,krx_auth_key:'PRIMARY_KRX_KEY_20261102',
  krx_api_key:'LEGACY_KRX_KEY_20261102'
 };
 let writes=0;
 const ctx={
  PropertiesService:{getScriptProperties:()=>({
   getProperty:key=>properties[key]||null,
   setProperty:()=>{writes++;throw Error('UNEXPECTED_PROPERTIES_WRITE');},
   deleteProperty:()=>{writes++;throw Error('UNEXPECTED_PROPERTIES_DELETE');}
  })},
  UrlFetchApp:{fetchAll:items=>{
   requests+=items.length;
   return items.map(x=>fakeHttp(x.url.includes('/kospi_dd_trd')?responses.KOSPI:responses.KOSDAQ));
  }},
  ContentService:{MimeType:{JSON:'application/json'},createTextOutput:text=>({
   getContent:()=>text,setMimeType(){return this;}
  })},
  _normalizeDate:s=>/^\d{4}-\d{2}-\d{2}$/.test(s)?s:'',
  _krxCalendarStatus_:()=> 'OPEN',
  _isKrxOfficialCloseAvailableTime_:()=>true,
  _issue507GateInside_:true
 };
 vm.createContext(ctx);
 new vm.Script(code,{filename:'production-gas-route-proposal.gs'}).runInContext(ctx);
 const call=(method,token)=>{
  const query={action:'getKrxMarketTurnover',date};
  if(token!==null)query.accessToken=token;
  const arg=method==='GET'
   ?{parameter:query}
   :{postData:{contents:new URLSearchParams(query).toString()}};
  const response=method==='GET'?ctx.doGet(arg):ctx.doPost(arg);
  return JSON.parse(response.getContent());
 };
 return {call,requests:()=>requests,writes:()=>writes};
};
for(const method of ['GET','POST']){
 const live=makeContext(actual);
 assert.equal(live.call(method,expectedToken).status,'ok',method+' authorized must pass');
 assert.equal(live.call(method,expectedToken).rows.length,2);
 assert.equal(live.requests(),4,method+' authorized 2 calls per request');
 for(const invalid of [null,'INVALID_GAS_TOKEN_20261102','',expectedToken.slice(0,-1)]){
  const before=live.requests();
  const out=live.call(method,invalid);
  assert.equal(out.status,'error',method+' unauthorized '+String(invalid));
  assert.match(out.message,/인증 실패/);
  assert.equal(live.requests(),before,method+' unauthorized never calls KRX');
 }
 assert.equal(live.writes(),0,method+' must not mutate GAS Script Properties');
 // Negative mutation oracle: removing the entrypoint admission MUST cause the
 // same unauthorized-contract check to fail. This proves real route guards run.
 const guard="if (!_isAuthorizedRequest(params)) return jsonError('인증 실패');";
 assert.equal(actual.split(guard).length,3,'real GAS has two independent guards');
 const mutated=actual.replace(guard,'/* mutation: removed request authentication */')
  .replace(guard,'/* mutation: removed request authentication */');
 const unsafe=makeContext(mutated);
 const result=unsafe.call(method,'INVALID_GAS_TOKEN_20261102');
 assert.notEqual(result.status,'error',method+' mutated route admits invalid token');
 assert.equal(unsafe.requests(),2,method+' mutation reaches KRX');
}
console.log('GAS_ROUTE_AUTH_TURNOVER_PASS real doGet/doPost/auth, denied without KRX calls, mutation detected');
