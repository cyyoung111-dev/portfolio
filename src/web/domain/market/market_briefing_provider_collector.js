(function(global){
'use strict';
const REQUEST_TYPES=Object.freeze(['KOSPI','KOSDAQ','KOSPI200','SP500','NASDAQ100','SOX','VIX']);
const KEY_MAP=Object.freeze({KOSPI:'KOSPI',KOSDAQ:'KOSDAQ',KOSPI200:'KOSPI200',SP500:'SP500',NASDAQ100:'NASDAQ100',SOX:'SOX',VIX:'VIX'});
function latest(points){if(!Array.isArray(points)||!points.length)return null;return points.filter(p=>p&&/^\d{4}-\d{2}-\d{2}$/.test(String(p.date||''))&&Number(p.value)>0).sort((a,b)=>String(a.date).localeCompare(String(b.date))).at(-1)||null;}
function sourceFor(type){if(type==='KOSPI'||type==='KOSDAQ')return 'TOSS';if(type==='KOSPI200')return 'UNVERIFIED';return 'YAHOO';}
function lookback(date,days=7){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-days);return d.toISOString().slice(0,10);}
function normalizeBenchmarkPoint(type,point,data){const source=sourceFor(type);if(source==='UNVERIFIED')return null;return {value:Number(point.value),tradingDate:String(point.date),source,status:'FINAL',session:'REGULAR',quality:'EOD',providerSymbol:String(data&&data.symbols&&data.symbols[type]||'')};}
function normalizeFxPoint(data,tradingDate){const rows=Array.isArray(data&&data.history)?data.history:Array.isArray(data&&data.series)?data.series:[];const point=latest(rows.map(row=>({date:String(row.date||row.tradingDate||'').slice(0,10),value:Number(row.value??row.rate??row.close)})));if(!point)return null;return {value:Number(point.value),tradingDate:String(point.date),source:String(data&&data.source||'FX_HISTORY'),status:point.date===tradingDate?'PARTIAL':'FINAL',session:'FX',quality:'EOD'};}
async function collect(request,tradingDate,options={}){
 if(typeof request!=='function')throw new Error('market briefing request function missing');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(tradingDate||'')))throw new Error('invalid tradingDate');
 const from=options.from||lookback(tradingDate),to=options.to||tradingDate;
 const payload={},missing=[],errors={};
 try{
  const data=await request('getBenchmarks',{benchmarks:REQUEST_TYPES.join(','),from,to},{timeoutMs:options.timeoutMs||45000,retry:0});
  for(const type of REQUEST_TYPES){const point=latest(data&&data.series&&data.series[type]);if(!point){missing.push(type);continue;}const normalized=normalizeBenchmarkPoint(type,point,data);if(normalized)payload[KEY_MAP[type]]=normalized;else missing.push(type);}
  Object.assign(errors,(data&&data.errors)||{});
 }catch(error){for(const type of REQUEST_TYPES)missing.push(type);errors.getBenchmarks=String(error&&error.message||error);}
 try{
  const fx=await request('getExchangeRateHistory',{from,to},{timeoutMs:options.timeoutMs||45000,retry:0});
  const point=normalizeFxPoint(fx,tradingDate);if(point)payload.USDKRW=point;else missing.push('USDKRW');
 }catch(error){missing.push('USDKRW');errors.USDKRW=String(error&&error.message||error);}
 return {payload,missing:[...new Set(missing)],errors,receivedAt:new Date().toISOString(),range:{from,to}};
}
async function collectAndIngest(runtime,request,tradingDate,options={}){if(!runtime||typeof runtime.ingestBenchmarks!=='function')throw new Error('MarketBriefingRuntime unavailable');const result=await collect(request,tradingDate,options);const rows=runtime.ingestBenchmarks(result.payload,{tradingDate,receivedAt:result.receivedAt});return {...result,rows};}
const api={REQUEST_TYPES,KEY_MAP,latest,sourceFor,lookback,normalizeBenchmarkPoint,normalizeFxPoint,collect,collectAndIngest};if(typeof module!=='undefined'&&module.exports)module.exports=api;global.MarketBriefingProviderCollector=api;
})(typeof globalThis!=='undefined'?globalThis:this);
