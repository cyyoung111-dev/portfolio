(function(global){
'use strict';
function semanticIndex(schema,name){if(!schema||!schema.fields)return -1;return schema.fields.indexOf(name);}
function decodeNamed(frame,schema){
 if(!frame||frame.status!=='VALID')return {status:'QUARANTINED',error:frame&&frame.error||'INVALID_FRAME'};
 if(!schema||!Array.isArray(schema.fields)||schema.fields.length!==frame.fields.length)return {status:'QUARANTINED',error:'SEMANTIC_SCHEMA_MISSING'};
 const values={};schema.fields.forEach((name,i)=>{if(name)values[name]=frame.fields[i];});
 return {status:'VALID',values};
}
function numberField(values,names){for(const name of names){const n=Number(String(values[name]??'').replace(/,/g,''));if(Number.isFinite(n))return n;}return null;}
function k200NightObservation(wire,adapters,raw,registry,meta){
 if(!wire||!adapters)throw new Error('KIS wire/adapters required');
 const frame=wire.validateFrame(raw,registry);if(frame.status!=='VALID')return {status:'QUARANTINED',frame};
 if(frame.trId!==wire.TR.K200_NIGHT_TRADE)return {status:'QUARANTINED',error:'UNSUPPORTED_TR',frame};
 const schema=registry[frame.trId],decoded=decodeNamed(frame,schema);if(decoded.status!=='VALID')return {...decoded,frame};
 const price=numberField(decoded.values,['FUTS_PRPR','STCK_PRPR','PRICE','currentPrice']);
 if(!(price>0))return {status:'QUARANTINED',error:'PRICE_FIELD_MISSING',frame,decoded};
 const observation=adapters.nightFutureObservation(price,{tradingDate:meta.tradingDate,source:'KIS',status:meta.status||'LIVE',finality:meta.finality||null,observedAt:meta.observedAt||null,receivedAt:meta.receivedAt,quality:meta.quality||'WIRE_VALIDATED'});
 return {status:'VALID',frame,decoded,observation};
}
const api={semanticIndex,decodeNamed,numberField,k200NightObservation};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
global.MarketBriefingKisIngest=api;
})(typeof globalThis!=='undefined'?globalThis:this);
