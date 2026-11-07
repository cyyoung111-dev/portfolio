// A one-off failure to persist terminal readback proof must not strand CAS.
// Actual web sync+recovery+dirty-ack code, all remote/storage in memory.
// The approved GAS and the real Google Sheet are not modified.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import {TextEncoder} from 'node:util';
const sync=fs.readFileSync('src/web/features/settings/settings_sync.js','utf8');
const data=fs.readFileSync('src/web/domain/portfolio/data.js','utf8');
const get=(src,name)=>{
 const i=src.indexOf('function '+name+'('),j=src.indexOf('\n}',i);
 assert(i>=0&&j>i,'missing '+name);
 return src.slice(src.slice(i-6,i)==='async '?i-6:i,j+2);
};
const url='https://gas.invalid/v2',generation=11;
const old={id:'tr_testrun01',date:'2026-11-06',tradeType:'buy',
 acct:'US',name:'TEST',code:'005930',qty:2,price:100,assetType:'주식',memo:''};
const saved={...old,qty:3},later={...old,qty:4};
const canon=t=>[t.id,t.date,t.tradeType,t.acct,t.name,t.code,
 t.qty,t.price,t.assetType,t.memo||'','','','',''];
const rev=t=>createHash('sha256').update(JSON.stringify([canon(t)])).digest('hex');
const revOld=rev(old),revNew=rev(saved),revLater=rev(later);
let remote=[old],attempts=0,failTerminalOnce=true,terminalFailures=0,
 durableDirty={},liveJournal={},durableReceipts={};
liveJournal[url]={target:url,epoch:7,
 tradeV2Baseline:{targetUrl:url,protocol:2,revision:revOld,trades:[old]},
 tradeV2DeleteIds:[],trades:[saved],holdings:[],fundDirect:{}};
const persistDirty=()=>{durableDirty=JSON.parse(JSON.stringify(liveJournal));};
persistDirty();
const window={_tradeLedgerV2BaselineTargets:{[url]:{
 targetUrl:url,protocol:2,generation,revision:revOld,trades:[old]
}},_tradeLedgerV2RequiredTargets:{[url]:true},
 _tradeFxMetadataTargets:{[url]:true}};
const ctx=vm.createContext({window,JSON,Set,Map,Array,Date,String,Number,
 Math,Uint8Array,TextEncoder,crypto:webcrypto,console,
 GSHEET_API_URL:url,rawTrades:[saved],rawHoldings:[],fundDirect:{},
 STOCK_CODE:{TEST:'005930'},normalizeStockCode:x=>String(x||''),
 getEPByCode:()=>({code:'005930',name:'TEST',assetType:'주식'}),
 getEP:()=>({code:'005930',name:'TEST',assetType:'주식'}),
 getEPType:(ep,fallback)=>ep?.assetType||fallback,
 isCodeLessDirectFundTrade:()=>false,
 isGsheetPortfolioWriteReady:()=>true,
 getGsheetConnectionGeneration:()=>generation,
 isGsheetConnectionCurrent:(t,g)=>t===url&&g===generation,
 _syncWarn:()=>{},
 _portfolioRemoteDirtyByTarget:liveJournal,
 PORTFOLIO_REMOTE_DIRTY_KEY:'dirty-fixture',
 lsGet:(key,defaultValue)=>key==='dirty-fixture'?durableDirty:defaultValue,
 _persistPortfolioRemoteDirtyMap:persistDirty,
 _readPortfolioRecoveryReceipts:()=>JSON.parse(JSON.stringify(durableReceipts)),
 _savePortfolioRecoveryReceipts:records=>{
  const rr=records[url]?.syncTradesV2;
  if(rr?.readbackConfirmedRevision&&failTerminalOnce){
   failTerminalOnce=false;terminalFailures++;return false;
  }
  durableReceipts=JSON.parse(JSON.stringify(records));
  return true;
 },
 requestGsheetFormJson:async(action,params)=>{
  assert.equal(action,'getPortfolioSyncReceipt');
  const receipt=durableReceipts[url].syncTradesV2;
  assert.equal(params.operationId,receipt.id);
  return {status:'ok',kind:'syncTradesV2',
    operationId:receipt.id,receiptState:'COMPLETE'};
 },
 requestGsheetActionJson:async action=>{
  assert.equal(action,'getTrades');
  return {status:'ok',tradeLedgerProtocolVersion:2,
   ledgerRevision:rev(remote[0]),trades:remote};
 },
 _requestPortfolioRecoveryWrite:async(action,params)=>{
  assert.equal(action,'syncTradesV2');
  if(attempts===0)assert.equal(params.expectedLedgerRevision,revOld);
  else assert.equal(params.expectedLedgerRevision,revNew);
  const written=JSON.parse(params.data);
  attempts++;remote=written;
  const id='pr_test'+String(attempts).padStart(18,'0');
  durableReceipts[url]={syncTradesV2:{
   action,attempted:true,completed:true,id,params:{...params}
  }};
  return {status:'ok',receiptState:'COMPLETE',
   tradeLedgerProtocolVersion:2,ledgerRevision:rev(remote[0])};
 }
});
const helpers=['_normalizeSyncCode','_hasTradeFxMetadataProtocol',
 '_tradeV2PinnedBaseline','_tradeV2NormalizeCode','_tradeV2BrowserCanonical',
 '_tradeV2BrowserSha256','_prepareTradeV2SyncContract',
 '_markTradeV2ReadbackConfirmed_','_recoverOutstandingTradeV2Receipt',
 'syncTradesToGsheet'];
vm.runInContext([
 ...helpers.map(n=>get(sync,n)),
 get(data,'_acknowledgePortfolioTradeV2Sync')].join('\n'),ctx);
const first=await ctx.syncTradesToGsheet({targetUrl:url,generation});
assert.equal(first.errorCode,'TRADE_V2_READBACK_RECEIPT_PERSIST_FAILED');
assert.equal(attempts,1);
assert.equal(terminalFailures,1);
assert.equal(window._tradeLedgerV2BaselineTargets[url].revision,revNew,
 'in-memory baseline must advance with durable dirty ACK');
assert.equal(durableDirty[url].tradeV2Baseline.revision,revNew);
assert.equal(durableReceipts[url].syncTradesV2.readbackConfirmedRevision,
 undefined,'the failed marker must not exist in persisted receipts');
// Next call: same stored operation, same original operationId, no new writer.
const recovered=await ctx._recoverOutstandingTradeV2Receipt(
 url,generation,window._tradeLedgerV2BaselineTargets[url]);
assert.equal(recovered.ok,true,JSON.stringify(recovered));
assert.equal(recovered.baseline.revision,revNew);
assert.equal(attempts,1);
assert.equal(durableReceipts[url].syncTradesV2.readbackConfirmedRevision,revNew);
// A subsequent user edit uses fresh CAS, never the first revision.
ctx.rawTrades=[later];
const second=await ctx.syncTradesToGsheet({targetUrl:url,generation});
assert.equal(second.status,'ok',JSON.stringify(second));
assert.equal(attempts,2);
assert.equal(durableDirty[url].tradeV2Baseline.revision,revLater);
assert.equal(window._tradeLedgerV2BaselineTargets[url].revision,revLater);
assert.equal(durableReceipts[url].syncTradesV2.readbackConfirmedRevision,
 revLater);
console.log('WEB_TRADE_V2_TERMINAL_PERSIST_RECOVER_PASS '+JSON.stringify({
 oneOffMarkerFailure:true,idempotentRecovery:true,
 subsequentCasFresh:true,realSheetWrites:0}));
