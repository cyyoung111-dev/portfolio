import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const source=fs.readFileSync('src/gas/apps_script.gs','utf8');
const runtime=source.slice(source.indexOf('// NH native GAS price provider'));
assert.ok(runtime.includes('function fetchPricesNh('));
const extract=name=>{const match=source.match(new RegExp('function '+name+'\\([^]*?\\n\\}'));assert.ok(match,name);return match[0];};
const time=Date.parse('2026-10-29T14:30:00Z');
class Clock extends Date {constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}}
function setup({expiresIn=3600}={}){
  let nowMs=time;
  class TestClock extends Date {constructor(...args){super(...(args.length?args:[nowMs]));}static now(){return nowMs;}}
  const props=new Map([['access_token','admin-token']]),cache=new Map(),calls=[];
  let locked=false,status=200,wrongIdentity=false;
  const response=(data,code=200)=>({getResponseCode:()=>code,getContentText:()=>JSON.stringify(data)});
  const header='@record 164\n'+[['sGIC',15],['rest',80],['sNationCode',3],['sSymbol',12],['tail',54]].map(([n,w])=>`('${n}', ${w}),`).join('\n');
  const row=Buffer.alloc(164,32);row.write('USAAAPL');row.write('USA',95);row.write('AAPL',98);row[163]=10;
  const ctx={Date:TestClock,PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,deleteProperty:k=>props.delete(k),setProperties:o=>Object.entries(o).forEach(([k,v])=>props.set(k,v)),setProperty:(k,v)=>props.set(k,v)})},CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)})},LockService:{getScriptLock:()=>({hasLock:()=>locked,tryLock:()=>{locked=true;return true;},releaseLock:()=>{locked=false;}})},Utilities:{sleep:()=>{},DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,v)=>createHash('sha256').update(v).digest(),base64EncodeWebSafe:v=>Buffer.from(v).toString('base64url'),formatDate:()=> '20261029'},jsonError:message=>({status:'error',message}),jsonOk:v=>({status:'ok',...v}),_isFundCode:code=>code.startsWith('F000'),_normalizeDate:s=>s,
    UrlFetchApp:{fetch:(url,options)=>{
      calls.push({url,options});assert.doesNotMatch(url,/tossinvest/);
      assert.equal(options.followRedirects,false);
      if(url.endsWith('.h'))return {getResponseCode:()=>200,getContentText:()=>header};
      if(url.endsWith('.mst'))return {getResponseCode:()=>200,getBlob:()=>({getBytes:()=>Array.from(row)})};
      if(url.includes('/oauth2/token'))return response({access_token:'nh-token',expires_in:expiresIn});
      const code=JSON.parse(options.payload).Input_0.iem_cd;
      return response({Output_0:{iem_cd:wrongIdentity?'WRONG':code==='AAPL'?'USAAAPL':code,stck_prpr:'232000',trdprc:'349.6718',trade_date:'20261029'}},status);
    }}};
  vm.createContext(ctx);vm.runInContext(runtime+'\n'+['fetchPricesToss'].map(extract).join('\n'),ctx);
  return {ctx,props,cache,calls,advance:ms=>{nowMs+=ms;},setStatus:v=>{status=v;},wrongIdentity:()=>{wrongIdentity=true;}};
}
const s=setup();s.props.set('TOSS_CLIENT_ID','old-toss-id');s.props.set('TOSS_CLIENT_SECRET','old-toss-secret');
assert.equal(s.ctx._nhUsCandidate_({code:'0046Y0',currency:'KRW'}),false);
assert.equal(s.ctx._nhUsCandidate_({code:'ABCDEF',currency:'KRW'}),false);
assert.equal(s.ctx._nhUsCandidate_({code:'ABCDEF',currency:'KRW',nhMetadataMissing:true}),true);
assert.equal(s.ctx._nhUsCandidate_({code:'AAPL',currency:'KRW',market:'KRX'}),false);
assert.equal(s.ctx._nhUsCandidate_({code:'AAPL',currency:'KRW'}),true);
assert.equal(s.ctx.handleSaveNhConfig({accessToken:'bad',data:'{}'}).status,'error');assert.equal(s.calls.length,0);
assert.equal(s.ctx.handleSaveNhConfig({accessToken:'admin-token',data:JSON.stringify({key:'nh-key',secret:'nh-secret'})}).status,'ok');
assert.equal(s.props.get('MARKET_DATA_PROVIDER'),'NH');assert.equal(s.props.has('TOSS_CLIENT_ID'),false);assert.equal(s.props.has('TOSS_CLIENT_SECRET'),false);
const issuedAfterActivation=s.calls.filter(c=>c.url.includes('/oauth2/token')).length;
assert.equal(s.ctx.handleSaveNhConfig({accessToken:'admin-token',data:JSON.stringify({key:'nh-key',secret:'nh-secret'})}).status,'ok');
assert.equal(s.calls.filter(c=>c.url.includes('/oauth2/token')).length,issuedAfterActivation,
 'saving unchanged active NH credentials must not request another token');
