(function(global){
'use strict';
function deps(){const d={master:global.MarketBriefingMaster,normalizer:global.MarketBriefingProviderNormalizer,snapshots:global.MarketBriefingSnapshotStore,gate:global.MarketBriefingOperationalGate,store:global.MarketBriefingRuntimeStore};for(const [k,v] of Object.entries(d))if(!v)throw new Error(`market briefing dependency missing: ${k}`);return d;}
function storage(){if(!global.localStorage)throw new Error('localStorage unavailable');return global.localStorage;}
function ingestBenchmarks(payload,meta={}){const d=deps();return d.store.ingestProviderPayload(storage(),d.master,d.normalizer,payload,meta);}
function mergeServerObservations(rows){const d=deps();return d.store.mergeObservations(storage(),d.master,rows);}
async function syncServerMaster(getRequest,postRequest,tradingDate,options={}){if(typeof getRequest!=='function'||typeof postRequest!=='function')throw new Error('market briefing GAS request functions missing');const from=options.from||tradingDate;const server=await getRequest('getMarketBriefingMaster',{from,to:tradingDate},{timeoutMs:options.timeoutMs||45000,retry:0});mergeServerObservations(server&&server.observations);const result=await collectExistingProvider(getRequest,tradingDate,options);if(result.rows&&result.rows.length)await postRequest('appendMarketBriefingObservations',{data:JSON.stringify(result.rows)},{timeoutMs:options.timeoutMs||45000,retry:0});return result;}
async function collectExistingProvider(request,tradingDate,options={}){const collector=global.MarketBriefingProviderCollector;if(!collector)throw new Error('MarketBriefingProviderCollector unavailable');return collector.collectAndIngest(api,request,tradingDate,options);}
function release(tradingDate,checkpoint,seriesIds,options={}){const d=deps();return d.store.checkpoint(storage(),d.master,d.snapshots,d.gate,tradingDate,checkpoint,seriesIds,options);}
function continuity(tradingDate){const d=deps();return d.store.bridge(storage(),d.snapshots,tradingDate);}
function readiness(tradingDate,checkpoint){const d=deps(),state=d.store.load(storage());return d.gate.releaseDecision(d.master,d.snapshots,state.observations,state.snapshots,tradingDate,checkpoint);}
const api={ingestBenchmarks,mergeServerObservations,syncServerMaster,collectExistingProvider,release,continuity,readiness};if(typeof module!=='undefined'&&module.exports)module.exports=api;global.MarketBriefingRuntime=api;
})(typeof globalThis!=='undefined'?globalThis:this);
