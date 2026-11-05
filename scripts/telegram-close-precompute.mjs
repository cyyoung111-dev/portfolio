// Read-only EOD preparation: no GAS, portfolio, NH token, claim or Telegram writes.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {krxSessionStatus} from './krx-session-calendar.mjs';
import {readNhMorningIndexes} from './nh-morning-index-source.mjs';
import {fetchDomesticCloseIndexes,verifiedDomesticCloseRows,verifiedNhCloseRows} from './telegram-close-workflow.mjs';
import {fetchSecondaryIndexes} from './closing-secondary-index-sources.mjs';
import {readNhClosingStocks,readClosingMacros,validateClosingMacro,closingStockSessions,validClosingStockRow} from './closing-extra-daily-sources.mjs';
import {expectedMorningDate,MORNING_SERIES} from './telegram-morning-report.mjs';
import {readClosingMarketReferences,validateClosingMarketReference} from './closing-market-references.mjs';

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
    &&validClosingStockRow(date,x);
 }).map(x=>({id:x.id,label:x.label,symbol:x.symbol,date:x.date,source:x.source,
   value:x.value,changePercent:x.changePercent,
   ...(x.role?{role:x.role}:{}),...(x.providerSource?{providerSource:x.providerSource}:{})}));
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
 return {nh:unique(nh,x=>x.symbol,3),domestic:unique(domestic,x=>x.label,3),
  secondary:unique(secondary,x=>x.label,3),stocks:unique(stocks,x=>x.id,4),
  macros:unique(macros,x=>x.id,3),markets:unique(markets,x=>x.id,5)};
}
export async function precomputeClose({now=()=>new Date(),
 fetchNh=readNhMorningIndexes,fetchDomestic=fetchDomesticCloseIndexes,
 fetchSecondary=fetchSecondaryIndexes,fetchStocks=readNhClosingStocks,
 fetchMacros=readClosingMacros,fetchMarkets=readClosingMarketReferences,fetchImpl=fetch,
 gasUrl=process.env.GAS_WEB_APP_URL,gasToken=process.env.GAS_ACCESS_TOKEN}={}){
 const first=precloseWindow(now());
 if(!first.allowed)return {ready:false,status:'OUTSIDE_PREPARE_WINDOW',date:first.date};
 if(krxSessionStatus(first.date)!=='OPEN')
  return {ready:false,status:'MARKET_NOT_OPEN',date:first.date};
 let nh=[],domestic=[],secondary=[],stocks=[],macros=[],markets=[];
 await Promise.all([
  (async()=>{try{nh=await fetchNh(first.date,{url:gasUrl,token:gasToken,fetchImpl});}catch{}})(),
  (async()=>{try{domestic=await fetchDomestic(first.date,{fetchImpl,now,gasUrl,gasToken});}catch{}})(),
  (async()=>{try{secondary=await fetchSecondary(first.date,{fetchImpl});}catch{}})(),
  (async()=>{try{stocks=await fetchStocks(first.date,{url:gasUrl,token:gasToken,fetchImpl,
    onDiagnostic:details=>console.log(JSON.stringify({kind:'NH_PRECLOSE_STOCK_READ',...details}))});}catch{}})(),
  (async()=>{try{macros=await fetchMacros(first.date,{fetchImpl,now});}catch{}})(),
  (async()=>{try{markets=await fetchMarkets(first.date,{fetchImpl,now});}catch{}})()
 ]);
 const last=precloseWindow(now());
 if(!last.allowed||last.date!==first.date)return {ready:false,status:'PREPARE_TOO_LATE',date:first.date};
 const rows=sanitizePreclose(first.date,{nh,domestic,secondary,stocks,macros,markets});
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