const orphan=setup();
assert.equal(orphan.ctx.handleSaveNhConfig({accessToken:'admin-token',data:JSON.stringify({key:'nh-key',secret:'nh-secret'})}).status,'ok');
const orphanPrice=orphan.ctx.fetchPricesToss([{code:'AAPL',currency:'KRW',nhMetadataMissing:true}],{},{});
assert.equal(orphanPrice.AAPL.currency,'USD');assert.equal(orphanPrice.AAPL.price,349.6718);assert.equal(orphanPrice.AAPL.status,'INDICATIVE');
assert.ok(orphan.calls.some(c=>c.url.endsWith('/gbstock/quote/v1/current')));
assert.doesNotMatch(JSON.stringify(s.ctx._nhConfigStatus_()),/nh-key|nh-secret|nh-token/);
const meta={};
const result=s.ctx.fetchPricesToss([{code:'005930',currency:'KRW',type:'주식'},{code:'AAPL',currency:'USD',type:'주식'},{code:'F00001',currency:'KRW',type:'펀드'}],{},meta);
assert.equal(result['005930'].source,'NH');assert.equal(result.AAPL.price,349.6718);assert.equal(result.AAPL.marketDate,'2026-10-29');assert.equal(result.AAPL.usedDate,'2026-10-29');
assert.equal(result.AAPL.status,'INDICATIVE');assert.equal(result.AAPL.timestamp,null);assert.equal(result.F00001,undefined);
assert.equal(meta.provider,'NH');assert.equal(meta.status,'SUCCESS');
const mixed=s.ctx.fetchPricesToss([{code:'005930',currency:'KRW',type:'주식'},{code:'AAPL',currency:'USD',type:'주식'},{code:'MISSING',currency:'USD',type:'주식'}],{},{});
assert.equal(mixed['005930'].source,'NH');assert.equal(mixed.AAPL.source,'NH');assert.equal(mixed.MISSING,undefined);
assert.equal(s.calls.some(c=>c.options.payload?.includes('MISSING')),false);
const outage=setup();outage.props.set('NHPLUG_APP_KEY','key');outage.props.set('NHPLUG_APP_SECRET','secret');outage.props.set('MARKET_DATA_PROVIDER','NH');
outage.ctx._nhUsMaster_=()=>{throw Error('NH_MASTER_HTTP_ERROR');};
const isolated=outage.ctx.fetchPricesToss([{code:'005930',currency:'KRW',type:'주식'},{code:'AAPL',currency:'USD',type:'주식'}],{},{});
assert.equal(isolated['005930'].source,'NH');assert.equal(isolated.AAPL,undefined);
assert.equal(s.calls.filter(c=>c.url.includes('/oauth2/token')).length,1);
const before=s.calls.length;s.ctx.fetchPricesToss([{code:'005930',currency:'KRW',type:'주식'}],{},{});assert.equal(s.calls.length,before);
assert.equal(s.ctx._tossRequest_,undefined);assert.doesNotMatch(source,/openapi\.tossinvest\.com/);
const failed=setup();failed.wrongIdentity();
assert.equal(failed.ctx.handleSaveNhConfig({accessToken:'admin-token',data:JSON.stringify({key:'nh-key',secret:'nh-secret'})}).status,'error');assert.equal(failed.props.has('MARKET_DATA_PROVIDER'),false);assert.equal(failed.props.has('NHPLUG_APP_KEY'),false);
s.cache.delete('nh_quote_KRW_005930');s.setStatus(401);
const failMeta={};assert.equal(Object.keys(s.ctx.fetchPricesToss([{code:'005930',currency:'KRW',type:'주식'}],{},failMeta)).length,0);assert.equal(failMeta.reason,'NH_HTTP_401');assert.equal(s.cache.has('nh_oauth_v1'),false);
assert.equal(s.props.has('NHPLUG_AUTH_RECORD_V1'),false,'401 must invalidate persistent bearer too');
assert.match(source,/params.action === 'saveNhConfig'\) return handleSaveNhConfig\(params\)/);
assert.match(source,/\|provider='/);

{
  // CacheService expires after <=6h, but ScriptProperties persists only the
  // current credential-scoped token until its server-provided expiry.
  const reuse=setup({expiresIn:86400});
  const keys={key:'nh-key',secret:'nh-secret'};
  assert.equal(reuse.ctx._nhAccessToken_(keys),'nh-token');
  const count=()=>reuse.calls.filter(c=>c.url.includes('/oauth2/token')).length;
  assert.equal(count(),1);
  const persisted=JSON.parse(reuse.props.get('NHPLUG_AUTH_RECORD_V1'));
  assert.equal(persisted.token,'nh-token');
  assert.ok(persisted.scope.length>12);
  assert.ok(!JSON.stringify(persisted).includes('nh-secret'));
  assert.ok(!JSON.stringify(persisted).includes('nh-key'));
  reuse.cache.clear(); // simulate GAS cache eviction / a cold execution.
  reuse.advance(7*3600*1000);
  assert.equal(reuse.ctx._nhAccessToken_(keys),'nh-token');
  assert.equal(count(),1,'7h after issuance must NOT reissue token');
  reuse.cache.clear();
  reuse.advance(16*3600*1000+58*60000); // 23h58m elapsed.
  assert.equal(reuse.ctx._nhAccessToken_(keys),'nh-token');
  assert.equal(count(),1,'still valid 23h58m after issuance');
  reuse.cache.clear();
  reuse.advance(120000); // expiry threshold reached
  assert.equal(reuse.ctx._nhAccessToken_(keys),'nh-token');
  assert.equal(count(),2,'near expiry must renew once');
  reuse.cache.clear();
  assert.equal(reuse.ctx._nhAccessToken_({key:'new-key',secret:'nh-secret'}),'nh-token');
  assert.equal(count(),3,'changing credentials must never reuse previous credential token');
}
{
  const throttle=setup({expiresIn:86400});
  throttle.props.set('NHPLUG_APP_KEY','nh-key');
  throttle.props.set('NHPLUG_APP_SECRET','nh-secret');
  throttle.props.set('MARKET_DATA_PROVIDER','NH');
  const count=()=>throttle.calls.filter(c=>c.url.includes('/oauth2/token')).length;
  throttle.setStatus(429);
  throttle.ctx.fetchPricesToss([{code:'005930',currency:'KRW'}],{},{});
  assert.equal(count(),1);
  assert.equal(throttle.props.has('NHPLUG_AUTH_RECORD_V1'),true,'429 must preserve bearer');
  throttle.cache.clear();
  throttle.setStatus(200);
  throttle.ctx.fetchPricesToss([{code:'005930',currency:'KRW'}],{},{});
  assert.equal(count(),1,'429 recovery must reuse the existing bearer');
  throttle.cache.delete('nh_quote_KRW_005930');
  throttle.setStatus(401);
  throttle.ctx.fetchPricesToss([{code:'005930',currency:'KRW'}],{},{});
  assert.equal(throttle.props.has('NHPLUG_AUTH_RECORD_V1'),false,'401 invalidates bearer');
  throttle.setStatus(200);
  throttle.ctx.fetchPricesToss([{code:'005930',currency:'KRW'}],{},{});
  assert.equal(count(),2,'the next request after 401 renews once');
}


{
  // Central GAS route: never exposes OAuth bearer, verifies 06:00 actual NH
  // reference and caches validated data across retry runs.
  const p=setup({expiresIn:86400});
  p.advance(Date.parse('2026-10-30T07:35:00+09:00')-time);
  p.props.set('access_token','admin-token');
  p.props.set('NHPLUG_APP_KEY','nh-key');
  p.props.set('NHPLUG_APP_SECRET','nh-secret');
  p.props.set('MARKET_DATA_PROVIDER','NH');
  const clockFormat=(date,zone,fmt)=>{
    const o=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
      timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',hourCycle:'h23'
    }).formatToParts(date).map(x=>[x.type,x.value]));
    if(fmt==='yyyy-MM-dd')return o.year+'-'+o.month+'-'+o.day;
    if(fmt==='HH')return o.hour;
    if(fmt==='mm')return o.minute;
    return o.year+o.month+o.day;
  };
  p.ctx.Utilities.formatDate=clockFormat;
  p.ctx.Utilities.newBlob=bytes=>({getDataAsString:charset=>
    new TextDecoder('euc-kr',{fatal:true}).decode(Uint8Array.from(bytes.map(x=>x&255)))});
  const record=(code,nameBytes)=>{
    const bytes=Buffer.alloc(30,0x20);
    bytes.write(code,'ascii');
    for(let i=0;i<nameBytes.length;i++)bytes[9+i]=nameBytes[i];
    bytes[29]=10;
    return bytes;
  };
  const cp=[188,177,185,176,50,54,49,50,191,249,107,112];
  const fixture=Buffer.concat([
    record('K10111111',[75,79,83,80,73,50,48,48]),
    record('KA016C000',cp)
  ]);
  let masterCalls=0,nightCalls=0,authCalls=0;
  const orig=p.ctx.UrlFetchApp.fetch;
  p.ctx.UrlFetchApp.fetch=(url,options)=>{
    if(url.endsWith('/m_future.h')){masterCalls++;return {getResponseCode:()=>200,
      getContentText:()=>'@record 30 char sCode[9]; char sName[20]; char dummy[1];'};}
    if(url.endsWith('/m_future.mst'))return {getResponseCode:()=>200,
      getBlob:()=>({getBytes:()=>Array.from(fixture)})};
    if(url.includes('/oauth2/token'))authCalls++;
    if(url.endsWith('/krfuture/quote/v1/nightPeriod')){
      nightCalls++;
      assert.equal(options.method,'post');
      assert.equal(JSON.parse(options.payload).Input_0.iem_cd,'KA016C000');
      return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({
        Output_0:{iem_cd:'KA016C000',end_time_n:'060000'},
        Output_1:[
          {work_bsop_date:'20261030',bsop_time:'055959',prpr:'350.25'},
          {work_bsop_date:'20261030',bsop_time:'060000',prpr:'351.50'}
        ]
      })};
    }
    return orig(url,options);
  };
  assert.match(source,/params.action === 'getNhNightProxy'/);
  assert.equal(p.ctx.handleGetNhNightProxy({date:'2026-10-30',accessToken:'wrong'}).status,'error');
  assert.equal(nightCalls,0);
  const response=p.ctx.handleGetNhNightProxy({date:'2026-10-30',accessToken:'admin-token'});
  assert.equal(response.status,'ok');
  assert.equal(response.provider,'NH');
  assert.equal(response.reference.value,351.5);
  assert.equal(response.reference.tradingDate,'2026-10-30');
  assert.equal(response.reference.sourceUpdatedAt,'2026-10-30T06:00:00+09:00');
  assert.equal(response.bearerExposed,false);
  assert.equal(authCalls,1);
  assert.equal(nightCalls,1);
  assert.equal(masterCalls,1);
  assert.doesNotMatch(JSON.stringify(response),/nh-key|nh-secret|nh-token|Bearer|accessToken/);
  const second=p.ctx.handleGetNhNightProxy({date:'2026-10-30',accessToken:'admin-token'});
  assert.equal(second.status,'ok');
  assert.equal(nightCalls,1);
  assert.equal(authCalls,1);
  const health=p.ctx.handleGetNhAuthStatusProxy({accessToken:'admin-token'});
  assert.equal(health.status,'ok');
  assert.equal(health.tokenCached,true);
  assert.equal(health.tokenIssued,false);
  assert.equal(authCalls,1);
  // 10:50 KST readback must query an actual dated NH 06:00 record using the
  // already persisted OAuth bearer, never minting a second token.
  p.advance(Date.parse('2026-10-30T10:50:00+09:00')-Date.parse('2026-10-30T07:35:00+09:00'));
  p.cache.clear();
  const probe=p.ctx.handleGetNhNightProbe({date:'2026-10-30',accessToken:'admin-token'});
  assert.equal(probe.status,'ok');
  assert.equal(probe.diagnosticOnly,true);
  assert.equal(probe.tokenIssued,false);
  assert.equal(probe.reference.value,351.5);
  assert.equal(probe.reference.sourceUpdatedAt,'2026-10-30T06:00:00+09:00');
  assert.equal(authCalls,1,'daytime diagnostic cannot reissue the NH bearer');
  assert.equal(nightCalls,2,'daytime diagnostic must actually read NH nightPeriod');
  assert.doesNotMatch(JSON.stringify(probe),/nh-key|nh-secret|nh-token|Bearer|accessToken/);
  p.cache.clear();
  p.props.delete('NHPLUG_AUTH_RECORD_V1');
  const blocked=p.ctx.handleGetNhNightProbe({date:'2026-10-30',accessToken:'admin-token'});
  assert.equal(blocked.status,'error');
  assert.equal(blocked.message,'NH_PROXY_TOKEN_NOT_CACHED');
  assert.equal(authCalls,1,'no cached token must fail before NH OAuth request');
  assert.equal(nightCalls,2);
  assert.equal(p.ctx.handleGetNhNightProxy({date:'2026-10-29',accessToken:'admin-token'}).status,'error');
  assert.equal(nightCalls,2);
  const noAuth=setup({expiresIn:86400});
  noAuth.props.set('MARKET_DATA_PROVIDER','NH');
  noAuth.props.set('NHPLUG_APP_KEY','nh-key');
  noAuth.props.set('NHPLUG_APP_SECRET','nh-secret');
  assert.equal(noAuth.ctx.handleGetNhNightProxy({date:'2026-10-30',accessToken:''}).status,'error',
    'missing optional legacy access_token must NOT make the NH proxy public');
  assert.equal(noAuth.calls.length,0);
}


