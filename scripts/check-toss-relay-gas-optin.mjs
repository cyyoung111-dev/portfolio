import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {summarizeTossDiagnostic} from './diagnose-toss-operational.mjs';

// Exercise production GAS functions, never a hand-written copy of the router.
const gas=fs.readFileSync('src/gas/apps_script.gs','utf8');
function extract(name) {
  const start=gas.indexOf('function '+name+'(');
  assert.ok(start>=0,'missing '+name);
  const end=gas.indexOf('\n}',start);
  assert.ok(end>start,'unterminated '+name);
  return gas.slice(start,end+2);
}
function harness(initial={}) {
  const props={...initial},fetchCalls=[],cacheCalls=[];
  const p={
    getProperty:key=>props[key]??null,
    setProperty:()=>{throw Error('UNEXPECTED_PROPERTY_WRITE')},
    deleteProperty:()=>{throw Error('UNEXPECTED_PROPERTY_DELETE')}
  };
  const ctx=vm.createContext({
    PropertiesService:{getScriptProperties:()=>p},
    TOSS_API_BASE:'https://openapi.tossinvest.com',
    TOSS_TOKEN_CACHE_KEY:'toss_oauth_token_v1',
    TOSS_TOKEN_SKEW_SECONDS:60,
    CacheService:{getScriptCache:()=>({
      get:()=>{cacheCalls.push('get');if(props.__cacheMiss)return null;return JSON.stringify({
        accessToken:'previous-direct-token',expiresAt:Date.now()+3600000
      })},
      put:()=>{throw Error('TOKEN_ISSUE_UNEXPECTED')},
      remove:()=>{throw Error('TOKEN_CACHE_MUTATION_UNEXPECTED')}
    })},
    Utilities:{sleep:()=>{throw Error('BACKOFF_UNEXPECTED')},
      formatDate:()=> '2026-10-16'},
    today:()=> '2026-10-17',
    jsonOk:body=>({status:'ok',...body}),
    UrlFetchApp:{fetch:(url,options)=>{
      fetchCalls.push({url,options});
      if(url==='https://openapi.tossinvest.com/api/v1/prices?symbols=005930')
        return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({
          result:[{symbol:'005930',currency:'KRW',lastPrice:99888,
            timestamp:'2026-10-16T15:30:00+09:00'}]})};
      if(url==='https://relay.example.com/v1/fetch')
        return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({
          ok:true,status:200,data:{result:[{symbol:'005930',currency:'KRW',
            lastPrice:12345,timestamp:'2026-10-16T15:30:00+09:00'}]}
        })};
      throw Error('UNEXPECTED_NETWORK_ENDPOINT');
    }},
    LockService:{getScriptLock:()=>({
      waitLock:()=>{if(props.__switchOnWait)props.TOSS_RELAY_MODE='ON';},
      releaseLock:()=>{}
    })},
    _tossSafeError_:()=>'', _priceTimingAdd_:()=>{},
    _tossProperties_:()=>({id:'mock-direct-id',secret:'mock-direct-secret'}),
    _tossSymbol_:item=>item.tossSymbol||item.code||'',
    _normalizeTossSymbol_:v=>String(v).trim().toUpperCase().replace(/^A(?=\d{6}$)/,'')
  });
  const names=['_tossRelayConfig_','_tossRelayAction_','_tossRelayRequest_',
    '_tossRequest_','_tossCachedTokenRecord_','_tossCachedAccessToken_',
    '_tossWithTokenLock_','_tossIssueAccessTokenUnlocked_',
    '_refreshTossAccessTokenAfter401_','_tossDiagnosticIssueAccessTokenUnlocked_',
    '_tossDiagnosticAccessToken_','_tossDiagnosticSharedToken_',
    '_tossAccessToken_','fetchPricesToss','fetchHistoricalPricesToss',
    '_tossRelayMarketDataDiagnostic_','handleDiagnoseTossMarketData'];
  for(const name of names)vm.runInContext(extract(name),ctx);
  return {ctx,props,fetchCalls,cacheCalls};
}
const secret='s'.repeat(64);
const relayProps={TOSS_RELAY_MODE:'ON',
  TOSS_RELAY_URL:'https://relay.example.com/v1/fetch',
  TOSS_RELAY_SHARED_KEY:secret};
