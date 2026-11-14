// Run the real web sync routine with a verified v2 Bootstrap and fake GAS.
// No network, production data, or deployment side effects.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {TextEncoder} from 'node:util';
const web=fs.readFileSync('src/web/features/settings/settings_sync.js','utf8');
const extract=name=>{
 const p=web.indexOf('function '+name+'('),start=web.slice(p-6,p)==='async '?p-6:p;
 const end=web.indexOf('\n}',start)+2;
 assert.ok(p>=0&&end>start,'missing '+name);
 return web.slice(start,end);
};
const names=['_normalizeSyncCode','_hasTradeFxMetadataProtocol',
 '_tradeV2PinnedBaseline','_tradeV2NormalizeCode','_tradeV2BrowserCanonical',
 '_tradeV2BrowserSha256','_prepareTradeV2SyncContract','_markTradeV2ReadbackConfirmed_','_recoverOutstandingTradeV2Receipt','_preflightTradeV2Receipt','syncTradesToGsheet'];
const url='https://gas.example/v2',generation=7;
const before={id:'tr_test00001',date:'2026-11-06',tradeType:'buy',
 acct:'US',name:'TEST',code:'005930',qty:10,price:209925,
 assetType:'주식',memo:'',priceRaw:155.5,fxRateAtBuy:1350};
const next={...before,acct:'ISA',memo:'edited'};
const baseline={targetUrl:url,generation,protocol:2,
 revision:'a'.repeat(64),trades:[before]};
const w={_tradeLedgerV2BaselineTargets:{[url]:baseline},
 _tradeFxMetadataTargets:{[url]:true}};
let remote=[before],readHash='',writes=[],legacyWrites=0,forceBadRead=false;
const recoveryRecords={};
const ctx=vm.createContext({window:w,crypto:webcrypto,TextEncoder,
 JSON,Array,Map,Set,Number,String,Date,Math,Uint8Array,
 GSHEET_API_URL:url,rawTrades:[next],STOCK_CODE:{TEST:'005930'},
 normalizeStockCode:v=>String(v||''),
 isGsheetPortfolioWriteReady:()=>true,
 getGsheetConnectionGeneration:()=>generation,
 isGsheetConnectionCurrent:(target,g)=>target===url&&g===generation,
 getEPByCode:()=>({code:'005930',name:'TEST',assetType:'주식'}),
 getEP:()=>({code:'005930',name:'TEST',assetType:'주식'}),
 getEPType:(ep,fallback)=>ep?.assetType||fallback,
 isCodeLessDirectFundTrade:()=>false,
 showToast:()=>{},_syncWarn:()=>{},
 _hasPortfolioReceiptProtocol:()=>false,
 _readPortfolioRecoveryReceipts:()=>recoveryRecords,
 _savePortfolioRecoveryReceipts:()=>true,
 syncIssuesToGsheet:async()=>{},
 requestGsheetFormJson:async(action,params)=>{
  legacyWrites++;return {status:'ok',saveState:'success',
    synced:JSON.parse(params.data).length,tradeFxMetadataVersion:1};
 },
 _requestPortfolioRecoveryWrite:async(action,params,opts)=>{
  writes.push({action,params,opts});
  recoveryRecords[url]={syncTradesV2:{action,id:'pr_test'+writes.length,
    attempted:true,completed:true,params:{...params}}};
  assert.equal(action,'syncTradesV2');
  assert.equal(opts.retry,0);
  assert.equal(opts.recoveryScope,'trade-v2:'+w._tradeLedgerV2BaselineTargets[url].revision);
  remote=JSON.parse(params.data);
  readHash=await ctx._tradeV2BrowserSha256(remote.slice().sort((a,b)=>
    String(a.date||'').localeCompare(String(b.date||'')))
    .map(ctx._tradeV2BrowserCanonical));
  return {status:'ok',receiptState:'COMPLETE',synced:remote.length,
    tradeLedgerProtocolVersion:2,ledgerRevision:readHash};
 },
 requestGsheetActionJson:async action=>{
  assert.equal(action,'getTrades');
  return {status:'ok',tradeLedgerProtocolVersion:2,
    ledgerRevision:forceBadRead?'wrong':readHash,trades:remote};
 }
});
vm.runInContext(names.map(extract).join('\n')
 +'\nglobalThis.save=syncTradesToGsheet;',ctx);
