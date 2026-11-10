// Independent live source probe. No Telegram, no GAS write actions, no account
// data, no quotes/amounts, no URLs/tokens/error bodies in stdout.
import {validateGasEndpoint,classifyGasHtml} from './nh-gas-proxy.mjs';
import {previousOpenKrxDay} from './compare-briefing-krx-prior-readonly.mjs';
import {krxSessionStatus} from './krx-session-calendar.mjs';
import {readNhMorningIndexes} from './nh-morning-index-source.mjs';
import {readNhClosingStocks,readKrxOfficialClosingStocks} from './closing-extra-daily-sources.mjs';
import {readClosingVkospi} from './closing-vkospi-reference.mjs';
import {readClosingKrxTurnoverFromGas} from './closing-krx-turnover.mjs';
import {readTreasuryCurve,verifyTreasuryCurve} from './closing-us-treasury-curve.mjs';
import {readInvestorTrends,verifyInvestorTrendMarket} from './briefing-krx-investor-trends.mjs';
import {readKofiaLiquidity} from './briefing-kofia-liquidity.mjs';
import {readFearGreed} from './briefing-fear-greed.mjs';
import {readMorningBreadth} from './telegram-morning-breadth.mjs';
import {fetchDomesticCloseIndexes,verifiedDomesticCloseRows} from './telegram-close-workflow.mjs';

const kst=instant=>{
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(instant).map(x=>[x.type,x.value]));
 return {date:p.year+'-'+p.month+'-'+p.day,time:p.hour+':'+p.minute,
  minute:Number(p.hour)*60+Number(p.minute)};
};
const start=new Date(),current=kst(start),date=current.date,
 prior=previousOpenKrxDay(date),summary=[];
const allowGAS=new Set(['getBenchmarks','getPriceHistory','getBenchmark',
 'getKrxMarketTurnover','getKrxOfficialStockCloses','getKrxDailyIndexes']);
const safeHost=host=>host==='script.google.com'?'GAS_WEB_APP'
 :host==='script.googleusercontent.com'?'GOOGLE_CONTENT'
 :host==='stock.naver.com'?'NAVER_STOCK'
 :host==='freesis.kofia.or.kr'?'KOFIA_FREESIS'
 :host==='fred.stlouisfed.org'?'FRED'
 :host==='query1.finance.yahoo.com'||host==='query2.finance.yahoo.com'?'YAHOO'
 :host==='data-dbg.krx.co.kr'?'KRX_OPENAPI'
 :host==='production.dataviz.cnn.io'?'CNN':'OTHER';
