// Read-only EOD preparation: no GAS, portfolio, NH token, claim or Telegram writes.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {krxSessionStatus} from './krx-session-calendar.mjs';
import {readNhMorningIndexes} from './nh-morning-index-source.mjs';
import {fetchDomesticCloseIndexes,verifiedDomesticCloseRows,verifiedNhCloseRows} from './telegram-close-workflow.mjs';
import {fetchSecondaryIndexes} from './closing-secondary-index-sources.mjs';
import {readClosingStockSources,readClosingMacros,validateClosingMacro,closingStockSessions,validClosingStockReference} from './closing-extra-daily-sources.mjs';
import {expectedMorningDate,MORNING_SERIES} from './telegram-morning-report.mjs';
import {readClosingMarketReferences,validateClosingMarketReference} from './closing-market-references.mjs';
import {readMorningVkospi,readMorningTurnover} from './telegram-morning-supplements.mjs';
import {verifyClosingVkospi} from './closing-vkospi-reference.mjs';
import {verifyOfficialKrxTurnover} from './closing-krx-turnover.mjs';
import {verifiedSkhyQuote} from './briefing-skhy-adr-parity.mjs';
import {readNasdaqDailyHistorical} from './briefing-nasdaq-daily-reference.mjs';
import {fetchDatedDaily} from './telegram-morning-briefing.mjs';