const success=await ctx.save({targetUrl:url,generation});
assert.equal(success.status,'ok',JSON.stringify(success));
assert.equal(success.tradeLedgerProtocolVersion,2);
assert.equal(writes.length,1);
assert.equal(legacyWrites,0);
assert.equal(JSON.parse(writes[0].params.intents)[0].type,'update');
assert.equal(JSON.parse(writes[0].params.data)[0].id,next.id);
assert.equal(w._tradeLedgerV2BaselineTargets[url].revision,readHash);
assert.equal(w._tradeLedgerV2BaselineTargets[url].trades[0].acct,'ISA');
// Implicit device-side omission must not become a remote FX deletion.
ctx.rawTrades=[{...next,id:'tr_new00002'}];
const deleted=await ctx.save({targetUrl:url,generation});
assert.equal(deleted.errorCode,'TRADE_DELETE_INTENT_REQUIRED');
assert.equal(writes.length,1);
// Explicit deletion of the last trade follows the one-use allowEmpty path.
ctx.rawTrades=[];
const explicit=await ctx.save({targetUrl:url,generation,allowEmpty:true});
assert.equal(explicit.status,'ok',JSON.stringify(explicit));
assert.equal(writes.length,2);
assert.equal(JSON.parse(writes[1].params.intents)[0].type,'delete');
assert.equal(w._tradeLedgerV2BaselineTargets[url].trades.length,0);
// An unverified post-write getTrades must not advance browser baseline.
const second={...next,id:'tr_created1'};
ctx.rawTrades=[second];
forceBadRead=true;
const failed=await ctx.save({targetUrl:url,generation});
assert.equal(failed.errorCode,'TRADE_V2_READBACK_UNVERIFIED');
assert.equal(w._tradeLedgerV2BaselineTargets[url].trades.length,0);
forceBadRead=false;
w._tradeLedgerV2BaselineTargets[url]=null;
const old=await ctx.save({targetUrl:url,generation});
assert.equal(old.status,'ok','9.284 fallback must retain legacy route');
assert.equal(legacyWrites,1);
assert.equal(writes.length,3);
console.log('WEB_TRADE_V2_REAL_SYNC_PASS '+JSON.stringify({
 v2Writes:3,legacyWrites,explicitDeletes:true,
 readbackFailClosed:true,productionWrites:0}));
// #734: two isolated browser devices against one CAS-enforcing synthetic GAS.
// This is a code-level regression only, NOT a PC/Android hardware or production
// receipt test. A stale mobile/PC edit must never overwrite a newer ledger.
const shared={
 trades:[{...before}],
 revision:await ctx._tradeV2BrowserSha256([ctx._tradeV2BrowserCanonical(before)]),
 commits:0
};
const seedRevision=shared.revision;
function createDevice(label) {
 const receipts={},deviceWindow={
  _tradeLedgerV2RequiredTargets:{[url]:true},
  _tradeFxMetadataTargets:{[url]:true},
  _tradeLedgerV2BaselineTargets:{[url]:{
   targetUrl:url,generation,protocol:2,revision:shared.revision,
   trades:shared.trades.map(t=>({...t}))
  }}
 };
 const metrics={attempts:0,reads:0,legacy:0,conflicts:0};
 const device=vm.createContext({
  window:deviceWindow,crypto:webcrypto,TextEncoder,
  JSON,Array,Map,Set,Number,String,Date,Math,Uint8Array,
  GSHEET_API_URL:url,rawTrades:shared.trades.map(t=>({...t})),
  STOCK_CODE:{TEST:'005930'},
  normalizeStockCode:v=>String(v||''),
  isGsheetPortfolioWriteReady:()=>true,
  getGsheetConnectionGeneration:()=>generation,
  isGsheetConnectionCurrent:(target,g)=>target===url&&g===generation,
  getEPByCode:()=>({code:'005930',name:'TEST',assetType:'주식'}),
  getEP:()=>({code:'005930',name:'TEST',assetType:'주식'}),
  getEPType:(ep,fallback)=>ep?.assetType||fallback,
  isCodeLessDirectFundTrade:()=>false,
  showToast:()=>{},_syncWarn:()=>{},
  _readPortfolioRecoveryReceipts:()=>receipts,
  _savePortfolioRecoveryReceipts:()=>true,
  _acknowledgePortfolioTradeV2Sync:()=>true,
  syncIssuesToGsheet:async()=>{},
  requestGsheetFormJson:async()=>{
   metrics.legacy++;throw Error('LEGACY_ROUTE_FORBIDDEN_ON_V2');
  },
  _requestPortfolioRecoveryWrite:async(action,params,opts)=>{
   metrics.attempts++;
   assert.equal(action,'syncTradesV2',label);
   assert.equal(opts.retry,0,label);
   assert.equal(params.tradeLedgerProtocolVersion,'2',label);
   // The synthetic server faithfully enforces expectedLedgerRevision
   // BEFORE any data mutation, like an atomic source CAS.
   if(params.expectedLedgerRevision!==shared.revision){
    metrics.conflicts++;
    return {status:'error',saveState:'failed',
     errorCode:'TRADE_V2_REVISION_CONFLICT'};
   }
   const after=JSON.parse(params.data);
   const digest=await device._tradeV2BrowserSha256(
    after.slice().sort((a,b)=>
     String(a.date||'').localeCompare(String(b.date||'')))
     .map(device._tradeV2BrowserCanonical));
   shared.trades=after.map(t=>({...t}));
   shared.revision=digest;
   shared.commits++;
   receipts[url]={syncTradesV2:{
    action,id:'pr_'+label+'_'+shared.commits,attempted:true,
    completed:true,params:{...params}
   }};
   return {status:'ok',receiptState:'COMPLETE',
    synced:after.length,tradeLedgerProtocolVersion:2,
    ledgerRevision:shared.revision};
  },
  requestGsheetActionJson:async action=>{
   assert.equal(action,'getTrades',label);
   metrics.reads++;
   return {status:'ok',tradeLedgerProtocolVersion:2,
    ledgerRevision:shared.revision,
    trades:shared.trades.map(t=>({...t}))};
  }
 });
 vm.runInContext(names.map(extract).join('\n')
  +'\nglobalThis.save=syncTradesToGsheet;',device);
 return {device,deviceWindow,metrics};
}
const pc=createDevice('pc'),mobile=createDevice('android');
pc.device.rawTrades=[{...before,memo:'PC edit'}];
const pcSaved=await pc.device.save({targetUrl:url,generation});
assert.equal(pcSaved.status,'ok',JSON.stringify(pcSaved));
assert.equal(pcSaved.ledgerRevision,shared.revision);
assert.equal(shared.commits,1);
const pcRevision=shared.revision;