// OFF must preserve existing direct Toss cached OAuth and request semantics.
{
  const t=harness({...relayProps,TOSS_RELAY_MODE:'OFF'});
  const p=t.ctx.fetchPricesToss([{code:'005930'}],{},{});
  assert.equal(p['005930'].price,99888);
  assert.equal(t.fetchCalls.length,1);
  assert.match(t.fetchCalls[0].url,/^https:\/\/openapi\.tossinvest\.com/);
  assert.equal(t.fetchCalls[0].options.headers.Authorization,'Bearer previous-direct-token');
  assert.ok(t.cacheCalls.length>0);
}
// ON must not issue/reuse direct GAS OAuth or contact the upstream at all.
{
  const t=harness(relayProps),meta={};
  const p=t.ctx.fetchPricesToss([{code:'005930'}],{},meta);
  assert.equal(p['005930'].price,12345);
  assert.equal(p['005930'].status,'INDICATIVE');
  assert.equal(meta.status,'SUCCESS');
  assert.equal(t.fetchCalls.length,1);
  const call=t.fetchCalls[0];
  assert.equal(call.url,relayProps.TOSS_RELAY_URL);
  assert.equal(call.options.method,'post');
  assert.equal(call.options.followRedirects,false);
  assert.equal(call.options.validateHttpsCertificates,true);
  assert.equal(call.options.headers['x-relay-key'],secret);
  assert.equal(call.options.headers.Authorization,undefined);
  assert.deepEqual(JSON.parse(call.options.payload),{
    action:'prices',params:{symbols:'005930'}
  });
  assert.equal(t.cacheCalls.length,0);
  assert.equal(t.ctx._tossAccessToken_(),'');
  assert.equal(t.cacheCalls.length,0);
  assert.equal(t.ctx._tossRelayAction_('/api/v1/candles',
    {symbol:'005930',interval:'1d',count:200,before:'',adjusted:'false'}).action,
    'candles');
  assert.equal(t.ctx._tossRelayAction_('/api/v1/market-calendar/KR',
    {date:'2026-10-16'}).action,'calendar');
  assert.equal(t.ctx._tossRelayAction_('/api/v1/market-indicators/KOSPI/candles',
    {count:1,interval:'1d'}).action,'indicatorCandles');
  assert.equal(t.ctx._tossRelayAction_('/api/v1/market-indicators/prices',
    {symbols:'KOSPI,KOSDAQ'}).action,'indicatorPrices');
  assert.equal(t.ctx._tossRelayAction_('/api/v1/exchange-rate',
    {baseCurrency:'USD',quoteCurrency:'KRW'}).action,'exchangeRate');
  assert.throws(()=>t.ctx._tossRelayAction_('/api/v1/orders',{}),
    /TOSS_RELAY_ROUTE_NOT_ALLOWED/);
  assert.throws(()=>t.ctx._tossRelayAction_('/api/v1/prices',
    {symbols:'005930',accountSeq:'123'}),/TOSS_RELAY_ROUTE_NOT_ALLOWED/);
  assert.doesNotMatch(JSON.stringify(p),new RegExp(secret));
}
for (const url of [
  'http://relay.example.com/v1/fetch','https://127.0.0.1/v1/fetch',
  'https://relay.example.com:8443/v1/fetch',
  'https://relay.example.com.evil.net/v1/fetch?x=1',
  'https://user@relay.example.com/v1/fetch',
  'https://relay..example.com/v1/fetch',
  'https://localhost/v1/fetch',
  'https://192.168.0.1/v1/fetch',
  'https://10.0.0.1/v1/fetch'
]) {
  const t=harness({...relayProps,TOSS_RELAY_URL:url});
  assert.throws(()=>t.ctx._tossRequest_('/api/v1/prices',{symbols:'005930'}),
    /TOSS_RELAY_CONFIG_INVALID/,url);
  assert.equal(t.fetchCalls.length,0,'bad target must not send secret');
}
// Existing standard base64url and base64 secrets must both be accepted.
assert.equal(harness({...relayProps,TOSS_RELAY_SHARED_KEY:'A+'.repeat(20)+'=='}).ctx._tossRelayConfig_().enabled,true);
for(const props of [
  {...relayProps,TOSS_RELAY_SHARED_KEY:'short'},
  {...relayProps,TOSS_RELAY_SHARED_KEY:'a'.repeat(32)+'\n'},
]) {
  const t=harness(props);
  assert.throws(()=>t.ctx._tossRequest_('/api/v1/prices',{symbols:'005930'}),
    /TOSS_RELAY_CONFIG_INVALID/);
  assert.equal(t.fetchCalls.length,0);
}
{
  const t=harness(relayProps);
  t.ctx.UrlFetchApp.fetch=(_url,opts)=>{t.fetchCalls.push(opts);return{
    getResponseCode:()=>302,getContentText:()=>'{"redirect":"https://evil.example"'
  }};
  assert.throws(()=>t.ctx._tossRequest_('/api/v1/prices',{symbols:'005930'}),
    /TOSS_RELAY_HTTP_302/);
  assert.equal(t.fetchCalls.length,1);
  assert.equal(t.fetchCalls[0].followRedirects,false);
}
{
  const t=harness(relayProps);
  t.ctx.UrlFetchApp.fetch=()=>({
    getResponseCode:()=>200,
    getContentText:()=>'{"ok":true,"status":200,"data":"invalid"}'
  });
  assert.throws(()=>t.ctx._tossRequest_('/api/v1/prices',{symbols:'005930'}),
    /TOSS_RELAY_RESPONSE_INVALID/);
}
// Operator may flip relay ON WHILE a direct token caller waits for ScriptLock.
// Such callers must never create/refresh OAuth or touch existing token cache.
{
  const t=harness({...relayProps,TOSS_RELAY_MODE:'OFF',__cacheMiss:true,__switchOnWait:true});
  assert.equal(t.ctx._tossAccessToken_(),'',
    'cache miss waiter must not issue OAuth after switching ON');
  assert.equal(t.props.TOSS_RELAY_MODE,'ON');
  assert.equal(t.fetchCalls.length,0);
  assert.equal(t.ctx._tossIssueAccessTokenUnlocked_(),'');
  const meta={};
  assert.equal(t.ctx._refreshTossAccessTokenAfter401_('old',meta),'');
  assert.equal(meta.source,'RELAY');
  const d=t.ctx._tossDiagnosticAccessToken_();
  assert.equal(d.ok,false);
  assert.equal(d.code,'RELAY_OAUTH_DELEGATED');
  assert.equal(d.source,'RELAY');
  assert.equal(t.fetchCalls.length,0,'not one direct OAuth request');
}
{
  const t=harness({...relayProps,TOSS_RELAY_MODE:'OFF',__switchOnWait:true});
  const meta={};
  assert.equal(t.ctx._refreshTossAccessTokenAfter401_('old',meta),'');
  assert.equal(meta.source,'RELAY');
  assert.equal(t.fetchCalls.length,0);
  assert.equal(t.cacheCalls.length,0,
    'lock waiter must not inspect/revoke token cache after relay ON');
}
// A relay timeout must not fan out into six more 18s VM calls. Keep the
// legacy response shape, suppress expensive follow-ups and never mint OAuth.
{
  const t=harness(relayProps);
  t.ctx.UrlFetchApp.fetch=(_url,options)=>{
    t.fetchCalls.push({url:_url,options});
    throw Error('mock upstream unresponsive');
  };
  const out=t.ctx.handleDiagnoseTossMarketData(false);
  assert.equal(t.fetchCalls.length,1,'first failed relay request stops probe fan-out');
  assert.equal(out.endpoints.length,5);
  assert.equal(out.endpoints[0].code,'RELAY_REQUEST_FAILED');
  assert.ok(out.endpoints.slice(1).every(x=>x.code==='SKIPPED_RELAY_UNAVAILABLE'));
  assert.equal(out.priceSmoke.code,'SKIPPED_RELAY_UNAVAILABLE');
  assert.equal(out.ok,false);
  assert.equal(t.cacheCalls.length,0,'relay diagnostics must not use direct OAuth');
}
// Preserve the diagnostic contract: UI and headless CLI must recognize
// delegated OAuth without issuing even one direct OAuth request.
{
  const t=harness(relayProps);
  const data=t.ctx.handleDiagnoseTossMarketData(false);
  assert.equal(data.status,'ok');
  assert.equal(data.gasVersion,'9.267');
  assert.equal(data.oauth.source,'RELAY');
  assert.equal(data.freshOAuthTested,false);
  assert.equal(data.endpoints.length,5);
  assert.equal(data.priceSmoke.symbol,'005930');
  assert.equal(data.priceSmoke.timestampPresent,true);
  assert.equal(data.priceSmoke.validLastPrice,true);
  assert.equal(t.fetchCalls.every(x=>x.url===relayProps.TOSS_RELAY_URL),true);
  assert.equal(t.cacheCalls.length,0,'diagnostic must not invalidate VM OAuth');
  const summarized=summarizeTossDiagnostic(data,'9.267');
  assert.equal(summarized.oauth.source,'RELAY');
  assert.equal(summarized.coreHealthy,true);
  assert.equal(summarized.allHealthy,true);
  assert.equal(summarized.freshOAuthConfirmed,false);
}
console.log('GAS 9.234 opt-in Toss HTTPS relay: production direct/OFF parity, ON no OAuth, strict routes, TLS, redirect, secrets and bad response guards PASS');
