(function(global){
'use strict';
const MAP=Object.freeze({KOSPI:'KOSPI',KOSDAQ:'KOSDAQ',KOSPI200:'KOSPI200',K200_NIGHT:'K200_NIGHT',SP500:'SPX',NASDAQ100:'NDX',SOX:'SOX',VIX:'VIX',USDKRW:'USDKRW',SAMSUNG:'SAMSUNG',SKHYNIX:'SKHYNIX'});
const shared=global.MarketDataProvider||(typeof module!=='undefined'&&module.exports?require('./market_data_provider.js'):null);
function normalizeOne(key,item,meta={}){
 const seriesId=MAP[key]; if(!seriesId||!item)return null;
 const contract=shared.normalizeMarketDatum({...item,seriesId},{...meta,seriesId}); if(!contract.valid)return null;
 const source=contract.source;
 const delayed=Boolean(item.delayed||meta.delayed||source==='YAHOO_DELAYED');
 const explicitStatus=item.status||meta.status||null;
 const status=explicitStatus||(delayed?'DELAYED':'PARTIAL');
 const market=item.market||meta.market||((key==='KOSPI'||key==='KOSDAQ'||key==='KOSPI200'||key==='K200_NIGHT')?'KRX':key==='USDKRW'?'FX':'US');
 return {seriesId,tradingDate:contract.tradingDate,value:contract.value,market,session:contract.session,source,status,
  finality:contract.finality,observedAt:contract.observedAt,receivedAt:contract.receivedAt,
  timestampQuality:contract.timestampQuality,currency:contract.currency,sourceDate:contract.sourceDate,
  fallback:contract.fallback,quality:item.quality||meta.quality||null};
}
function normalizeMap(payload,meta={}){const rows=[];Object.keys(MAP).forEach(k=>{const r=normalizeOne(k,payload&&payload[k],meta);if(r)rows.push(r);});return rows;}
function ingest(masterApi,master,payload,meta={}){return normalizeMap(payload,meta).reduce((rows,row)=>masterApi.upsertObservation(rows,row),master||[]);}
const api={MAP,normalizeOne,normalizeMap,ingest};if(typeof module!=='undefined'&&module.exports)module.exports=api;global.MarketBriefingProviderNormalizer=api;
})(typeof globalThis!=='undefined'?globalThis:this);