{
  const b=setup({expiresIn:86400});
  b.advance(Date.parse('2026-10-30T11:16:00+09:00')-time);
  b.ctx.Utilities.formatDate=(at,zone,fmt)=>{
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
      timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',hourCycle:'h23'
    }).formatToParts(at).map(x=>[x.type,x.value]));
    return fmt==='yyyy-MM-dd'?p.year+'-'+p.month+'-'+p.day
      :fmt==='HH'?p.hour:fmt==='mm'?p.minute:'';
  };
  b.props.set('NHPLUG_APP_KEY','nh-key');
  b.props.set('NHPLUG_APP_SECRET','nh-secret');
  b.props.set('MARKET_DATA_PROVIDER','NH');
  const a={date:'2026-10-30',accessToken:'admin-token'};
  assert.equal(b.ctx.handleBootstrapNhTokenOnce20261030({...a,accessToken:'invalid'}).status,'error');
  const first=b.ctx.handleBootstrapNhTokenOnce20261030(a);
  assert.equal(first.status,'ok');
  assert.equal(first.tokenIssued,true);
  assert.equal(b.props.get('NH_PROXY_20261030_OAUTH_ATTEMPT'),'1');
  const again=b.ctx.handleBootstrapNhTokenOnce20261030(a);
  assert.equal(again.status,'ok');
  assert.equal(again.tokenIssued,false);
  b.props.delete('NHPLUG_AUTH_RECORD_V1');
  b.cache.clear();
  assert.equal(b.ctx.handleBootstrapNhTokenOnce20261030(a).message,'NH_PROXY_BOOTSTRAP_ALREADY_ATTEMPTED');
  assert.equal(b.calls.filter(x=>x.url.includes('/oauth2/token')).length,1);
}

