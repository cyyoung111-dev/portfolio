(function(global){
'use strict';
const MAP=Object.freeze({KOSPI:'KOSPI',KOSDAQ:'KOSDAQ',KOSPI200:'KOSPI200',SP500:'SPX',NASDAQ100:'NDX',SOX:'SOX',VIX:'VIX',USDKRW:'USDKRW'});
function iso(v){return v&&Number.isFinite(Date.parse(v))?v:null;}
function number(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function normalizeOne(key,item,meta={}){
 const seriesId=MAP[key]; if(!seriesId||!item)return null;
 const value=number(item.value??item.price??item.close??item.current); if(value==null)return null;
 const observedAt=iso(item.observedAt||item.timestamp||item.dateTime||null);
 const receivedAt=iso(item.receivedAt)||iso(meta.receivedAt)||new Date().toISOString();
 const source=item.source||meta.source||'UNKNOWN';
 const delayed=Boolean(item.delayed||meta.delayed||source==='YAHOO_DELAYED');
 const explicitStatus=item.status||meta.status||null;
 const status=explicitStatus||(delayed?'DELAYED':'PARTIAL');
 const tradingDate=String(item.tradingDate||item.marketDate||item.date||meta.tradingDate||'').slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(tradingDate))return null;
 const market=item.market||meta.market||((key==='KOSPI'||key==='KOSDAQ'||key==='KOSPI200')?'KRX':key==='USDKRW'?'FX':'US');
 return {seriesId,tradingDate,value,market,session:item.session||meta.session||'UNKNOWN',source,status,observedAt,receivedAt,quality:item.quality||meta.quality||null};
}
function normalizeMap(payload,meta={}){const rows=[];Object.keys(MAP).forEach(k=>{const r=normalizeOne(k,payload&&payload[k],meta);if(r)rows.push(r);});return rows;}
function ingest(masterApi,master,payload,meta={}){return normalizeMap(payload,meta).reduce((rows,row)=>masterApi.upsertObservation(rows,row),master||[]);}
const api={MAP,normalizeOne,normalizeMap,ingest};if(typeof module!=='undefined'&&module.exports)module.exports=api;global.MarketBriefingProviderNormalizer=api;
})(typeof globalThis!=='undefined'?globalThis:this);
