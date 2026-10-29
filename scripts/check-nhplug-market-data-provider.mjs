import assert from 'node:assert/strict';
import {createNhMarketDataProvider,normalizeNhQuote,normalizeNhKrDaily,nhDate} from './nhplug-market-data-provider.mjs';
const kr={code:'005930',market:'KR',currency:'KRW',type:'STOCK'};
const us={code:'holding-aapl',symbol:'AAPL',market:'US',currency:'USD',type:'STOCK'};
const at='2026-10-29T14:30:00Z';
assert.equal(nhDate('26/10/29'),'2026-10-29');
assert.equal(nhDate('20260230'),null);
const quote=normalizeNhQuote(us,{Output_0:{iem_cd:'USAAAPL',trdprc:'349.6718',trade_date:'20261029'}},{expectedId:'USAAAPL',receivedAt:at});
assert.equal(quote.price,349.6718);
assert.equal(quote.status,'INDICATIVE');
assert.equal(quote.timestamp,null);
assert.equal(quote.exchangeTimeVerified,false);
assert.throws(()=>normalizeNhQuote(us,{Output_0:{iem_cd:'QQQ',trdprc:1,trade_date:'20261029'}},{receivedAt:at}),/IDENTITY/);
assert.throws(()=>normalizeNhQuote(us,{Output_0:{iem_cd:'AAPL',trdprc:1,trade_date:'20261030'}},{receivedAt:at}),/FUTURE/);
assert.throws(()=>normalizeNhQuote(kr,{Output_0:{iem_cd:'005930',stck_prpr:'Infinity'}},{receivedAt:at}),/PRICE/);
const daily={Output_0:[{bsop_date:'20261029',stck_clpr:'232000'}]};
assert.equal(normalizeNhKrDaily(kr,daily,'2026-10-29',at).status,'PROVISIONAL');
assert.throws(()=>normalizeNhKrDaily(kr,daily,'2026-10-29','2026-10-29T06:29:59Z'),/NOT_CLOSED/);
assert.equal(normalizeNhKrDaily(kr,daily,'2026-10-29','2026-10-29T06:30:00Z').price,232000);
assert.throws(()=>normalizeNhKrDaily(kr,daily,'2026-10-28',at),/EXACT_DATE/);
assert.throws(()=>normalizeNhKrDaily(kr,{Output_0:[...daily.Output_0,...daily.Output_0]},'2026-10-29',at),/EXACT_DATE/);
let authCount=0,requests=0,active=0,maxActive=0;
const provider=createNhMarketDataProvider({key:'test-key',secret:'test-secret',now:()=>new Date(at),wait:async()=>{},request:async(url,options)=>{
  active++;maxActive=Math.max(maxActive,active);await Promise.resolve();active--;
  assert.equal(options.redirect,'error');
  if(url.includes('/oauth2/token')){authCount++;return {ok:true,json:async()=>({access_token:'test-token',expires_in:3600})};}
  requests++;assert.equal(options.headers.authorization,'Bearer test-token');
  return {ok:true,json:async()=>({Output_0:{iem_cd:'005930',stck_prpr:'232000'}})};
}});
await Promise.all([provider.quote(kr),provider.quote(kr)]);
assert.equal(authCount,1);assert.equal(requests,2);assert.equal(maxActive,1);
let calls=0;
const denied=createNhMarketDataProvider({key:'test-key',secret:'test-secret',now:()=>new Date(at),wait:async()=>{},request:async()=>{
  calls++;if(calls===1)return {ok:true,json:async()=>({access_token:'test-token',expires_in:3600})};
  return {ok:false,status:401,json:async()=>({secret:'do-not-emit'})};
}});
await assert.rejects(denied.quote(kr),/^Error: NH_HTTP_401$/);
assert.equal(calls,2); // no forced token renewal on a rejected request
let missingExpiryCalls=0;
const missingExpiry=createNhMarketDataProvider({key:'k',secret:'s',request:async()=>{missingExpiryCalls++;return {ok:true,json:async()=>({access_token:'x'})};}});
await assert.rejects(missingExpiry.quote(kr),/EXPIRY_UNVERIFIED/);
assert.equal(missingExpiryCalls,1);
console.log('NH provider: identity, provisional close, market dates, serialized token reuse and error checks passed');
