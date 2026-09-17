(function(global){
'use strict';
const MAP=Object.freeze({KOSPI:'KOSPI',KOSDAQ:'KOSDAQ',KOSPI200:'KOSPI200',SP500:'SPX',NASDAQ100:'NDX',SOX:'SOX',VIX:'VIX',USDKRW:'USDKRW'});
function iso(v){return v&&Number.isFinite(Date.parse(v))?v:null;}
function number(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function normalizeOne(key,item,meta={}){
 const seriesId=MAP[key]; if(!seriesId||!item)return null;
 const value=number(item.value??item.price??item.close??item.current); if(value==null)return null;
 const observedAt=iso(item.observedAt||item.timestamp||item.dateTime||null);
 const receivedAt=iso(meta.receivedAt)||new Date().toISOString();
 const source=item.source||meta.source||'UNKNOWN';
 const delayed=Boolean(item.delayed||meta.delayed||source==='YAHOO_DELAYED');
 return {seriesId,tradingDate:meta.tradingDate,value,market:meta.market||((key==='KOSPI'||key==='KOSDAQ'||key==='KOSPI200')?'KRX':'US'),session:meta.session||'REGULAR',source,status:meta.status||(delayed?'DELAYED':'FINAL'),observedAt,receivedAt,quality:item.quality||meta.quality||null};
}
function normalizeMap(payload,meta={}){
 const rows=[]; Object.keys(MAP).forEach(k=>{const r=normalizeOne(k,payload&&payload[k],meta);if(r)rows.push(r);}); return rows;
}
function ingest(masterApi,master,payload,meta={}){
 return normalizeMap(payload,meta).reduce((rows,row)=>masterApi.upsertObservation(rows,row),master||[]);
}
const api={MAP,normalizeOne,normalizeMap,ingest};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
global.MarketBriefingProviderNormalizer=api;
})(typeof globalThis!=='undefined'?globalThis:this);