const safeStatus=status=>Number.isInteger(status)&&status>=100&&status<=599?status:0;
const safeType=value=>{
 const mime=String(value||'').split(';')[0].toLowerCase().trim();
 return mime.includes('json')?'JSON':mime.includes('html')?'HTML'
  :mime.includes('csv')?'CSV':mime==='text/plain'?'PLAIN':'OTHER';
};
function emit(kind,fields){console.log(JSON.stringify({kind,...fields}));}
async function monitoredFetch(url,options={}){
 const parsed=new URL(url),family=safeHost(parsed.hostname);
 const label=family==='GAS_WEB_APP'
  ?String(new URLSearchParams(options.body||'').get('action')||'')
  :family==='NAVER_STOCK'?String(parsed.searchParams.get('marketType')||'')
  :family==='YAHOO'?String(parsed.pathname.split('/').at(-1)||'')
  :family==='KOFIA_FREESIS'?'STATISTICS'
  :family==='FRED'?String(parsed.searchParams.get('id')||'')
  :family;
 const source=family==='GAS_WEB_APP'
  ?allowGAS.has(label)?label:'UNEXPECTED_GAS_ACTION'
  :family==='NAVER_STOCK'&&['KOSPI','KOSDAQ','ALL'].includes(label)?label
  :family==='YAHOO'&&/^[-A-Za-z0-9.%=^]{1,24}$/.test(label)?label
  :family==='FRED'&&/^(DGS2|DGS3|DGS10)$/.test(label)?label
  :family;
 const before=Date.now();
 let response;
 try{response=await fetch(url,options);}
 catch(err){
  emit('SOURCE_HTTP',{family,source,result:'FETCH_FAILED',
   errorClass:['TimeoutError','AbortError'].includes(err?.name)?'TIMEOUT':'NETWORK',
   elapsedBucket:Math.min(60,Math.ceil((Date.now()-before)/1000))});
  throw err;
 }
 const info={family,source,http:safeStatus(response?.status),
  type:safeType(response?.headers?.get?.('content-type')),
  finalHost:safeHost(new URL(response.url||url).hostname),
  redirected:response.redirected===true,
  elapsedBucket:Math.min(60,Math.ceil((Date.now()-before)/1000))};
 if(family==='GAS_WEB_APP'){
  let json='NOT_CHECKED',html='NONE',gasStatus='UNVERIFIED';
  try{
   const length=Number(response.headers?.get?.('content-length')||0);
   if(length>2500000)json='TOO_LARGE';
   else{
    const body=await response.clone().text();
    try{
     const obj=JSON.parse(body);
     json='VALID';
     gasStatus=obj?.status==='ok'?'OK'
      :obj?.status==='error'?'ERROR':'OTHER';
    }catch{
     json='INVALID';
     if(info.type==='HTML'||body.trimStart().startsWith('<'))
      html=classifyGasHtml(body);
    }
   }
  }catch{json='READ_FAILED';}
  emit('GAS_HTTP_PROOF',{...info,json,gasStatus,html});
 }else if(family==='NAVER_STOCK'&&response?.ok){
  // Classify the provider's actual session/shape without exposing traded amounts.
  try{
   const body=await response.clone().json();
   const asked=parsed.searchParams.get('bizdate'),contents=body?.content,
    matches=Array.isArray(contents)?contents.filter(x=>x?.bizdate===asked):[];
   const latest=Array.isArray(contents)?contents.map(x=>x?.bizdate)
    .filter(x=>typeof x==='string'&&/^\d{8}$/.test(x)).sort().at(-1):null;
   const row=matches.length===1?matches[0]:null;
   emit('NAVER_SOURCE_SCHEMA',{market:source,http:info.http,type:info.type,
    contentArray:Array.isArray(contents),exactDateRows:matches.length,
    latestAvailableDate:latest?latest.slice(0,4)+'-'+latest.slice(4,6)+'-'+latest.slice(6,8):null,
    hasEmptyTime:row?.time==='',
    investorCodeCount:Array.isArray(row?.netAmounts)?row.netAmounts.length:0,
    validated:Boolean(verifyInvestorTrendMarket(date,source,body))});
  }catch{emit('NAVER_SOURCE_SCHEMA',{market:source,result:'JSON_PARSE_FAILED'});}
 }else if(!response?.ok)
  emit('SOURCE_HTTP',{...info,result:'HTTP_NOT_OK'});
 return response;
}
async function check(name,fn){
 try{
  const out=await fn();
  const fields=out&&typeof out==='object'&&!Array.isArray(out)?out:{state:'UNVERIFIED'};
  const record={name,...fields};
  summary.push(record);
  emit('DIRECT_SOURCE_CHECK',record);
 }catch(err){
  const record={name,state:'ERROR_CAUGHT',errorClass:
   err?.name==='TimeoutError'||err?.name==='AbortError'?'TIMEOUT':'UNVERIFIED_ERROR'};
  summary.push(record);emit('DIRECT_SOURCE_CHECK',record);
 }
}
const gasUrl=process.env.GAS_WEB_APP_URL,gasToken=process.env.GAS_ACCESS_TOKEN;
const gasAvailable=Boolean(gasUrl)&&typeof gasToken==='string'&&gasToken.length>=12;
let endpointValid=false;
try{if(gasAvailable){validateGasEndpoint(gasUrl);endpointValid=true;}}catch{}
emit('DIRECT_SOURCE_START',{date,kstTime:current.time,previousKrxSession:prior,
 tradingSession:krxSessionStatus(date),gasConfigured:gasAvailable,
 gasEndpointValid:endpointValid,hasKrXKey:Boolean(process.env.KRX_AUTH_KEY),
 writes:0,telegramSends:0});
