(function(global){
'use strict';
function deps(){const d={master:global.MarketBriefingMaster,normalizer:global.MarketBriefingProviderNormalizer,snapshots:global.MarketBriefingSnapshotStore,gate:global.MarketBriefingOperationalGate,store:global.MarketBriefingRuntimeStore};for(const [k,v] of Object.entries(d))if(!v)throw new Error(`market briefing dependency missing: ${k}`);return d;}
function storage(){if(!global.localStorage)throw new Error('localStorage unavailable');return global.localStorage;}
function ingestBenchmarks(payload,meta={},options={}){const d=deps();const result=d.store.ingestProviderPayloadResult(storage(),d.master,d.normalizer,payload,meta);return options.returnResult?result:result.state;}
function mergeServerSnapshots(rows){const d=deps();return d.store.mergeSnapshots(storage(),d.snapshots,rows);}
function mergeServerObservations(rows){const d=deps();return d.store.mergeObservations(storage(),d.master,rows);}
function observationKey(row){return [row&&row.seriesId,row&&row.tradingDate,row&&row.session,row&&row.observedAt,row&&row.receivedAt].map(value=>String(value??'')).join('|');}
function assertObservationPersistence(response,count){
 if(!response||response.status!=='ok')throw new Error(String(response&&response.message||'MARKET_MASTER 저장 실패'));
 const saved=Number(response.saved),duplicates=Number(response.duplicates),rejected=Number(response.rejected);
 if(!Number.isFinite(saved)||!Number.isFinite(duplicates)||!Number.isFinite(rejected)||rejected!==0||saved+duplicates!==count)throw new Error(`MARKET_MASTER 부분 저장 실패: expected=${count} saved=${saved} duplicates=${duplicates} rejected=${rejected}`);
 return response;
}
async function syncServerMaster(getRequest,postRequest,tradingDate,options={}){
 if(typeof getRequest!=='function'||typeof postRequest!=='function')throw new Error('market briefing GAS request functions missing');
 const d=deps(),from=options.from||tradingDate,preSync=d.store.load(storage());
 const server=await getRequest('getMarketBriefingMaster',{from,to:tradingDate},{timeoutMs:options.timeoutMs||45000,retry:0});
 const serverObservations=Array.isArray(server&&server.observations)?server.observations:[],serverKeys=new Set(serverObservations.map(row=>observationKey(d.master.normalizeObservation(row))));
 const inSyncRange=row=>String(row&&row.tradingDate||'')>=from&&String(row&&row.tradingDate||'')<=tradingDate;
 const pendingKeys=new Set(preSync.observations.filter(row=>inSyncRange(row)&&!serverKeys.has(observationKey(row))).map(observationKey));
 mergeServerObservations(serverObservations);
 let snapshotSync={status:'ok',loaded:0,invalid:0};
 try{const snap=await getRequest('getMarketBriefingSnapshots',{from,to:tradingDate},{timeoutMs:options.timeoutMs||45000,retry:0});if(!snap||snap.status!=='ok')throw new Error(String(snap&&snap.message||'MARKET_SNAPSHOTS 조회 실패'));const rows=Array.isArray(snap.snapshots)?snap.snapshots:[];mergeServerSnapshots(rows);snapshotSync={status:'ok',loaded:rows.length,invalid:Number(snap.invalid)||0};}catch(error){snapshotSync={status:'error',loaded:0,invalid:0,message:String(error&&error.message||error)};}
 const hydrated=d.store.load(storage());
 try{
  const result=await collectExistingProvider(getRequest,tradingDate,options);
  const collectedKeys=new Set((result.observations||[]).filter(inSyncRange).map(observationKey)),postKeys=new Set([...pendingKeys,...collectedKeys]);
  for(const key of serverKeys)postKeys.delete(key);
  const state=d.store.load(storage()),rows=state.observations.filter(row=>inSyncRange(row)&&postKeys.has(observationKey(row)));
  let persistence=null;
  if(rows.length){persistence=await postRequest('appendMarketBriefingObservations',{data:JSON.stringify(rows)},{timeoutMs:options.timeoutMs||45000,retry:0});assertObservationPersistence(persistence,rows.length);}
  return {...result,rows,persistence,snapshotSync};
 }catch(error){d.store.save(storage(),hydrated);throw error;}
}
async function collectExistingProvider(request,tradingDate,options={}){const collector=global.MarketBriefingProviderCollector;if(!collector)throw new Error('MarketBriefingProviderCollector unavailable');return collector.collectAndIngest(api,request,tradingDate,options);}
async function ingestKisNightFrame(postRequest,rawFrame,registry,meta={}){
 const wire=global.MarketBriefingKisWire,ingest=global.MarketBriefingKisIngest,adapters=global.MarketBriefingAdapters;
 if(!wire||!ingest||!adapters)throw new Error('KIS night ingestion dependency missing');
 const result=ingest.k200NightObservation(wire,adapters,rawFrame,registry,meta);
 if(result.status!=='VALID')return {...result,persistence:null};
 if(typeof postRequest!=='function')throw new Error('market briefing GAS POST function missing');
 const persistence=await postRequest('appendMarketBriefingObservations',{data:JSON.stringify([result.observation])},{timeoutMs:meta.timeoutMs||45000,retry:0});
 assertObservationPersistence(persistence,1);
 const d=deps();d.store.mergeObservations(storage(),d.master,[result.observation]);
 return {...result,persistence};
}
async function releaseAndPersist(postRequest,tradingDate,checkpoint,seriesIds,options={}){const out=release(tradingDate,checkpoint,seriesIds,options);if(!out.snapshot)return {...out,persistence:null};if(typeof postRequest!=='function')throw new Error('market briefing snapshot POST function missing');const persistence=await postRequest('appendMarketBriefingSnapshot',{data:JSON.stringify(out.snapshot)},{timeoutMs:options.timeoutMs||45000,retry:0});if(!persistence||persistence.status!=='ok')throw new Error(String(persistence&&persistence.message||'MARKET_SNAPSHOTS 저장 실패'));return {...out,persistence};}
function release(tradingDate,checkpoint,seriesIds,options={}){const d=deps();return d.store.checkpoint(storage(),d.master,d.snapshots,d.gate,tradingDate,checkpoint,seriesIds,options);}
function continuity(tradingDate){const d=deps();return d.store.bridge(storage(),d.snapshots,tradingDate);}
function readiness(tradingDate,checkpoint){const d=deps(),state=d.store.load(storage());return d.gate.releaseDecision(d.master,d.snapshots,state.observations,state.snapshots,tradingDate,checkpoint);}
function hasNightFinal(tradingDate){const d=deps(),state=d.store.load(storage()),row=d.master.selectAt(state.observations,'K200_NIGHT',d.master.checkpointAt(tradingDate,'NIGHT_FINAL'),tradingDate,'NIGHT_FINAL');return !!row&&row.tradingDate===tradingDate&&row.session==='NIGHT'&&row.status==='FINAL'&&row.finality==='NIGHT_FINAL';}
const api={ingestBenchmarks,mergeServerObservations,mergeServerSnapshots,syncServerMaster,collectExistingProvider,ingestKisNightFrame,release,releaseAndPersist,continuity,readiness,hasNightFinal};if(typeof module!=='undefined'&&module.exports)module.exports=api;global.MarketBriefingRuntime=api;
})(typeof globalThis!=='undefined'?globalThis:this);