console.log('NH native GAS: activation, strict auth, KR/US quotes, master identity, cache, no Toss calls and 401 recovery passed');
const {activateNhRuntime,selectNhReadbackCodes}=await import('./activate-nh-gas-runtime.mjs');
const registered=[{code:'005930',currency:'KRW',type:'주식',market:'KRX'},{code:'NVDA',currency:'USD',type:'주식',market:'NASDAQ'}];
assert.deepEqual(selectNhReadbackCodes(registered),['005930','NVDA']);
assert.deepEqual(selectNhReadbackCodes([{...registered[0],type:'국내주식'},{...registered[1],type:'해외주식',market:'미국'}]),['005930','NVDA']);
assert.deepEqual(selectNhReadbackCodes([{code:'F00001',type:'펀드',currency:'KRW'},...registered]),['005930','NVDA']);
assert.throws(()=>selectNhReadbackCodes([...registered,registered[0]]),/DUPLICATE/);
assert.deepEqual(selectNhReadbackCodes([registered[0]]),['005930','AAPL']);
assert.deepEqual(selectNhReadbackCodes([]),['005930','AAPL']);
const actions=[];
const liveMock=async(url,options)=>{
  const p=new URLSearchParams(options.body);actions.push(p.get('action'));
  let body;
  if(p.get('accessToken').endsWith('-DENY-PROBE'))body={status:'error'};
  else if(p.get('action')==='getSettings')body={status:'ok',gasVersion:'9.278',settings:{apiKeyStatus:{nh:{enabled:false}}}};
  else if(p.get('action')==='saveNhConfig')body={status:'ok',nh:{enabled:true}};
  else if(p.get('action')==='retireLegacyMarketData')body={status:'ok',retired:true};
  else if(p.get('action')==='getCodeListReadOnly')body={status:'ok',readOnly:true,gasVersion:'9.278',codes:registered};
  else {assert.equal(p.get('persist'),'0');assert.equal(p.get('codes'),'005930,NVDA');body={status:'ok',prices:{'005930':232000,NVDA:349.6718},priceLookup:{currentProvider:'NH',tossResultCount:2}};}
  return {ok:true,json:async()=>body};
};
const reports=[];
const activation=await activateNhRuntime({url:'https://script.google.com/macros/s/TEST/exec',token:'admin',key:'nh-key',secret:'nh-secret',request:liveMock,report:row=>reports.push(row)});
assert.equal(activation.status,'NH_ACTIVE_SAMPLE_READBACK_CONFIRMED');assert.equal(activation.fullCoverageVerified,false);
assert.equal(activation.registeredUsTarget,true);
assert.deepEqual(reports,[{status:'NH_RUNTIME_CODE_MASTER_COUNTS',rows:2,krwRows:1,usdRows:1}]);
assert.doesNotMatch(JSON.stringify(reports),/005930|NVDA|nh-key|nh-secret/);
assert.deepEqual(actions,['getSettings','getSettings','saveNhConfig','retireLegacyMarketData','getCodeListReadOnly','getPrices']);
const autoCalls=[];
const skipReadback=await activateNhRuntime({url:'https://script.google.com/macros/s/TEST/exec',
  token:'admin',skipReadbackIfActive:true,request:async(_url,options)=>{
    const params=new URLSearchParams(options.body),action=params.get('action');
    autoCalls.push(action);
    if(params.get('accessToken').endsWith('-DENY-PROBE'))return {ok:true,json:async()=>({status:'error'})};
    if(action==='getSettings')return {ok:true,json:async()=>({
      status:'ok',gasVersion:'9.278',settings:{apiKeyStatus:{nh:{enabled:true}}}})};
    if(action==='retireLegacyMarketData')return {ok:true,json:async()=>({status:'ok',retired:true})};
    throw Error('AUTO_DEPLOY_MUST_NOT_CALL_NH_QUOTES_OR_CODE_MASTER');
  }});
