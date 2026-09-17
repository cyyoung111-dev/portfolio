(function(global){
'use strict';
const REQUEST_TYPES=Object.freeze(['KOSPI','KOSDAQ','SP500','NASDAQ100']);
const KEY_MAP=Object.freeze({KOSPI:'KOSPI',KOSDAQ:'KOSDAQ',SP500:'SP500',NASDAQ100:'NASDAQ100'});
function latest(points){if(!Array.isArray(points)||!points.length)return null;return points.filter(p=>p&&p.date&&Number(p.value)>0).sort((a,b)=>String(a.date).localeCompare(String(b.date))).at(-1)||null;}
async function collect(request,tradingDate,options={}){
 if(typeof request!=='function')throw new Error('market briefing request function missing');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(tradingDate||'')))throw new Error('invalid tradingDate');
 const from=options.from||tradingDate,to=options.to||tradingDate;
 const data=await request('getBenchmarks',{benchmarks:REQUEST_TYPES.join(','),from,to},{timeoutMs:options.timeoutMs||45000,retry:0});
 const payload={},missing=[];
 for(const type of REQUEST_TYPES){const point=latest(data&&data.series&&data.series[type]);if(!point){missing.push(type);continue;}payload[KEY_MAP[type]]={value:Number(point.value),source:String(data&&data.symbols&&data.symbols[type]||type),timestamp:`${point.date}T15:30:00+09:00`,status:'FINAL',quality:'EOD'};}
 return {payload,missing,errors:(data&&data.errors)||{},receivedAt:new Date().toISOString()};
}
async function collectAndIngest(runtime,request,tradingDate,options={}){
 if(!runtime||typeof runtime.ingestBenchmarks!=='function')throw new Error('MarketBriefingRuntime unavailable');
 const result=await collect(request,tradingDate,options);
 const rows=runtime.ingestBenchmarks(result.payload,{tradingDate,receivedAt:result.receivedAt,session:'REGULAR'});
 return {...result,rows};
}
const api={REQUEST_TYPES,KEY_MAP,latest,collect,collectAndIngest};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
global.MarketBriefingProviderCollector=api;
})(typeof globalThis!=='undefined'?globalThis:this);
