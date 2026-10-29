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
  vm.createContext(ctx);vm.runInContext(runtime+'\n'+['fetchPricesToss'].map(extract).join('\n'),ctx);
  return {ctx,props,cache,calls,setStatus:v=>{status=v;},wrongIdentity:()=>{wrongIdentity=true;}};
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
assert.match(source,/params.action === 'saveNhConfig'\) return handleSaveNhConfig\(params\)/);
assert.match(source,/\|provider='/);
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
  else if(p.get('action')==='getSettings')body={status:'ok',gasVersion:'9.279',settings:{apiKeyStatus:{nh:{enabled:false}}}};
  else if(p.get('action')==='saveNhConfig')body={status:'ok',nh:{enabled:true}};
  else if(p.get('action')==='diagnoseNhMarketData')body={status:'ok',readOnly:true,quotesConnected:true,closes:{},closeSampleComplete:false};
  else if(p.get('action')==='retireLegacyMarketData')body={status:'ok',retired:true};
  else if(p.get('action')==='getCodeListReadOnly')body={status:'ok',readOnly:true,gasVersion:'9.279',codes:registered};
  else {assert.equal(p.get('persist'),'0');assert.equal(p.get('codes'),'005930,NVDA');body={status:'ok',prices:{'005930':232000,NVDA:349.6718},priceLookup:{currentProvider:'NH',tossResultCount:2}};}
  return {ok:true,json:async()=>body};
};
const reports=[];
const activation=await activateNhRuntime({url:'https://script.google.com/macros/s/TEST/exec',token:'admin',key:'nh-key',secret:'nh-secret',request:liveMock,report:row=>reports.push(row)});
assert.equal(activation.status,'NH_ACTIVE_SAMPLE_READBACK_CONFIRMED');assert.equal(activation.fullCoverageVerified,false);
assert.equal(activation.registeredUsTarget,true);
assert.deepEqual(reports[0],{status:'NH_RUNTIME_CODE_MASTER_COUNTS',rows:2,krwRows:1,usdRows:1});assert.equal(reports[1].status,'NH_REGULAR_CLOSE_SAMPLE_READBACK');
assert.doesNotMatch(JSON.stringify(reports),/005930|NVDA|nh-key|nh-secret/);
assert.deepEqual(actions,['getSettings','getSettings','saveNhConfig','retireLegacyMarketData','getCodeListReadOnly','getPrices','diagnoseNhMarketData']);
const fallback=await activateNhRuntime({url:'https://script.google.com/macros/s/TEST/exec',token:'admin',key:'nh-key',secret:'nh-secret',request:async(url,options)=>{
  const p=new URLSearchParams(options.body);
  if(p.get('action')==='getCodeListReadOnly')return {ok:true,json:async()=>({status:'ok',readOnly:true,gasVersion:'9.279',codes:[registered[0]]})};
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

// Execute the production close provider and its caller. Time/calendar boundaries
// use production helpers, not a duplicate implementation of session selection.
function closeSetup(instant='2026-10-30T07:00:00+09:00') {
  const calls=[],cache=new Map();let reply,fail=false;
  class CloseClock extends Date {constructor(...args){super(...(args.length?args:[instant]));}static now(){return Date.parse(instant);}}
  const ctx={Date:CloseClock,CONFIG:{TIMEZONE:'Asia/Seoul'},Logger:{log:()=>{}},_cleanCode:x=>String(x||''),_isFundCode:x=>String(x).startsWith('F000'),
    _nhCredentials_:()=>({key:'test-key',secret:'test-secret'}),CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})},
    Utilities:{sleep:()=>{},formatDate:(date,tz,fmt)=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));return fmt==='H'?String(Number(p.hour)):fmt==='HHmm'?p.hour+p.minute:p.year+'-'+p.month+'-'+p.day;}},
    _nhPost_:(path,input)=>{calls.push({path,input});if(fail)throw Error('NH_HTTP_429');return reply|| (path.includes('currentDaily')?{Output_0:[{bsop_date:'26/10/29',stck_clpr:'232000'}]}:{Output_0:[{iem_cd:'AAPL',trdprc:99999}],Output_1:[{trade_date:'20261029',bsop_date:'20261029',close_prc:'250.125'}]});},
    fetchPricesKrx:items=>Object.fromEntries(items.filter(x=>x.code==='005930').map(x=>[x.code,{price:231000,source:'KRX'}])),
    fetchPricesYahooRegularClose:(items,date)=>Object.fromEntries(items.map(x=>[x.code,{price:249,usedDate:date,marketDate:date,source:'YAHOO_REGULAR_CLOSE',status:'CONFIRMED',priceType:'REGULAR_CLOSE'}]))};
  vm.createContext(ctx);
  const constants=['FOREIGN_US_EQUITY_CLOSED_DATES_','KRX_CONFIRMED_CLOSED_DATES_2026','KRX_CONFIRMED_CLOSED_DATES_2027'].map(n=>source.match(new RegExp('var '+n+' = \\{[^]*?\\n\\};'))[0]).join('\n');
  vm.runInContext(constants+'\n'+['_foreignMarketTimeZone_','_foreignConfirmedExchangeHoliday_','_foreignMarketRegularCloseCutoff_','_krxCalendarStatus_','_isKrxDailyCloseTarget_','_normalizeDate','_isConfirmedHistoryPrice_','_nhCloseDate_','fetchNhRegularCloses','fetchPricesGoogleFinance'].map(extract).join('\n'),ctx);
  return {ctx,calls,reply:x=>{reply=x;},fail:()=>{fail=true;}};
}
const kr={code:'005930',currency:'KRW',market:'KRX'},us={code:'AAPL',currency:'USD',market:'NASDAQ'};
let c=closeSetup();
let closes=c.ctx.fetchPricesGoogleFinance([kr,us],'2026-10-30',null,{useMarketCloseCutoffs:true});
assert.equal(closes['005930'].price,232000);assert.equal(closes.AAPL.price,250.125);
assert.equal(closes['005930'].source,'NH_REGULAR_CLOSE');assert.equal(closes.AAPL.source,'NH_REGULAR_CLOSE');
assert.equal(closes['005930'].marketDate,'2026-10-29');assert.equal(closes.AAPL.marketDate,'2026-10-29');
assert.equal(closes.AAPL.currency,'USD');assert.equal(closes.AAPL.status,'CONFIRMED');
const usInput=c.calls.find(x=>x.path.endsWith('/period')).input;
assert.equal(usInput.market_cls,'1');assert.equal(usInput.gubun,'3');assert.equal(usInput.today_cls,'0');
assert.equal(usInput.end_dt,'20261029');
const beforeCache=c.calls.length;c.ctx.fetchNhRegularCloses([kr,us],'2026-10-30',{useMarketCloseCutoffs:true});assert.equal(c.calls.length,beforeCache);
for(const [raw,expected] of [['20261029','2026-10-29'],['26/10/29','2026-10-29'],['20260230',''],['26/02/30',''],['','']])assert.equal(c.ctx._nhCloseDate_(raw),expected);
for(const row of [[],[{trade_date:'20261028',close_prc:250}],[{trade_date:'20261029',bsop_date:'20261028',close_prc:250}],[{trade_date:'20261029',close_prc:0}],[{trade_date:'20261029',close_prc:'Infinity'}],[{trade_date:'20261029',close_prc:250},{trade_date:'20261029',close_prc:250}]]){
  c=closeSetup();c.reply({Output_0:[{iem_cd:'AAPL',trdprc:999}],Output_1:row});
  assert.equal(c.ctx.fetchPricesGoogleFinance([us],'2026-10-29',null).AAPL.source,'YAHOO_REGULAR_CLOSE');
}
c=closeSetup();c.reply({Output_0:[{iem_cd:'TSLA'}],Output_1:[{trade_date:'20261029',close_prc:250}]});assert.equal(c.ctx.fetchNhRegularCloses([us],'2026-10-29').AAPL,undefined);
c=closeSetup();c.fail();closes=c.ctx.fetchPricesGoogleFinance([kr,us],'2026-10-29',null);assert.equal(closes['005930'].source,'KRX');assert.equal(closes.AAPL.source,'YAHOO_REGULAR_CLOSE');assert.equal(c.calls.length,1);
// Intraday, weekends, holidays, DST and the New York publication buffer.
for(const [instant,date,target,expected] of [
 ['2026-10-30T05:30:00+09:00','2026-10-29',us,0],
 ['2026-10-30T07:00:00+09:00','2026-10-29',us,1],
 ['2026-11-03T06:30:00+09:00','2026-11-02',us,0],
 ['2026-11-03T07:30:00+09:00','2026-11-02',us,1],
 ['2026-11-27T08:00:00+09:00','2026-11-26',us,0],
 ['2026-10-31T17:00:00+09:00','2026-10-31',kr,0],
 ['2026-10-30T15:59:00+09:00','2026-10-30',kr,0],
 ['2026-10-30T16:00:00+09:00','2026-10-30',kr,1]
]){c=closeSetup(instant);c.ctx.fetchNhRegularCloses([target],date);assert.equal(c.calls.length,expected,instant);}
console.log('NH regular closes: KR/US actual provider and fallback, exact dates, daily close field, identity, cache, holidays, intraday and DST passed');

c=closeSetup();c.ctx._countBusinessWeekdaysBetween=()=>0;
vm.runInContext(['fetchDomesticRegularCloses','_assessDailyKrxStockClose','_verifyForeignDailyCloseCoverage_'].map(extract).join('\n'),c.ctx);
const daily=c.ctx.fetchDomesticRegularCloses([kr],'2026-10-29');
assert.equal(daily['005930'].source,'NH_REGULAR_CLOSE');
assert.equal(c.ctx._assessDailyKrxStockClose([kr],daily,'2026-10-29').confirmed,1);
assert.equal(c.ctx._verifyForeignDailyCloseCoverage_([us],c.ctx.fetchNhRegularCloses([us],'2026-10-29'),new Date('2026-10-30T07:00:00+09:00')),1);
assert.throws(()=>c.ctx._assessDailyKrxStockClose([kr],{'005930':{price:100,source:'NH',usedDate:'2026-10-29'}},'2026-10-29'));
assert.throws(()=>c.ctx._verifyForeignDailyCloseCoverage_([us],{AAPL:{price:100,source:'NH',usedDate:'2026-10-29'}},new Date('2026-10-30T07:00:00+09:00')));
console.log('Daily close production admission accepts NH confirmed bars and rejects NH indicative quotes');