assert.equal(skipReadback.status,'NH_ALREADY_ACTIVE_NO_TOKEN_REQUEST');
assert.equal(skipReadback.sampleCount,0);
assert.equal(skipReadback.sampleVerificationSkipped,true);
assert.deepEqual(autoCalls,['getSettings','getSettings','retireLegacyMarketData']);
assert.match(fs.readFileSync('.github/workflows/gas-deploy.yml','utf8'),
  /NH_RUNTIME_SKIP_READBACK_IF_ACTIVE:.*github\.event_name == 'workflow_run'/);
const fallback=await activateNhRuntime({url:'https://script.google.com/macros/s/TEST/exec',token:'admin',key:'nh-key',secret:'nh-secret',request:async(url,options)=>{
  const p=new URLSearchParams(options.body);
  if(p.get('action')==='getCodeListReadOnly')return {ok:true,json:async()=>({status:'ok',readOnly:true,gasVersion:'9.278',codes:[registered[0]]})};
  if(p.get('action')==='getPrices'){assert.equal(p.get('codes'),'005930,AAPL');assert.equal(p.get('persist'),'0');return {ok:true,json:async()=>({status:'ok',prices:{'005930':232000,AAPL:349.6718},priceLookup:{currentProvider:'NH',tossResultCount:2}})};}
  return liveMock(url,options);
}});
assert.equal(fallback.registeredUsTarget,false);assert.equal(fallback.fullCoverageVerified,false);
await assert.rejects(activateNhRuntime({url:'https://script.google.com/macros/s/TEST/exec',key:'key',secret:'secret'}),/GAS_AUTH_NOT_CONFIGURED/);
await assert.rejects(activateNhRuntime({url:'https://script.google.com/macros/s/TEST/exec',token:'admin',request:async()=>({ok:true,json:async()=>({status:'ok'})})}),/AUTH_NOT_ENFORCED/);
const workflow=fs.readFileSync('.github/workflows/gas-deploy.yml','utf8');
assert.ok(workflow.indexOf('run: node scripts/deploy-gas.mjs')<workflow.indexOf('run: node scripts/activate-nh-gas-runtime.mjs'));
assert.match(workflow,/name: Activate NH current prices after real GAS deployment\n\s+if: env.GAS_DEPLOY_DRY_RUN != 'true'/);

