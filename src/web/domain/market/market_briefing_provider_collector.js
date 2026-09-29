(function(global){
'use strict';
const REQUEST_TYPES=Object.freeze(['KOSPI','KOSDAQ','KOSPI200','SP500','NASDAQ100','SOX','VIX']);
const KEY_MAP=Object.freeze({KOSPI:'KOSPI',KOSDAQ:'KOSDAQ',KOSPI200:'KOSPI200',SP500:'SP500',NASDAQ100:'NASDAQ100',SOX:'SOX',VIX:'VIX'});
const STOCKS=Object.freeze({SAMSUNG:'005930',SKHYNIX:'000660'});
const KRX_FINAL_CHECKPOINTS=Object.freeze(['KRX_FINAL','AFTER_FINAL','EVENING']);
function latest(points){if(!Array.isArray(points)||!points.length)return null;return points.filter(p=>p&&/^\d{4}-\d{2}-\d{2}$/.test(String(p.date||''))&&Number(p.value)>0).sort((a,b)=>String(a.date).localeCompare(String(b.date))).at(-1)||null;}
function sourceFor(type){return type==='KOSPI'||type==='KOSDAQ'?'TOSS':'YAHOO';}
function lookback(date,days=7){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-days);return d.toISOString().slice(0,10);}
function normalizeBenchmarkPoint(type,point,data,tradingDate,checkpoint){
 const source=sourceFor(type),sourceDate=String(point.date),isCurrent=sourceDate===tradingDate;
 const delayed=Boolean(point.delayed||point.status==='DELAYED'||source==='YAHOO');
 const providerMeta=data&&data.seriesMeta&&data.seriesMeta[type];
 const krxCloseVerified=isCurrent&&source==='TOSS'&&KRX_FINAL_CHECKPOINTS.includes(checkpoint)&&!delayed&&providerMeta&&providerMeta.confirmedClose===true&&providerMeta.fresh===true;
 const final=!isCurrent||krxCloseVerified;
 return {value:Number(point.value),tradingDate:sourceDate,sourceDate,source,status:delayed&&isCurrent?'DELAYED':final?'FINAL':'PARTIAL',
  finality:final?'REGULAR_CLOSE':null,session:'REGULAR',market:type.startsWith('KOS')?'KRX':'US',currency:null,
  quality:delayed?'EOD_DELAYED':'EOD',fallback:!isCurrent,providerSymbol:String(data&&data.symbols&&data.symbols[type]||'')};
}
function normalizeFxPoint(data,tradingDate){const rows=Array.isArray(data&&data.history)?data.history:Array.isArray(data&&data.series)?data.series:[];const point=latest(rows.map(row=>({date:String(row.date||row.tradingDate||'').slice(0,10),value:Number(row.value??row.rate??row.close)})));if(!point)return null;const isCurrent=point.date===tradingDate;return {value:Number(point.value),tradingDate:String(point.date),sourceDate:String(point.date),source:String(data&&data.source||'FX_HISTORY'),status:isCurrent?'PARTIAL':'FINAL',finality:isCurrent?null:'HISTORICAL_CLOSE',session:'FX',market:'FX',currency:'KRW',quality:'EOD',fallback:!isCurrent};}
function trustedStockClose(source){return /^(KRX|KRX_OTP|KRX_CONFIRMED_CLOSE|STORED_CONFIRMED_CLOSE)$/.test(String(source||'').toUpperCase());}
function normalizeStockPoint(seriesId,code,current,history,tradingDate){
 const exact=(Array.isArray(history)?history:[]).filter(row=>String(row&&row.date||'').slice(0,10)===tradingDate&&Number(row&&row.price)>0&&trustedStockClose(row&&row.source)).at(-1);
 if(exact)return {value:Number(exact.price),tradingDate,sourceDate:tradingDate,source:String(exact.source),status:'FINAL',finality:'REGULAR_CLOSE',session:'REGULAR',market:'KRX',currency:'KRW',quality:'EOD',fallback:false,symbol:code,seriesId};
 const price=Number(current&&current.price);const sourceDate=String(current&&current.sourceDate||'').slice(0,10);
 if(!(price>0)||!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate))return null;
 return {value:price,tradingDate:sourceDate,sourceDate,source:String(current.source||'GET_PRICES'),status:'PARTIAL',finality:null,session:'REGULAR',market:'KRX',currency:'KRW',quality:'INDICATIVE',fallback:sourceDate!==tradingDate,symbol:code,seriesId};
}
async function collect(request,tradingDate,options={}){
 if(typeof request!=='function')throw new Error('market briefing request function missing');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(tradingDate||'')))throw new Error('invalid tradingDate');
 const from=options.from||lookback(tradingDate),to=options.to||tradingDate;
 const payload={},missing=[],errors={};
 try{
  const data=await request('getBenchmarks',{benchmarks:REQUEST_TYPES.join(','),from,to,fresh:KRX_FINAL_CHECKPOINTS.includes(options.checkpoint)?'1':'0'},{timeoutMs:options.timeoutMs||45000,retry:0});
  for(const type of REQUEST_TYPES){const point=latest(data&&data.series&&data.series[type]);if(!point){missing.push(type);continue;}payload[KEY_MAP[type]]=normalizeBenchmarkPoint(type,point,data,tradingDate,options.checkpoint);}
  Object.assign(errors,(data&&data.errors)||{});
 }catch(error){for(const type of REQUEST_TYPES)missing.push(type);errors.getBenchmarks=String(error&&error.message||error);}
 try{
  const fx=await request('getExchangeRateHistory',{from,to},{timeoutMs:options.timeoutMs||45000,retry:0});
  const point=normalizeFxPoint(fx,tradingDate);if(point)payload.USDKRW=point;else missing.push('USDKRW');
 }catch(error){missing.push('USDKRW');errors.USDKRW=String(error&&error.message||error);}
 {
  const codes=Object.values(STOCKS).join(',');
  const [pricesResult,historyResult]=await Promise.allSettled([
   request('getPrices',{codes,persist:'0'},{timeoutMs:options.timeoutMs||45000,retry:0}),
   request('getPriceHistory',{from:tradingDate,to:tradingDate,codes},{timeoutMs:options.timeoutMs||45000,retry:0})
  ]);
  const prices=pricesResult.status==='fulfilled'?pricesResult.value:null;
  const history=historyResult.status==='fulfilled'?historyResult.value:null;
  if(pricesResult.status==='rejected')errors.stockCurrent=String(pricesResult.reason&&pricesResult.reason.message||pricesResult.reason);
  if(historyResult.status==='rejected')errors.stockHistory=String(historyResult.reason&&historyResult.reason.message||historyResult.reason);
  for(const [seriesId,code] of Object.entries(STOCKS)){
   const current={price:prices&&prices.prices&&prices.prices[code],sourceDate:prices&&prices.priceDates&&prices.priceDates[code],source:'GET_PRICES'};
   const row=normalizeStockPoint(seriesId,code,current,history&&history.prices&&history.prices[code],tradingDate);
   if(row)payload[seriesId]=row;else missing.push(seriesId);
  }
 }
 return {payload,missing:[...new Set(missing)],errors,receivedAt:new Date().toISOString(),range:{from,to}};
}
async function collectAndIngest(runtime,request,tradingDate,options={}){if(!runtime||typeof runtime.ingestBenchmarks!=='function')throw new Error('MarketBriefingRuntime unavailable');const result=await collect(request,tradingDate,options);const rows=runtime.ingestBenchmarks(result.payload,{tradingDate,receivedAt:result.receivedAt});return {...result,rows};}
const api={REQUEST_TYPES,KEY_MAP,STOCKS,KRX_FINAL_CHECKPOINTS,latest,sourceFor,lookback,normalizeBenchmarkPoint,normalizeFxPoint,trustedStockClose,normalizeStockPoint,collect,collectAndIngest};if(typeof module!=='undefined'&&module.exports)module.exports=api;global.MarketBriefingProviderCollector=api;
})(typeof globalThis!=='undefined'?globalThis:this);
