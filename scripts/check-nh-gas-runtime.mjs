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
function setup(){
  const props=new Map([['access_token','admin-token']]),cache=new Map(),calls=[];
  let locked=false,status=200,wrongIdentity=false;
  const response=(data,code=200)=>({getResponseCode:()=>code,getContentText:()=>JSON.stringify(data)});
  const header='@record 164\n'+[['sGIC',15],['rest',80],['sNationCode',3],['sSymbol',12],['tail',54]].map(([n,w])=>`('${n}', ${w}),`).join('\n');
  const row=Buffer.alloc(164,32);row.write('USAAAPL');row.write('USA',95);row.write('AAPL',98);row[163]=10;
  const ctx={Date:Clock,PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,deleteProperty:k=>props.delete(k),setProperties:o=>Object.entries(o).forEach(([k,v])=>props.set(k,v))})},CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)})},LockService:{getScriptLock:()=>({hasLock:()=>locked,tryLock:()=>{locked=true;return true;},releaseLock:()=>{locked=false;}})},Utilities:{sleep:()=>{},DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,v)=>createHash('sha256').update(v).digest(),base64EncodeWebSafe:v=>Buffer.from(v).toString('base64url'),formatDate:()=> '20261029'},jsonError:message=>({status:'error',message}),jsonOk:v=>({status:'ok',...v}),_isFundCode:code=>code.startsWith('F000'),_normalizeDate:s=>s,
    UrlFetchApp:{fetch:(url,options)=>{
      calls.push({url,options});assert.doesNotMatch(url,/tossinvest/);
      assert.equal(options.followRedirects,false);
      if(url.endsWith('.h'))return {getResponseCode:()=>200,getContentText:()=>header};
      if(url.endsWith('.mst'))return {getResponseCode:()=>200,getBlob:()=>({getBytes:()=>Array.from(row)})};
      if(url.includes('/oauth2/token'))return response({access_token:'nh-token',expires_in:3600});
      const code=JSON.parse(options.payload).Input_0.iem_cd;
      return response({Output_0:{iem_cd:wrongIdentity?'WRONG':code==='AAPL'?'USAAAPL':code,stck_prpr:'232000',trdprc:'349.6718',trade_date:'20261029'}},status);
    }}};
  vm.createContext(ctx);vm.runInContext(runtime+'\n'+['fetchPricesToss','_tossIssueAccessTokenUnlocked_','_tossDiagnosticIssueAccessTokenUnlocked_','_tossRequest_','_tossRelayRequest_','_tossDiagnosticRequest_','_tossPriceSmoke_','handleDiagnoseTossMarketData'].map(extract).join('\n'),ctx);
  return {ctx,props,cache,calls,setStatus:v=>{status=v;},wrongIdentity:()=>{wrongIdentity=true;}};
}
const s=setup();s.props.set('TOSS_CLIENT_ID','old-toss-id');s.props.set('TOSS_CLIENT_SECRET','old-toss-secret');
assert.equal(s.ctx.handleSaveNhConfig({accessToken:'bad',data:'{}'}).status,'error');assert.equal(s.calls.length,0);
assert.equal(s.ctx.handleSaveNhConfig({accessToken:'admin-token',data:JSON.stringify({key:'nh-key',secret:'nh-secret'})}).status,'ok');
assert.equal(s.props.get('MARKET_DATA_PROVIDER'),'NH');assert.equal(s.props.has('TOSS_CLIENT_ID'),false);assert.equal(s.props.has('TOSS_CLIENT_SECRET'),false);assert.equal(s.props.get('TOSS_RELAY_MODE'),'OFF');
assert.doesNotMatch(JSON.stringify(s.ctx._nhConfigStatus_()),/nh-key|nh-secret|nh-token/);
const meta={};
const result=s.ctx.fetchPricesToss([{code:'005930',currency:'KRW',type:'주식'},{code:'AAPL',currency:'USD',type:'주식'},{code:'F00001',currency:'KRW',type:'펀드'}],{},meta);
assert.equal(result['005930'].source,'NH');assert.equal(result.AAPL.price,349.6718);assert.equal(result.AAPL.marketDate,'2026-10-29');
assert.equal(result.AAPL.status,'INDICATIVE');assert.equal(result.AAPL.timestamp,null);assert.equal(result.F00001,undefined);
assert.equal(meta.provider,'NH');assert.equal(meta.status,'SUCCESS');
assert.equal(s.calls.filter(c=>c.url.includes('/oauth2/token')).length,1);
const before=s.calls.length;s.ctx.fetchPricesToss([{code:'005930',currency:'KRW',type:'주식'}],{},{});assert.equal(s.calls.length,before);
for(const name of ['_tossIssueAccessTokenUnlocked_','_tossDiagnosticIssueAccessTokenUnlocked_','_tossRequest_','_tossRelayRequest_','_tossDiagnosticRequest_','_tossPriceSmoke_'])assert.throws(()=>s.ctx[name](),/TOSS_RETIRED_NH_ACTIVE/);
assert.equal(s.ctx.handleDiagnoseTossMarketData().message,'TOSS_RETIRED_NH_ACTIVE');assert.equal(s.calls.length,before);
const failed=setup();failed.wrongIdentity();
assert.equal(failed.ctx.handleSaveNhConfig({accessToken:'admin-token',data:JSON.stringify({key:'nh-key',secret:'nh-secret'})}).status,'error');assert.equal(failed.props.has('MARKET_DATA_PROVIDER'),false);assert.equal(failed.props.has('NHPLUG_APP_KEY'),false);
s.cache.delete('nh_quote_KRW_005930');s.setStatus(401);
const failMeta={};assert.equal(Object.keys(s.ctx.fetchPricesToss([{code:'005930',currency:'KRW',type:'주식'}],{},failMeta)).length,0);assert.equal(failMeta.reason,'NH_HTTP_401');assert.equal(s.cache.has('nh_oauth_v1'),false);
assert.match(source,/params.action === 'saveNhConfig'\) return handleSaveNhConfig\(params\)/);
assert.match(source,/\|provider='/);
console.log('NH native GAS: activation, strict auth, KR/US quotes, master identity, cache, no Toss calls and 401 recovery passed');
const {activateNhRuntime}=await import('./activate-nh-gas-runtime.mjs');
const actions=[];
const liveMock=async(url,options)=>{
  const p=new URLSearchParams(options.body);actions.push(p.get('action'));
  let body;
  if(p.get('accessToken').endsWith('-DENY-PROBE'))body={status:'error'};
  else if(p.get('action')==='getSettings')body={status:'ok',gasVersion:'9.276',settings:{apiKeyStatus:{nh:{enabled:false}}}};
  else if(p.get('action')==='saveNhConfig')body={status:'ok',nh:{enabled:true}};
  else {assert.equal(p.get('persist'),'0');body={status:'ok',prices:{'005930':232000,AAPL:349.6718},priceLookup:{currentProvider:'NH',tossResultCount:2}};}
  return {ok:true,json:async()=>body};
};
const activation=await activateNhRuntime({url:'https://script.google.com/macros/s/TEST/exec',token:'admin',key:'nh-key',secret:'nh-secret',request:liveMock});
assert.equal(activation.status,'NH_ACTIVE_SAMPLE_READBACK_CONFIRMED');assert.equal(activation.fullCoverageVerified,false);
assert.deepEqual(actions,['getSettings','getSettings','saveNhConfig','getPrices']);
await assert.rejects(activateNhRuntime({url:'https://script.google.com/macros/s/TEST/exec',key:'key',secret:'secret'}),/GAS_AUTH_NOT_CONFIGURED/);
await assert.rejects(activateNhRuntime({url:'https://script.google.com/macros/s/TEST/exec',token:'admin',request:async()=>({ok:true,json:async()=>({status:'ok'})})}),/AUTH_NOT_ENFORCED/);
