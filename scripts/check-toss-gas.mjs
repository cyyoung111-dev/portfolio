import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync('src/gas/apps_script.gs', 'utf8');
const view = fs.readFileSync('src/web/views/views_history.js', 'utf8');
// PC/mobile OAuth 401 and WTS IP-policy 403 are not interchangeable.
// The GAS egress probe is not proof of the actual Toss request IP.
assert.match(view,/토스 OAuth 401은 Client ID\/Secret/);
assert.match(view,/실제 Toss 요청 송신 IP를 확인한 뒤 필요한 범위만 허용하세요/);
assert.doesNotMatch(view,/Google IP range pool 허용 IP를 등록해야 합니다/);

assert.match(source, /TOSS_API_BASE\s*=\s*'https:\/\/openapi\.tossinvest\.com'/);
assert.match(source, /TOSS_CLIENT_ID/); assert.match(source, /TOSS_CLIENT_SECRET/);
assert.match(source, /grant_type:\s*'client_credentials'/);
assert.match(source, /Authorization:\s*'Bearer '\s*\+\s*token/);
assert.match(source, /\/api\/v1\/prices/); assert.match(source, /symbols\.join\(','\)/);
assert.match(source, /\/api\/v1\/candles/); assert.match(source, /interval:\s*'1d'/);
assert.match(source, /adjusted:\s*'false'/); assert.match(source, /nextBefore/);
assert.match(source, /Retry-After/); assert.match(source, /Math\.pow\(2, attempt\)/);
assert.match(source, /X-RateLimit-Reset/);
assert.match(source, /LockService\.getScriptLock/);
assert.match(source, /function _refreshTossAccessTokenAfter401_\(/);
assert.match(source, /status === 401 && !oauthRecoveryUsed/);
assert.match(source, /var prices = fetchPricesGoogleFinance\(items, dateStr, ss\)/);
assert.match(source, /var val = \(tossPrices\[code\]/);
assert.match(source, /diagnoseTossMarketData/);
assert.match(source, /function _tossDiagnosticSharedToken_\(/);
assert.match(source, /CACHED_TOKEN_REUSED/);
assert.match(source, /function handleDiagnoseTossMarketData\(forceFreshOAuth\)/);
assert.match(source, /\/api\/v1\/exchange-rate/);
assert.match(source, /\/api\/v1\/market-calendar\/KR/);
assert.match(source, /\/api\/v1\/market-calendar\/US/);
assert.match(source, /\/api\/v1\/market-indicators\/prices/);
assert.match(source, /\/api\/v1\/market-indicators\/KOSPI\/candles/);
assert.match(source, /IP_NOT_ALLOWED_OR_FORBIDDEN/);
assert.match(source, /function _tossDiagnosticRequest_\(/);
const diagnosticMatch = source.match(/function handleDiagnoseTossMarketData\(forceFreshOAuth\)\s*\{([\s\S]*?)\n\}/);
assert.ok(diagnosticMatch && !/(?:setValue|setValues|appendRow|clearContent|deleteSheet|insertSheet)\s*\(/.test(diagnosticMatch[1]));
assert.ok(!/Logger\.log\([^\n]*(?:access_token|client_secret|TOSS_CLIENT_SECRET)/i.test(source));
console.log('Toss GAS integration contract checks passed');


// Live operational probe contract: mock both the negative authentication
// request and the actual GAS diagnostic. No real OAuth or Sheets calls here.
const {runTossDiagnostic,summarizeTossDiagnostic,validateGasUrl} =
  await import('./diagnose-toss-operational.mjs');
assert.throws(()=>validateGasUrl('http://example.com/macros/s/fake/exec'),/TOSS_DIAG_INVALID_GAS_URL/);
const liveFixture={
  status:'ok',gasVersion:'9.228',ok:true,freshOAuthTested:true,
  oauth:{ok:true,source:'NETWORK',status:200,code:'OK',providerCode:''},
  priceSmoke:{ok:true,status:200,code:'OK',resultCount:1,validLastPrice:true,timestampPresent:true},
  endpoints:['exchangeRate','marketCalendarKR','marketCalendarUS','marketIndicatorPrices',
    'marketIndicatorCandles'].map(name=>({name,ok:true,status:200,code:'OK',count:1}))
};
const fakeGAS=async (_url,request)=>({
  ok:true,json:async()=>new URLSearchParams(request.body).get('accessToken')==='test-credential'
    ?liveFixture : {status:'error',message:'인증 실패'}
});
const operational=await runTossDiagnostic({
  url:'https://script.google.com/macros/s/safe/exec',
  token:'test-credential',expectedVersion:'9.228',fetchImpl:fakeGAS
});
assert.equal(operational.allHealthy,true);
assert.equal(operational.prices005930.ok,true);
assert.equal(operational.oauth.source,'NETWORK');
assert.equal(operational.freshOAuthConfirmed,true);
assert.equal(summarizeTossDiagnostic({
  ...liveFixture,oauth:{ok:false,source:'NETWORK',status:401,code:'OAUTH_FAILED',
    providerCode:'unidentified-client'},ok:false
},'9.228').allHealthy,false);
assert.equal(summarizeTossDiagnostic({
  ...liveFixture,ok:false,
  endpoints:liveFixture.endpoints.map((row,i)=>i===0?
    {...row,ok:false,status:403,code:'IP_NOT_ALLOWED_OR_FORBIDDEN'}:row)
},'9.228').allHealthy,false);
assert.throws(()=>summarizeTossDiagnostic({
  ...liveFixture,gasVersion:'9.226'
},'9.228'),/TOSS_DIAG_GAS_VERSION_OR_CONTRACT_MISMATCH/);
await assert.rejects(runTossDiagnostic({
  url:'https://script.google.com/macros/s/safe/exec',token:'test-credential',
  expectedVersion:'9.228',fetchImpl:async()=>({ok:true,json:async()=>liveFixture})
}),/TOSS_DIAG_GAS_AUTH_BYPASS/);
console.log('Toss operational diagnostic mocked authentication, OAuth and price smoke passed');



// Execute the actual GAS 403 classifier and HTTP probes in a restricted VM.
// Do not accept unrecognized provider text, messages or bearer tokens into diagnostics.
const productionFunction = name => {
  const start = source.indexOf('function '+name+'(');
  assert.ok(start>=0,'missing production function: '+name);
  const end=source.indexOf('\n}',start);
  assert.ok(end>start, 'missing function end: '+name);
  return source.slice(start,end+2);
};
const classifySource=productionFunction('_tossDiagnostic403ProviderCode_');
const requestSource=productionFunction('_tossDiagnosticRequest_');
const priceSource=productionFunction('_tossPriceSmoke_');
const context={
  TOSS_API_BASE:'https://openapi.tossinvest.com',
  _normalizeTossSymbol_:value=>String(value||''),
  _tossDiagnosticIdentifiers_:()=>({requestId:'safe-request-id',referenceId:'',edgeRequestId:''}),
  responsePayload:{error:{code:'ip-not-allowed'}},
  httpStatus:403
};
context.UrlFetchApp={fetch:()=>({
  getResponseCode:()=>context.httpStatus,
  getContentText:()=>JSON.stringify(context.responsePayload)
})};
vm.runInNewContext([classifySource,requestSource,priceSource].join('\n'),vm.createContext(context),{timeout:1000});
for(const candidate of ['ip-not-allowed','forbidden','edge-blocked']){
  context.responsePayload={error:{code:candidate}};
  const direct=context._tossDiagnostic403ProviderCode_(context.responsePayload,403);
  assert.equal(direct,candidate);
  const read=context._tossDiagnosticRequest_('/api/v1/exchange-rate',{},'safe-mock-token');
  const price=context._tossPriceSmoke_('safe-mock-token');
  assert.equal(read.code,'IP_NOT_ALLOWED_OR_FORBIDDEN');
  assert.equal(read.providerCode,candidate);
  assert.equal(price.providerCode,candidate);
  assert.equal(price.code,'IP_NOT_ALLOWED_OR_FORBIDDEN');
}
context.responsePayload={error:{code:'SECRET_ABC',message:'client_secret=never-expose'}};
assert.equal(context._tossDiagnosticRequest_('/api/v1/exchange-rate',{},'safe').providerCode,'UNKNOWN_403');
assert.equal(context._tossPriceSmoke_('safe').providerCode,'UNKNOWN_403');
assert.equal(context._tossDiagnostic403ProviderCode_(context.responsePayload,200),'');
context.responsePayload={error:{code:'ip-not-allowed'}};
context.httpStatus=200;
assert.equal(context._tossDiagnosticRequest_('/api/v1/exchange-rate',{},'safe').providerCode,'');
const syncView=fs.readFileSync('src/web/features/settings/settings_sync.js','utf8');
assert.match(syncView,/Toss코드 \$\{item\.providerCode\}/);
assert.match(syncView,/Toss코드 \$\{smoke\.providerCode\}/);
assert.match(syncView,/provider403Codes\.includes\('ip-not-allowed'\)/);
assert.doesNotMatch(syncView,/Google 공유 IP 대역 전체를 허용하세요/);
console.log('Toss 403 original provider-code classification and safe display passed');