const REPO='cyyoung111-dev/portfolio';
const STOCK_IDS=new Set(['SAMSUNG','SKHYNIX','NVDA','MU']);
const MACRO_IDS=new Set(['USDKRW','DXY','UST10Y']);
const refSources=new Map([['다우존스',['FRED_DJIA']],['SOX',['FRED_NASDAQSOX','YAHOO_SOX_DAILY_REFERENCE']],['VIX',['CBOE_VIX_DAILY']]]);
const stockSymbols=new Map(MORNING_SERIES.filter(x=>STOCK_IDS.has(x.id)).map(x=>[x.id,x]));
const macroSymbols=new Map(MORNING_SERIES.filter(x=>MACRO_IDS.has(x.id)).map(x=>[x.id,x]));
export function precloseWindow(instant){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
  hourCycle:'h23'}).formatToParts(instant).map(x=>[x.type,x.value]));
 const date=p.year+'-'+p.month+'-'+p.day,minutes=Number(p.hour)*60+Number(p.minute);
 return {date,allowed:minutes>=1005&&minutes<1020}; // 16:45..16:59 KST
}
export function sanitizePreclose(date,source){
 const us=expectedMorningDate('SPX',date),session=closingStockSessions(date);
 if(!session||typeof source!=='object'||!source||Array.isArray(source))return null;
 const nh=verifiedNhCloseRows(date,source.nh||[]);
 const domestic=verifiedDomesticCloseRows(date,source.domestic||[]);
 const secondary=(Array.isArray(source.secondary)?source.secondary:[])
  .filter(x=>refSources.get(x?.label)?.includes(x.source)&&x.role==='NON_NH_REFERENCE_ONLY'
    &&x.date===us&&Number.isFinite(x.value)&&x.value>0)
  .map(x=>({label:x.label,source:x.source,role:'NON_NH_REFERENCE_ONLY',
    date:us,value:x.value,changePercent:Number.isFinite(x.changePercent)?x.changePercent:null}));
 const stocks=(Array.isArray(source.stocks)?source.stocks:[]).filter(x=>{
   const t=stockSymbols.get(x?.id),expected=['SAMSUNG','SKHYNIX'].includes(x?.id)?date:session.us;
   return t&&x.label===t.label&&x.symbol===t.symbol&&x.date===expected
    &&validClosingStockReference(date,x);
 }).map(x=>({id:x.id,label:x.label,symbol:x.symbol,date:x.date,source:x.source,
   value:x.value,changePercent:x.changePercent}));
 const macros=(Array.isArray(source.macros)?source.macros:[]).flatMap(x=>{
  const info=macroSymbols.get(x?.id);
  if(!info||x.symbol!==info.symbol||x.label!==info.label||x.source!=='YAHOO_DAILY_REFERENCE')return [];
  const validated=validateClosingMacro(date,x.id,{...x,source:'Yahoo Finance 일봉'});
  return validated?[validated]:[];
 });
 const markets=(Array.isArray(source.markets)?source.markets:[]).flatMap(x=>{
  const v=validateClosingMarketReference(date,x?.id,x);
  return v?[v]:[];
 });
 const unique=(rows,key,limit)=>rows.length<=limit
  &&new Set(rows.map(key)).size===rows.length?rows:[];
 const prior=expectedMorningDate('KOSPI',date);
 const priorVkospi=prior&&krxSessionStatus(prior)==='OPEN'
  ?verifyClosingVkospi(prior,source.priorVkospi||[]):[];
 const priorTurnover=prior&&krxSessionStatus(prior)==='OPEN'
  ?verifyOfficialKrxTurnover(prior,source.priorTurnover||[]):[];
 return {nh:unique(nh,x=>x.symbol,3),domestic:unique(domestic,x=>x.label,3),
  secondary:unique(secondary,x=>x.label,3),stocks:unique(stocks,x=>x.id,4),
  macros:unique(macros,x=>x.id,3),markets:unique(markets,x=>x.id,5),priorVkospi,priorTurnover,
  skhy:[verifiedSkhyQuote(source.skhy||[],us)].filter(Boolean)};
}
// Read the same completed US session using existing Yahoo/Nasdaq readers.
async function readPriorSkhy(date,{now,fetchImpl}){
 const us=expectedMorningDate('NVDA',date);
 if(!us)return [];
 const label='SK하이닉스 ADR',symbol='SKHY';
 const row=await fetchDatedDaily(label,symbol,date,{now:now(),fetchImpl,expectedSessionDate:us});
 const yahoo=row?.source==='Yahoo Finance 일봉'
   ?verifiedSkhyQuote([{...row,source:'YAHOO_DAILY_REFERENCE'}],us):null;
 if(yahoo)return [yahoo];
 const nasdaq=await readNasdaqDailyHistorical(symbol,us,{now:now(),fetchImpl});
 return [verifiedSkhyQuote([{...nasdaq,label}],us)].filter(Boolean);
}
// A delayed/missing precompute must not permanently hide optional observations.
// Reuse complete cached groups; otherwise try the same readers in parallel,
// with a single overall deadline, independent of all delivery/claim gates.
export async function readMissingCloseReferences(date,cached={},{
 now=()=>new Date(),fetchImpl=fetch,gasUrl,gasToken,krxKey=process.env.KRX_AUTH_KEY,
 fetchPriorVkospi=readMorningVkospi,fetchPriorTurnover=readMorningTurnover,
 fetchSkhy=readPriorSkhy,maxMs=6000
}={}){
 const checked=sanitizePreclose(date,cached)||{};
 const result={priorVkospi:checked.priorVkospi||[],
  priorTurnover:checked.priorTurnover||[],skhy:checked.skhy||[]};
 if(!Number.isInteger(maxMs)||maxMs<=0||maxMs>6000)return result;
 const prior=expectedMorningDate('KOSPI',date);
 const controller=new AbortController();
 const boundedFetch=(target,options={})=>fetchImpl(target,{...options,
  signal:options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal});
 const tasks=[];
 const schedule=(key,read)=>{
  tasks.push(Promise.resolve().then(read).then(rows=>{
   if(controller.signal.aborted)return;
   const safe=sanitizePreclose(date,{[key]:rows})?.[key]||[];
   if(safe.length>result[key].length)result[key]=safe;
  }).catch(()=>{}));
 };
 const opts={url:gasUrl,token:gasToken,authKey:krxKey,fetchImpl:boundedFetch,now};
 const configured=Boolean((gasUrl&&gasToken)||krxKey);
 if(prior&&krxSessionStatus(prior)==='OPEN'){
  if(!result.priorVkospi.length&&(configured||fetchPriorVkospi!==readMorningVkospi))
   schedule('priorVkospi',()=>fetchPriorVkospi(prior,opts));
  if(result.priorTurnover.length<2&&(configured||fetchPriorTurnover!==readMorningTurnover))
   schedule('priorTurnover',()=>fetchPriorTurnover(prior,opts));
 }
 if(!result.skhy.length)schedule('skhy',()=>fetchSkhy(date,{now,fetchImpl:boundedFetch}));
 if(!tasks.length)return result;
 let timer;
 try{
  await Promise.race([Promise.all(tasks),new Promise(resolve=>{
   timer=setTimeout(()=>{controller.abort();resolve();},maxMs);
  })]);
 }finally{clearTimeout(timer);controller.abort();}
 return result;
}
export async function precomputeClose({now=()=>new Date(),
 fetchNh=readNhMorningIndexes,fetchDomestic=fetchDomesticCloseIndexes,
 fetchSecondary=fetchSecondaryIndexes,fetchStocks=readClosingStockSources,
 fetchMacros=readClosingMacros,fetchMarkets=readClosingMarketReferences,fetchImpl=fetch,
 fetchPriorVkospi=readMorningVkospi,fetchPriorTurnover=readMorningTurnover,fetchSkhy=readPriorSkhy,
 krxKey=process.env.KRX_AUTH_KEY,
 gasUrl=process.env.GAS_WEB_APP_URL,gasToken=process.env.GAS_ACCESS_TOKEN}={}){
 const first=precloseWindow(now());
 if(!first.allowed)return {ready:false,status:'OUTSIDE_PREPARE_WINDOW',date:first.date};
 if(krxSessionStatus(first.date)!=='OPEN')
  return {ready:false,status:'MARKET_NOT_OPEN',date:first.date};
 let nh=[],domestic=[],secondary=[],stocks=[],macros=[],markets=[],priorVkospi=[],priorTurnover=[],skhy=[];
 const prior=expectedMorningDate('KOSPI',first.date);
 // Only query the already published prior session, in the existing read-only
 // precompute window. Never add calls to the 17:00 delivery critical path.
 const priorOpts={url:gasUrl,token:gasToken,authKey:krxKey,fetchImpl,now};
 const configured=Boolean((gasUrl&&gasToken)||krxKey);
 await Promise.all([
  (async()=>{try{nh=await fetchNh(first.date,{url:gasUrl,token:gasToken,fetchImpl});}catch{}})(),
  (async()=>{try{domestic=await fetchDomestic(first.date,{fetchImpl,now,gasUrl,gasToken});}catch{}})(),
  (async()=>{try{secondary=await fetchSecondary(first.date,{fetchImpl});}catch{}})(),
  (async()=>{try{stocks=await fetchStocks(first.date,{url:gasUrl,token:gasToken,fetchImpl,
    onDiagnostic:details=>console.log(JSON.stringify({kind:'NH_PRECLOSE_STOCK_READ',...details}))});}catch{}})(),
  (async()=>{try{macros=await fetchMacros(first.date,{fetchImpl,now});}catch{}})(),
  (async()=>{try{markets=await fetchMarkets(first.date,{fetchImpl,now});}catch{}})(),
  (async()=>{try{if(prior&&krxSessionStatus(prior)==='OPEN'
    &&(configured||fetchPriorVkospi!==readMorningVkospi))
    priorVkospi=await fetchPriorVkospi(prior,priorOpts);}catch{}})(),
  (async()=>{try{if(prior&&krxSessionStatus(prior)==='OPEN'
    &&(configured||fetchPriorTurnover!==readMorningTurnover))
    priorTurnover=await fetchPriorTurnover(prior,priorOpts);}catch{}})(),
  (async()=>{try{skhy=await fetchSkhy(first.date,{now,fetchImpl});}catch{}})()
 ]);
 const last=precloseWindow(now());
 if(!last.allowed||last.date!==first.date)return {ready:false,status:'PREPARE_TOO_LATE',date:first.date};
 const rows=sanitizePreclose(first.date,{nh,domestic,secondary,stocks,macros,markets,priorVkospi,priorTurnover,skhy});
 if(!rows)return {ready:false,status:'PREPARE_INVALID',date:first.date};
 const capturedAt=now().toISOString();
 return {ready:true,status:'PRECOMPUTED',artifactName:'telegram-close-prepared-'+first.date,
   data:{schemaVersion:1,date:first.date,capturedAt,...rows},
   counts:Object.fromEntries(Object.entries(rows).map(([key,value])=>[key,value.length]))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.env.GITHUB_EVENT_NAME!=='schedule'||process.env.GITHUB_RUN_ATTEMPT!=='1'
   ||process.env.GITHUB_REPOSITORY!==REPO||process.env.GITHUB_REF!=='refs/heads/main')
   throw Error('PRECLOSE_EVENT_INVALID');
  const result=await precomputeClose();
  if(result.ready){
   fs.mkdirSync('.telegram-close-prepared',{recursive:true});
   fs.writeFileSync('.telegram-close-prepared/prepared.json',JSON.stringify(result.data));
  }
  fs.appendFileSync(process.env.GITHUB_OUTPUT,
   'ready='+result.ready+'\nartifact_name='+(result.artifactName||'')+'\n');
  console.log(JSON.stringify({status:result.status,date:result.date,counts:result.counts||null}));
 }catch{console.error('PRECLOSE_PREPARE_FAILED');process.exitCode=1;}
}