if(!prior||krxSessionStatus(date)!=='OPEN'){
 emit('DIRECT_SOURCE_FINISHED',{state:'SESSION_NOT_VERIFIED',writes:0,telegramSends:0});
 process.exit(0);
}
const gasOpts={url:gasUrl,token:gasToken,fetchImpl:monitoredFetch};
await check('NH_US_INDEX_3',async()=>{
 if(!endpointValid)return {state:'CONFIG_INVALID'};
 const r=await readNhMorningIndexes(date,{...gasOpts,onDiagnostic:detail=>{
  emit('SOURCE_VALIDATION',{name:'NH_US_INDEX_3',
   status:['ALL_VERIFIED','PARTIAL_OR_MISSING','NETWORK_OR_PARSE_FAILED','GAS_RESPONSE_INVALID',
   'HTTP_UNAVAILABLE','CONFIG_MISSING','ENDPOINT_INVALID'].includes(detail?.status)
    ?detail.status:'UNVERIFIED'});
 }});
 return {state:r.length===3?'VERIFIED':r.length?'PARTIAL':'NO_VERIFIED_ROW',
  verified:r.length,total:3,observedDates:[...new Set(r.map(x=>x.date))]};
});
await check('KR_MARKET_INDEX_3',async()=>{
 const r=verifiedDomesticCloseRows(date,
  await fetchDomesticCloseIndexes(date,{gasUrl,gasToken,fetchImpl:monitoredFetch}));
 return {state:r.length===3?'VERIFIED':r.length?'PARTIAL':'NO_VERIFIED_ROW',
  verified:r.length,total:3,sources:r.map(x=>({type:x.type,source:x.source,date:x.date}))};
});
await check('NH_STOCK_SAMSUNG_HYNIX',async()=>{
 if(!endpointValid)return {state:'CONFIG_INVALID'};
 const diag=[];
 const r=await readNhClosingStocks(date,{...gasOpts,onDiagnostic:x=>diag.push(x)});
 return {state:r.filter(x=>['SAMSUNG','SKHYNIX'].includes(x.id)).length===2?'VERIFIED'
  :r.length?'PARTIAL':'NO_VERIFIED_ROW',count:r.length,
  reasons:diag.map(x=>({status:/^[A-Z0-9_]{3,80}$/.test(x?.status||'')?x.status:'OTHER',
   stocks:Array.isArray(x?.stocks)?x.stocks.filter(y=>['SAMSUNG','SKHYNIX','NVDA','MU'].includes(y?.id))
    .map(y=>({id:y.id,status:/^[A-Z0-9_]{3,80}$/.test(y?.status||'')?y.status:'OTHER'})):[]})).slice(0,3)};
});
for(const d of [date,prior]){
 const now=()=>new Date(d+'T17:08:00+09:00');
 await check('KRX_STOCK_'+d,async()=>{
  if(!endpointValid)return {state:'CONFIG_INVALID'};
  const diag=[];
  const r=await readKrxOfficialClosingStocks(d,{...gasOpts,now:()=>new Date(),
   onDiagnostic:x=>diag.push(x?.status)});
  return {state:r.length===2?'VERIFIED':r.length?'PARTIAL':'NO_VERIFIED_ROW',
   verified:r.length,total:2,date:d,reasons:diag.filter(x=>
    typeof x==='string'&&/^[A-Z0-9_]{3,80}$/.test(x)).slice(0,3),
   syntheticGateOnly:false,receiptValidationClock:'ACTUAL'};
 });
 await check('KRX_TURNOVER_'+d,async()=>{
  if(!endpointValid)return {state:'CONFIG_INVALID'};
  const diag=[];
  const r=await readClosingKrxTurnoverFromGas(d,{...gasOpts,now,
   onDiagnostic:x=>diag.push(x?.status)});
  return {state:r.length===2?'VERIFIED':r.length?'PARTIAL':'NO_VERIFIED_ROW',
   verified:r.length,total:2,date:d,reasons:diag.filter(x=>
    typeof x==='string'&&/^[A-Z0-9_]{3,80}$/.test(x)).slice(0,3),
   syntheticGateOnly:true};
 });
 await check('VKOSPI_'+d,async()=>{
  if(!endpointValid)return {state:'CONFIG_INVALID'};
  const diag=[];
  const r=await readClosingVkospi(d,{...gasOpts,now,
   onDiagnostic:x=>diag.push(x?.status)});
  return {state:r.length===1?'VERIFIED':'NO_VERIFIED_ROW',
   verified:r.length,total:1,date:d,reasons:diag.filter(x=>
    typeof x==='string'&&/^[A-Z0-9_]{3,80}$/.test(x)).slice(0,3),
   syntheticGateOnly:true};
 });
}
await check('FRED_US_TREASURY_2Y_3Y_10Y',async()=>{
 const diag=[];
 const r=verifyTreasuryCurve(date,await readTreasuryCurve(date,{
  fetchImpl:monitoredFetch,onDiagnostic:x=>diag.push({
   id:['UST2Y','UST3Y','UST10Y_FRED'].includes(x?.id)?x.id:'OTHER',
   status:/^[A-Z0-9_]{3,80}$/.test(x?.status||'')?x.status:'UNVERIFIED'})}));
 return {state:r.length===3?'VERIFIED':r.length?'PARTIAL':'NO_VERIFIED_ROW',
  verified:r.length,total:3,observedDates:[...new Set(r.map(x=>x.date))],
  reasons:diag};
});
await check('NAVER_KRX_INVESTOR_FLOW',async()=>{
 const mode=current.minute>=990&&current.minute<1080?'close':'morning';
 if(mode!=='close')return {state:'OUTSIDE_CLOSE_WINDOW',requestedMode:mode};
 const r=await readInvestorTrends(date,{mode,now:()=>new Date(),fetchImpl:monitoredFetch});
 return {state:r?.markets?.length===2?'VERIFIED':'NO_VERIFIED_ROW',
  verified:r?.markets?.length||0,total:2,date:r?.date||null,provisional:r?.provisional===true};
});
await check('KOFIA_DEPOSITS_AND_CREDIT',async()=>{
 const r=await readKofiaLiquidity(date,{fetchImpl:monitoredFetch});
 return {state:r?.deposits&&r?.margin?'VERIFIED':r?.deposits||r?.margin?'PARTIAL':'NO_VERIFIED_ROW',
  verified:Number(Boolean(r?.deposits))+Number(Boolean(r?.margin)),
  total:2,depositDate:r?.deposits?.date||null,marginDate:r?.margin?.date||null};
});
await check('CNN_FEAR_GREED',async()=>{
 const r=await readFearGreed({fetchImpl:monitoredFetch,now:()=>new Date()});
 return {state:r?'VERIFIED':'NO_VERIFIED_ROW',observedAt:r?.observedAt||null};
});
await check('KRX_BREADTH_KOSPI_KOSDAQ',async()=>{
 if(!process.env.KRX_AUTH_KEY)return {state:'KRX_KEY_NOT_CONFIGURED_IN_GITHUB',
  note:'GAS_KEY_MAY_EXIST'};
 const r=await readMorningBreadth(date,{authKey:process.env.KRX_AUTH_KEY,
  fetchImpl:monitoredFetch,now:()=>new Date()});
 return {state:r.length===2?'VERIFIED':r.length?'PARTIAL':'NO_VERIFIED_ROW',
  verified:r.length,total:2,dates:[...new Set(r.map(x=>x.date))]};
});
await check('US_INDEX_FUTURES_ES_NQ_YM_RTY',async()=>{
 const futures=['ES=F','NQ=F','YM=F','RTY=F'],results=[];
 for(const symbol of futures){
  let ok=null;
  for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
   try{
    const url='https://'+host+'/v8/finance/chart/'+encodeURIComponent(symbol)
     +'?interval=5m&range=1d';
    const response=await monitoredFetch(url,{headers:{accept:'application/json'},
      redirect:'error',signal:AbortSignal.timeout(6000)});
    if(!response.ok)continue;
    const json=await response.json(),chart=json?.chart?.result?.[0],
     stamp=chart?.timestamp,closes=chart?.indicators?.quote?.[0]?.close;
    if(chart?.meta?.symbol!==symbol||!Array.isArray(stamp)||!Array.isArray(closes)
      ||stamp.length!==closes.length)continue;
    let idx=closes.length-1;
    while(idx>=0&&!(Number.isFinite(closes[idx])&&closes[idx]>0))idx--;
    if(idx<0)continue;
    const ageM=Math.round((Date.now()-stamp[idx]*1000)/60000);
    ok={symbol,ageMinutes:ageM,source:host.startsWith('query1')?'YAHOO_1':'YAHOO_2',
     validBar:ageM>=0&&ageM<=25};
    if(ok.validBar)break;
   }catch{}
  }
  results.push(ok||{symbol,state:'NO_USABLE_CANDLE'});
 }
 return {state:results.every(x=>x.validBar)?'VERIFIED':
  results.some(x=>x.validBar)?'PARTIAL':'NO_FRESH_VERIFIED_CANDLES',
  verified:results.filter(x=>x.validBar).length,total:4,
  items:results};
});
emit('DIRECT_SOURCE_FINISHED',{date,kstTime:kst(new Date()).time,
 verified:summary.filter(x=>x.state==='VERIFIED').length,
 partial:summary.filter(x=>x.state==='PARTIAL').length,
 unavailable:summary.filter(x=>!['VERIFIED','PARTIAL'].includes(x.state)).length,
 inspected:summary.length,writes:0,telegramSends:0});
