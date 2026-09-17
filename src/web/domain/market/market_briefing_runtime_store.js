(function(global){
'use strict';
const KEY='portfolio.marketBriefing.v1';
function empty(){return {version:1,observations:[],snapshots:[]};}
function parse(raw){try{const v=JSON.parse(raw);return v&&v.version===1&&Array.isArray(v.observations)&&Array.isArray(v.snapshots)?v:empty();}catch(_){return empty();}}
function load(storage){return parse(storage&&storage.getItem?storage.getItem(KEY):null);}
function save(storage,state){if(!storage||typeof storage.setItem!=='function')throw new Error('storage required');storage.setItem(KEY,JSON.stringify(state));return state;}
function mergeObservations(storage,masterApi,rows){const state=load(storage);for(const row of (Array.isArray(rows)?rows:[]))state.observations=masterApi.upsertObservation(state.observations,row);return save(storage,state);}
function mergeSnapshots(storage,snapshotApi,rows){const state=load(storage);for(const row of (Array.isArray(rows)?rows:[]))state.snapshots=snapshotApi.appendSnapshot(state.snapshots,row,{scenario:row.scenario});return save(storage,state);}
function ingestProviderPayload(storage,masterApi,normalizerApi,payload,meta){const state=load(storage);state.observations=normalizerApi.ingest(masterApi,state.observations,payload,meta);return save(storage,state);}
function checkpoint(storage,masterApi,snapshotApi,gateApi,tradingDate,name,seriesIds,options={}){
 const state=load(storage);const decision=gateApi.releaseDecision(masterApi,snapshotApi,state.observations,state.snapshots,tradingDate,name);
 if(!decision.publishable)return {state,decision,snapshot:null};
 const built=masterApi.buildBriefingSnapshot(state.observations,tradingDate,name,seriesIds||[]);
 state.snapshots=snapshotApi.appendSnapshot(state.snapshots,built,options);
 save(storage,state);return {state,decision,snapshot:snapshotApi.getSnapshot(state.snapshots,tradingDate,name)};
}
function bridge(storage,snapshotApi,tradingDate){const state=load(storage);return {morning:snapshotApi.getSnapshot(state.snapshots,tradingDate,'MORNING'),evening:snapshotApi.getSnapshot(state.snapshots,tradingDate,'EVENING'),priorEvening:snapshotApi.previousEveningContext(state.snapshots,tradingDate)};}
const api={KEY,empty,parse,load,save,mergeObservations,mergeSnapshots,ingestProviderPayload,checkpoint,bridge};if(typeof module!=='undefined'&&module.exports)module.exports=api;global.MarketBriefingRuntimeStore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