// Reproduce the reviewed valuation defect using the actual fetch normalization
// and actual production computeRows, with independent KRW expectations.
const web=fs.readFileSync('src/web/features/settings/settings_fetch.js','utf8');
const valuation=fs.readFileSync('src/web/domain/portfolio/portfolio_service.js','utf8');
const normalizer=web.match(/function _normalizeFetchedPriceCurrency\([^]*?\n\}/)[0];
const holdingsCtx={normName:x=>x,getEP:()=>({code:'AAPL',currency:'KRW'}),normalizeStockCode:x=>x,STOCK_CODE:{},exchangeRates:{USD:1400},savedPrices:{},fundDirect:{},getEPType:()=> '주식'};
vm.createContext(holdingsCtx);vm.runInContext(normalizer+'\n'+valuation.slice(valuation.indexOf('function computeRows(')),holdingsCtx);
const normalized=holdingsCtx._normalizeFetchedPriceCurrency(350,'USD','KRW',{USD:1400});
assert.equal(normalized,490000);holdingsCtx.savedPrices.AAPL=normalized;
const row=holdingsCtx.computeRows([{name:'Apple',qty:1,cost:400000}])[0];
assert.equal(row.evalAmt,490000);assert.equal(row.pnl,90000);
assert.equal(holdingsCtx._normalizeFetchedPriceCurrency(349.6718,'USD','USD',{}),349.6718);
assert.equal(holdingsCtx._normalizeFetchedPriceCurrency(350,'USD','KRW',{}),null);
assert.equal(holdingsCtx._normalizeFetchedPriceCurrency(232000,'KRW','KRW',{}),232000);
assert.match(source,/priceCurrencies: priceCurrencies/);
assert.match(web,/data\.priceCurrencies\?\.\[i\.code\]/);
console.log('NH quote currency to actual portfolio valuation: USD350 × 1400 = KRW490000, missing FX rejected');

s.props.set('TOSS_CLIENT_ID','retired-id');s.props.set('TOSS_RELAY_MODE','OFF');
assert.equal(s.ctx.handleRetireLegacyMarketData({accessToken:'bad'}).status,'error');assert.equal(s.props.has('TOSS_CLIENT_ID'),true);
const retired=s.ctx.handleRetireLegacyMarketData({accessToken:'admin-token'});
assert.equal(retired.retired,true);assert.equal(retired.financialDataWrites,0);assert.equal(s.props.has('TOSS_CLIENT_ID'),false);assert.equal(s.props.has('TOSS_RELAY_MODE'),false);assert.equal(s.props.get('NHPLUG_APP_KEY'),'nh-key');

const missingCredentials=setup(),missingMeta={};
assert.equal(Object.keys(missingCredentials.ctx.fetchPricesToss([{code:'005930',currency:'KRW'}],{},missingMeta)).length,0);
assert.equal(missingMeta.provider,'NH');assert.equal(missingCredentials.calls.length,0);
assert.equal(activation.legacyProviderRemoved,true);