// Android was opened before PC committed; its stale CAS MUST fail closed.
mobile.device.rawTrades=[{...before,memo:'Android stale edit'}];
const staleAndroid=await mobile.device.save({targetUrl:url,generation});
assert.equal(staleAndroid.errorCode,'TRADE_V2_REVISION_CONFLICT');
assert.equal(shared.commits,1,'stale Android cannot overwrite PC');
assert.equal(shared.trades[0].memo,'PC edit');
assert.equal(mobile.deviceWindow._tradeLedgerV2BaselineTargets[url].revision,
 seedRevision,'rejected device must not advance local revision');

// An explicit read-only reconnect/Bootstrap-equivalent on the second device
// supplies a verified new CAS. Do not treat this as an actual mobile UI test.
const pulled=await mobile.device.requestGsheetActionJson('getTrades');
assert.equal(pulled.ledgerRevision,pcRevision);
mobile.deviceWindow._tradeLedgerV2BaselineTargets[url]={
 targetUrl:url,generation,protocol:2,
 revision:pulled.ledgerRevision,trades:pulled.trades.map(t=>({...t}))
};
mobile.device.rawTrades=[{...pulled.trades[0],acct:'ISA',memo:'Android after pull'}];
const mobileSaved=await mobile.device.save({targetUrl:url,generation});
assert.equal(mobileSaved.status,'ok',JSON.stringify(mobileSaved));
assert.equal(shared.commits,2);
assert.equal(shared.trades[0].acct,'ISA');

// The first browser is now stale. It too must fail, without losing Android's edit.
pc.device.rawTrades=[{...pc.device.rawTrades[0],acct:'OTHER'}];
const stalePc=await pc.device.save({targetUrl:url,generation});
assert.equal(stalePc.errorCode,'TRADE_V2_REVISION_CONFLICT');
assert.equal(shared.commits,2);
assert.equal(shared.trades[0].memo,'Android after pull');
assert.equal(shared.trades[0].acct,'ISA');
assert.equal(pc.metrics.legacy+mobile.metrics.legacy,0,
 'v2 baseline failures must never silently downgrade to legacy writes');
assert.equal(pc.metrics.conflicts,1);
assert.equal(mobile.metrics.conflicts,1);
console.log('ISSUE734_TWO_DEVICE_CAS_SHADOW_PASS '+JSON.stringify({
 successfulCommits:shared.commits,staleRejections:2,
 remoteReadOnlyRebase:true,legacyWrites:0,realFinanceWrites:0,
 pcOrAndroidHardwareVerified:false
}));
