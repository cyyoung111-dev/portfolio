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
 '_tradeV2BrowserSha256','_prepareTradeV2SyncContract','syncTradesToGsheet'];
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
 syncIssuesToGsheet:async()=>{},
 requestGsheetFormJson:async(action,params)=>{
  legacyWrites++;return {status:'ok',saveState:'success',
    synced:JSON.parse(params.data).length,tradeFxMetadataVersion:1};
 },
 _requestPortfolioRecoveryWrite:async(action,params,opts)=>{
  writes.push({action,params,opts});
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
