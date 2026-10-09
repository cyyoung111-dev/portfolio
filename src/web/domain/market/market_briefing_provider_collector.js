(function(global){
'use strict';
const REQUEST_TYPES=Object.freeze(['KOSPI','KOSDAQ','KOSPI200','SP500','NASDAQ100','SOX','VIX','DXY','UST10Y','WTI','GOLD','BTC']);
const KEY_MAP=Object.freeze({KOSPI:'KOSPI',KOSDAQ:'KOSDAQ',KOSPI200:'KOSPI200',SP500:'SP500',NASDAQ100:'NASDAQ100',SOX:'SOX',VIX:'VIX',DXY:'DXY',UST10Y:'UST10Y',WTI:'WTI',GOLD:'GOLD',BTC:'BTC'});
const STOCKS=Object.freeze({SAMSUNG:'005930',SKHYNIX:'000660'});
const KRX_FINAL_CHECKPOINTS=Object.freeze(['KRX_FINAL','AFTER_FINAL','EVENING']);
const STOCK_OFFICIAL_CHECKPOINTS=Object.freeze(['KRX_FINAL','EVENING']);
const masterApi=global.MarketBriefingMaster||(typeof module!=='undefined'&&module.exports?require('./market_briefing_master.js'):null);
function latest(points){if(!Array.isArray(points)||!points.length)return null;return points.filter(p=>p&&/^\d{4}-\d{2}-\d{2}$/.test(String(p.date||''))&&Number(p.value)>0).sort((a,b)=>String(a.date).localeCompare(String(b.date))).at(-1)||null;}
function sourceFor(type){return type==='KOSPI'||type==='KOSDAQ'?'TOSS':'YAHOO';}
function lookback(date,days=7){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-days);return d.toISOString().slice(0,10);}
function normalizeBenchmarkPoint(type,point,data,tradingDate,checkpoint){
 const providerMeta=data&&data.seriesMeta&&data.seriesMeta[type];
 const source=String(point.source||providerMeta&&providerMeta.source||sourceFor(type)),sourceDate=String(point.date),isCurrent=sourceDate===tradingDate;
 const delayed=Boolean(point.delayed||point.status==='DELAYED'||source==='YAHOO');
 const observedAt=point.observedAt&&Number.isFinite(Date.parse(point.observedAt))?point.observedAt:null;
 // Toss 일봉은 이전 날짜라는 이유만으로 확정 종가가 되지 않습니다.
 // KRX 공식 API로 확인된 정규장 종가만 국내 대표지수 FINAL로 승격합니다.
 const isKrIndex=type==='KOSPI'||type==='KOSDAQ';
 const krxCloseVerified=Boolean(source==='KRX_OFFICIAL'&&!delayed&&providerMeta&&providerMeta.confirmedClose===true
  &&observedAt&&(!isCurrent||KRX_FINAL_CHECKPOINTS.includes(checkpoint)));
 const final=isKrIndex?krxCloseVerified:(!isCurrent||krxCloseVerified);
 const market=(type.startsWith('KOS')||type==='VKOSPI')?'KRX':type==='DXY'?'FX':type==='UST10Y'?'US_RATES':(type==='WTI'||type==='GOLD')?'COMMODITY':type==='BTC'?'CRYPTO':'US';
 return {value:Number(point.value),tradingDate:sourceDate,sourceDate,source,status:delayed&&isCurrent?'DELAYED':final?'FINAL':'PARTIAL',
  finality:final?'REGULAR_CLOSE':null,session:'REGULAR',market,currency:null,
  observedAt,quality:delayed?'EOD_DELAYED':'EOD',fallback:!isCurrent,providerSymbol:String(data&&data.symbols&&data.symbols[type]||'')};
}
function normalizeFxPoint(data,tradingDate,options={}){const rows=Array.isArray(data&&data.history)?data.history:Array.isArray(data&&data.series)?data.series:[];const point=latest(rows.map(row=>({date:String(row.date||row.tradingDate||'').slice(0,10),value:Number(row.value??row.rate??row.close),observedAt:row.observedAt&&Number.isFinite(Date.parse(row.observedAt))?row.observedAt:null})));if(!point)return null;const isCurrent=point.date===tradingDate,scheduledTolerance=Number(options.scheduledToleranceSeconds)===300&&isCurrent&&!point.observedAt;return {value:Number(point.value),tradingDate:String(point.date),sourceDate:String(point.date),source:String(data&&data.source||'FX_HISTORY'),status:isCurrent?'PARTIAL':'FINAL',finality:isCurrent?null:'HISTORICAL_CLOSE',session:'FX',market:'FX',currency:'KRW',observedAt:point.observedAt,quality:scheduledTolerance?'SCHEDULED_DELAY_TOLERANCE_300S':'EOD',fallback:!isCurrent};}
function trustedStockClose(source){return /^(KRX|KRX_OTP|KRX_OFFICIAL|KRX_CONFIRMED_CLOSE|STORED_CONFIRMED_CLOSE)$/.test(String(source||'').toUpperCase());}
function regularCloseObservedAt(tradingDate){return masterApi.checkpointAt(tradingDate,'KRX_FINAL');}
function normalizeStockPoint(seriesId,code,current,history,tradingDate,official){
 const exact=(Array.isArray(history)?history:[]).filter(row=>String(row&&row.date||'').slice(0,10)===tradingDate&&Number(row&&row.price)>0&&trustedStockClose(row&&row.source)).at(-1);
 if(exact)return {value:Number(exact.price),tradingDate,sourceDate:tradingDate,source:String(exact.source),status:'FINAL',finality:'REGULAR_CLOSE',session:'REGULAR',market:'KRX',currency:'KRW',observedAt:regularCloseObservedAt(tradingDate),quality:'EOD',fallback:false,symbol:code,seriesId};
 if(official&&String(official.code)===code&&String(official.usedDate)===tradingDate&&Number(official.price)>0&&trustedStockClose(official.source))return {value:Number(official.price),tradingDate,sourceDate:tradingDate,source:String(official.source),status:'FINAL',finality:'REGULAR_CLOSE',session:'REGULAR',market:'KRX',currency:'KRW',observedAt:regularCloseObservedAt(tradingDate),receivedAt:official.receivedAt||null,quality:'OFFICIAL_DAILY_CLOSE',fallback:false,symbol:code,seriesId};
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
  const data=await request('getBenchmarks',{benchmarks:REQUEST_TYPES.join(','),from,to,fresh:(KRX_FINAL_CHECKPOINTS.includes(options.checkpoint)||options.checkpoint==='MORNING')?'1':'0'},{timeoutMs:options.timeoutMs||45000,retry:0});
  for(const type of REQUEST_TYPES){const point=latest(data&&data.series&&data.series[type]);if(!point){missing.push(type);continue;}payload[KEY_MAP[type]]=normalizeBenchmarkPoint(type,point,data,tradingDate,options.checkpoint);}
  Object.assign(errors,(data&&data.errors)||{});
 }catch(error){for(const type of REQUEST_TYPES)missing.push(type);errors.getBenchmarks=String(error&&error.message||error);}
 if(options.checkpoint==='NIGHT_FINAL'||options.checkpoint==='MORNING'){
  try{
   const night=await request('getKrxK200NightClose',{date:tradingDate},{timeoutMs:options.timeoutMs||45000,retry:0});
   if(night&&night.observation)payload.K200_NIGHT=night.observation;
   else{missing.push('K200_NIGHT');if(night&&night.error)errors.K200_NIGHT=String(night.error);}
  }catch(error){missing.push('K200_NIGHT');errors.K200_NIGHT=String(error&&error.message||error);}
 }
 try{
  const vk=await request('getBenchmark',{benchmark:'VKOSPI',from,to},{timeoutMs:options.timeoutMs||45000,retry:0});
  const point=latest(vk&&vk.points);
  if(point){
   const isCurrent=String(point.date)===tradingDate;
   const finalCheckpoint=KRX_FINAL_CHECKPOINTS.includes(options.checkpoint);
   const normalizedPoint={...point,source:'KRX_OFFICIAL',observedAt:isCurrent&&finalCheckpoint?regularCloseObservedAt(tradingDate):(point.observedAt||null)};
   payload.VKOSPI=normalizeBenchmarkPoint('VKOSPI',normalizedPoint,{symbols:{VKOSPI:vk.symbol||'KRX_OPEN_API:VKOSPI'},seriesMeta:{VKOSPI:{source:'KRX_OFFICIAL',confirmedClose:isCurrent&&finalCheckpoint}}},tradingDate,options.checkpoint);
  }else missing.push('VKOSPI');
 }catch(error){missing.push('VKOSPI');errors.VKOSPI=String(error&&error.message||error);}
 try{
  const fx=await request('getExchangeRateHistory',{from,to},{timeoutMs:options.timeoutMs||45000,retry:0});
  const point=normalizeFxPoint(fx,tradingDate,options);if(point)payload.USDKRW=point;else missing.push('USDKRW');
 }catch(error){missing.push('USDKRW');errors.USDKRW=String(error&&error.message||error);}
 {
  const codes=Object.values(STOCKS).join(',');
  const [pricesResult,historyResult,officialResult]=await Promise.allSettled([
   request('getPrices',{codes,persist:'0'},{timeoutMs:options.timeoutMs||45000,retry:0}),
   request('getPriceHistory',{from:tradingDate,to:tradingDate,codes},{timeoutMs:options.timeoutMs||45000,retry:0}),
   STOCK_OFFICIAL_CHECKPOINTS.includes(options.checkpoint)?request('getKrxOfficialStockCloses',{date:tradingDate,codes},{timeoutMs:options.timeoutMs||45000,retry:0}):Promise.resolve(null)
  ]);
  const prices=pricesResult.status==='fulfilled'?pricesResult.value:null;
  const history=historyResult.status==='fulfilled'?historyResult.value:null;
  const official=officialResult.status==='fulfilled'?officialResult.value:null;
  if(pricesResult.status==='rejected')errors.stockCurrent=String(pricesResult.reason&&pricesResult.reason.message||pricesResult.reason);
  if(historyResult.status==='rejected')errors.stockHistory=String(historyResult.reason&&historyResult.reason.message||historyResult.reason);
  if(officialResult.status==='rejected')errors.stockOfficial=String(officialResult.reason&&officialResult.reason.message||officialResult.reason);
  for(const [seriesId,code] of Object.entries(STOCKS)){
   const current={price:prices&&prices.prices&&prices.prices[code],sourceDate:prices&&prices.priceDates&&prices.priceDates[code],source:'GET_PRICES'};
   const row=normalizeStockPoint(seriesId,code,current,history&&history.prices&&history.prices[code],tradingDate,official&&official.closes&&official.closes[code]);
   if(row)payload[seriesId]=row;else missing.push(seriesId);
  }
 }
 return {payload,missing:[...new Set(missing)],errors,receivedAt:options.receivedAt||new Date().toISOString(),range:{from,to}};
}
async function collectAndIngest(runtime,request,tradingDate,options={}){if(!runtime||typeof runtime.ingestBenchmarks!=='function')throw new Error('MarketBriefingRuntime unavailable');const result=await collect(request,tradingDate,options);const ingested=runtime.ingestBenchmarks(result.payload,{tradingDate,receivedAt:result.receivedAt},{returnResult:true});return {...result,observations:ingested.observations,state:ingested.state};}
const api={REQUEST_TYPES,KEY_MAP,STOCKS,KRX_FINAL_CHECKPOINTS,STOCK_OFFICIAL_CHECKPOINTS,latest,sourceFor,lookback,normalizeBenchmarkPoint,normalizeFxPoint,trustedStockClose,regularCloseObservedAt,normalizeStockPoint,collect,collectAndIngest};if(typeof module!=='undefined'&&module.exports)module.exports=api;global.MarketBriefingProviderCollector=api;
})(typeof globalThis!=='undefined'?globalThis:this);
