import assert from 'node:assert/strict';
import {createServer} from './toss-free-relay.mjs';

const shared='a'.repeat(48);
let oauthCount=0,priceCount=0,resourceStatus=200,rejectOnce=false,oversized=false,streamBroken=false,receivedPaths=[],receivedQueries=[];
const mockFetch=async (url,opts)=>{
  const u=new URL(url);
  assert.equal(u.origin,'https://openapi.tossinvest.com','no arbitrary outgoing hosts');
  if(u.pathname==='/oauth2/token'){
    oauthCount++;
    assert.equal(opts.method,'POST');
    const f=new URLSearchParams(opts.body);
    assert.equal(f.get('grant_type'),'client_credentials');
    assert.equal(f.get('client_id'),'fake-id');
    assert.equal(f.get('client_secret'),'fake-secret');
    return new Response(JSON.stringify({access_token:'secret-token-'+oauthCount,token_type:'Bearer',expires_in:3600}),{status:200});
  }
  receivedPaths.push(u.pathname);
  receivedQueries.push(u.searchParams);
  assert.equal(opts.method,'GET');
  assert.match(opts.headers.Authorization,/^Bearer secret-token-/);
  if(rejectOnce){const kind=rejectOnce;rejectOnce=false;return new Response(kind==='empty'?'':(kind==='html'?'<h1>Unauthorized</h1>':JSON.stringify({error:{code:'token-revoked'}})),{status:401})}
  if(resourceStatus===403){
    return new Response(JSON.stringify({error:{code:'ip-not-allowed',message:'raw-secret-do-not-leak'}}),{status:403});
  }
  if(resourceStatus==='top403'){
    return new Response(JSON.stringify({code:'ip-not-allowed',message:'raw-secret-do-not-leak'}),{status:403});
  }
  if(resourceStatus==='html403')return new Response('<html>denied</html>',{status:403});
  if(resourceStatus==='empty429')return new Response('',{status:429});
  if(resourceStatus==='html500')return new Response('<html>maintenance</html>',{status:500});
  if(oversized)return new Response(JSON.stringify({result:[{data:'x'.repeat(550000)}]}),{status:200});
  if(streamBroken)return new Response(new ReadableStream({
    start(controller){
      controller.enqueue(new TextEncoder().encode('{"partial":"start"'));
      controller.error(new Error('sensitive-upstream-stream-failure'));
    }
  }),{status:200});
  priceCount++;
  return new Response(JSON.stringify({result:[{symbol:'005930',lastPrice:'12345',currency:'KRW',timestamp:'2026-10-15T01:00:00Z'}]}),{status:200});
};
const server=createServer({clientId:'fake-id',clientSecret:'fake-secret',sharedKey:shared,fetchImpl:mockFetch});
await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',resolve);
});
const address='http://127.0.0.1:'+server.address().port;
const post=async (data,key=shared)=>fetch(address+'/v1/fetch',{
  method:'POST',headers:{'content-type':'application/json','x-relay-key':key},
  body:JSON.stringify(data)
});
try{
  const health=await fetch(address+'/healthz');
  assert.equal(health.status,200);
  assert.equal((await health.json()).credentials,false);
  const blocked=await post({action:'prices',params:{symbols:'005930'}},'not-authorized');
  assert.equal(blocked.status,401);
  assert.equal(oauthCount,0);

  const first=await post({action:'prices',params:{symbols:'005930,000660'}});
  assert.equal(first.status,200);
  const price=await first.json();
  assert.equal(price.data.result[0].symbol,'005930');
  assert.equal(oauthCount,1);
  assert.equal(priceCount,1);

  const second=await post({action:'candles',params:{symbol:'AAPL',interval:'1d',count:10,adjusted:'false'}});
  assert.equal(second.status,200);
  assert.equal(oauthCount,1,'reuse existing OAuth token');
  assert.deepEqual(receivedPaths,['/api/v1/prices','/api/v1/candles']);
  const indicatorPages=await post({action:'indicatorCandles',params:{
    index:'KOSPI',interval:'1d',count:200,before:'2026-09-30T00:00:00+09:00'
  }});
  assert.equal(indicatorPages.status,200);
  assert.equal(receivedPaths.at(-1),'/api/v1/market-indicators/KOSPI/candles');
  assert.equal(receivedQueries.at(-1).get('count'),'200');
  assert.equal(receivedQueries.at(-1).get('before'),'2026-09-30T00:00:00+09:00');
  const indexSubset=await post({action:'indicatorPrices',params:{symbols:'KOSPI'}});
  assert.equal(indexSubset.status,200);
  assert.equal(receivedQueries.at(-1).get('symbols'),'KOSPI');
  const bondIndices=await post({action:'indicatorPrices',params:{symbols:'KR_BOND_2Y,KR_BOND_3Y,KR_BOND_5Y,KR_BOND_10Y,KR_BOND_20Y,KR_BOND_30Y'}});
  assert.equal(bondIndices.status,200);
  assert.equal(receivedQueries.at(-1).get('symbols'),'KR_BOND_2Y,KR_BOND_3Y,KR_BOND_5Y,KR_BOND_10Y,KR_BOND_20Y,KR_BOND_30Y');
  const bondCandles=await post({action:'indicatorCandles',params:{index:'KR_BOND_10Y',interval:'1d',count:200,before:'2026-10-12'}});
  assert.equal(bondCandles.status,200);
  assert.equal(receivedPaths.at(-1),'/api/v1/market-indicators/KR_BOND_10Y/candles');

  for(const action of ['accounts','orders','buy','arbitrary']){
    const resp=await post({action,params:{}});
    assert.equal(resp.status,403);
    assert.equal((await resp.json()).code,'ROUTE_NOT_ALLOWED');
  }
  for(const invalid of [
    {action:'prices',params:{symbols:'../'}},
    {action:'prices',params:{symbols:'005930',orderId:'23'}},
    {action:'candles',params:{symbol:'AAPL',interval:'1m'}},
    {action:'calendar',params:{market:'UNKNOWN',date:'2026-10-15'}},
    {action:'prices',params:{symbols:'005930,005930'}},
    {action:'indicatorPrices',params:{symbols:'TSLA'}},
    {action:'indicatorPrices',params:{symbols:'KOSPI,KOSPI'}},
    {action:'indicatorPrices',params:{symbols:'KR_BOND_30Y,QQQ'}},
    {action:'indicatorCandles',params:{index:'KR_BOND_99Y',count:200}},
    {action:'indicatorCandles',params:{index:'KOSPI',count:201}},
    {action:'indicatorCandles',params:{index:'KOSPI',interval:'1m'}},
    {action:'indicatorCandles',params:{index:'KOSPI',before:'x&evil=1'}},
    {action:'prices',params:{symbols:'005930'},secret:'oops'},
  ]) {
    const res=await post(invalid);
    assert.equal(res.status,400);
  }
  assert.equal(oauthCount,1,'invalid route never mints OAuth');
  resourceStatus=403;
  const denied=await post({action:'prices',params:{symbols:'005930'}});
  assert.equal(denied.status,502);
  const denial=await denied.json();
  assert.equal(denial.status,403);
  assert.equal(denial.code,'ip-not-allowed');
  assert.doesNotMatch(JSON.stringify(denial),/secret|raw-secret|access_token|fake-id|fake-secret|Bearer/);

  resourceStatus='top403';
  const topDenial=await post({action:'prices',params:{symbols:'005930'}});
  assert.equal(topDenial.status,502);
  assert.equal((await topDenial.json()).code,'ip-not-allowed','top-level Toss 403 code retained');
  for(const [mode,expectedStatus,expectedCode] of [
    ['html403',403,'UNKNOWN_403'],
    ['empty429',429,'RATE_LIMITED'],
    ['html500',500,'UPSTREAM_UNAVAILABLE']
  ]){
    resourceStatus=mode;
    const upstreamFailure=await post({action:'prices',params:{symbols:'005930'}});
    assert.equal(upstreamFailure.status,502);
    const payload=await upstreamFailure.json();
    assert.equal(payload.status,expectedStatus,'preserve upstream HTTP '+mode);
    assert.equal(payload.code,expectedCode,'preserve upstream classification '+mode);
  }
  resourceStatus=200;
  rejectOnce=true;
  const refreshed=await post({action:'prices',params:{symbols:'005930'}});
  assert.equal(refreshed.status,200);

  assert.equal(oauthCount,2,'only refresh on resource 401');
  for(const kind of ['empty','html']){
    rejectOnce=kind;
    const result=await post({action:'prices',params:{symbols:'005930'}});
    assert.equal(result.status,200,'401 '+kind+' should refresh despite non-JSON response');
  }
  assert.equal(oauthCount,4,'401 empty/HTML causes one refresh each');
  oversized=true;
  const largeUpstream=await post({action:'prices',params:{symbols:'005930'}});
  assert.equal(largeUpstream.status,502,'oversized Toss response must fail closed');
  assert.equal((await largeUpstream.json()).code,'UPSTREAM_RESPONSE_TOO_LARGE');
  oversized=false;
  streamBroken=true;
  const brokenStream=await post({action:'prices',params:{symbols:'005930'}});
  assert.equal(brokenStream.status,502,'upstream broken body must be 502, not internal 500');
  const brokenBody=await brokenStream.json();
  assert.equal(brokenBody.code,'UPSTREAM_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(brokenBody),/sensitive-upstream-stream-failure/);
  streamBroken=false;

  const huge=await fetch(address+'/v1/fetch',{
    method:'POST',headers:{'x-relay-key':shared},
    body:JSON.stringify({action:'prices',params:{symbols:'005930'},padding:'x'.repeat(5000)})
  });
  assert.equal(huge.status,413);
  const notFound=await fetch(address+'/v1/orders',{method:'POST',headers:{'x-relay-key':shared}});
  assert.equal(notFound.status,404);

  // Independent token-miss service: provider OAuth 403 must not be collapsed
  // into INTERNAL_ERROR just because the provider code contains hyphens.
  let oauthFailureMode='json403';
  const oauthFailureServer=createServer({
    clientId:'failure-id',clientSecret:'failure-secret',sharedKey:shared,
    fetchImpl:async (url)=>{
      assert.equal(new URL(url).pathname,'/oauth2/token');
      if(oauthFailureMode==='json403')return new Response(
        JSON.stringify({error:{code:'ip-not-allowed',message:'leak-me-never'}}),{status:403});
      if(oauthFailureMode==='html403')return new Response('<html>sensitive</html>',{status:403});
      if(oauthFailureMode==='empty429')return new Response('',{status:429});
      return new Response('<html>upstream-down</html>',{status:500});
    }
  });
  await new Promise((resolve,reject)=>{
    oauthFailureServer.once('error',reject);
    oauthFailureServer.listen(0,'127.0.0.1',resolve);
  });
  try{
    const failureUrl='http://127.0.0.1:'+oauthFailureServer.address().port+'/v1/fetch';
    for(const [mode,expected] of [
      ['json403','TOSS_OAUTH_IP_NOT_ALLOWED'],
      ['html403','TOSS_OAUTH_UNKNOWN_403'],
      ['empty429','TOSS_OAUTH_RATE_LIMITED'],
      ['html500','TOSS_OAUTH_UPSTREAM_UNAVAILABLE']
    ]){
      oauthFailureMode=mode;
      const result=await fetch(failureUrl,{method:'POST',headers:{
        'content-type':'application/json','x-relay-key':shared
      },body:JSON.stringify({action:'prices',params:{symbols:'005930'}})});
      assert.equal(result.status,502,'OAuth failure must preserve upstream classification');
      const payload=await result.json();
      assert.equal(payload.code,expected,'OAuth failure '+mode+' must be safe and specific');
      assert.doesNotMatch(JSON.stringify(payload),/leak-me-never|failure-secret|sensitive/);
    }
  }finally{
    await new Promise(resolve=>oauthFailureServer.close(resolve));
  }
  console.log('Toss read-only free static-IP relay: secure routes, OAuth caching, IP 403, limit and rejection tests passed');
}finally{
  await new Promise(resolve=>server.close(resolve));
}
