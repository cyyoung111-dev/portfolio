// The same sync call can recover an old DELETE ACK and must not reuse
// the stale deletion option captured before the recovery advanced dirty.
// Actual web functions in VM; all remote/store operations are mocked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import {TextEncoder} from 'node:util';
const sync=fs.readFileSync('src/web/features/settings/settings_sync.js','utf8');
const data=fs.readFileSync('src/web/domain/portfolio/data.js','utf8');
function source(src,name){
 const start=src.indexOf('function '+name+'('),end=src.indexOf('\n}',start);
 assert(start>=0&&end>start,name);
 return src.slice(src.slice(start-6,start)==='async '?start-6:start,end+2);
}
const url='https://gas.test/v2',generation=7;
const removed={id:'tr_removed01',date:'2026-11-05',tradeType:'buy',
 acct:'US',name:'US_TEST',code:'005930',qty:1,price:100,assetType:'주식'};
const kept={id:'tr_kept0001',date:'2026-11-06',tradeType:'buy',
 acct:'US',name:'US_TEST',code:'005930',qty:2,price:100,assetType:'주식'};
const canon=t=>[String(t.id),t.date,t.tradeType,t.acct,t.name,t.code,
 t.qty,t.price,t.assetType,'','','','',''];
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const rev0=sha([canon(removed),canon(kept)]),rev1=sha([canon(kept)]);
const baseline={targetUrl:url,generation,protocol:2,revision:rev0,
 trades:[removed,kept]};
const receipt={action:'syncTradesV2',attempted:true,completed:false,
 id:'pr_partial001234567890',
 params:{tradeLedgerProtocolVersion:'2',expectedLedgerRevision:rev0,
  data:JSON.stringify([kept]),intents:JSON.stringify([{
   type:'delete',id:removed.id,beforeHash:sha(canon(removed))
  }]),explicitEmpty:'',rebuildFrom:''}};
const store={[url]:{syncTradesV2:receipt}};
let durableDirty,networkWrites=0,lastIntent;
const dirty={[url]:{target:url,epoch:1,tradeV2DeleteIds:[removed.id],
 tradeV2Baseline:{targetUrl:url,protocol:2,revision:rev0,
 trades:[removed,kept]},trades:[kept],holdings:[],fundDirect:{}}};
const browser={_tradeLedgerV2BaselineTargets:{[url]:baseline},
 _tradeLedgerV2RequiredTargets:{[url]:true},_tradeFxMetadataTargets:{[url]:true}};
const ctx=vm.createContext({window:browser,crypto:webcrypto,TextEncoder,
 JSON,Map,Set,String,Number,Date,Math,Uint8Array,Array,
 GSHEET_API_URL:url,rawTrades:[kept],rawHoldings:[],fundDirect:{},
 STOCK_CODE:{US_TEST:'005930'},
 normalizeStockCode:x=>String(x||''),
 getEPByCode:()=>({code:'005930',name:'US_TEST',assetType:'주식'}),
 getEP:()=>({code:'005930',name:'US_TEST',assetType:'주식'}),
 getEPType:(ep,fallback)=>ep?.assetType||fallback,
 isCodeLessDirectFundTrade:()=>false,
 isGsheetPortfolioWriteReady:()=>true,
 getGsheetConnectionGeneration:()=>generation,
 isGsheetConnectionCurrent:(target,g)=>target===url&&g===generation,
 _syncWarn:()=>{},
 _readPortfolioRecoveryReceipts:()=>store,
 _savePortfolioRecoveryReceipts:()=>true,
 _portfolioRemoteDirtyByTarget:dirty,
 _getPortfolioRemoteDirty:()=>dirty[url],
 PORTFOLIO_REMOTE_DIRTY_KEY:'dirty-fixture',
 lsGet:()=>durableDirty,
 _persistPortfolioRemoteDirtyMap:()=>{
  durableDirty=JSON.parse(JSON.stringify(dirty));
 },
 requestGsheetFormJson:async(action,params)=>{
  assert.equal(action,'getPortfolioSyncReceipt');
  assert.equal(params.operationId,receipt.id);
  return {status:'ok',kind:'syncTradesV2',operationId:receipt.id,
    receiptState:'COMPLETE'};
 },
 requestGsheetActionJson:async action=>{
  assert.equal(action,'getTrades');
  return {status:'ok',tradeLedgerProtocolVersion:2,ledgerRevision:rev1,
    trades:[kept]};
 },
 _requestPortfolioRecoveryWrite:async(action,params)=>{
  assert.equal(action,'syncTradesV2');
  assert.equal(params.expectedLedgerRevision,rev1);
  lastIntent=JSON.parse(params.intents);
  networkWrites++;
  store[url].syncTradesV2={action,id:'pr_followup0012345678',
    attempted:true,completed:true,params:{...params}};
  return {status:'ok',receiptState:'COMPLETE',
    tradeLedgerProtocolVersion:2,ledgerRevision:rev1};
 }
});
const funcs=['_normalizeSyncCode','_hasTradeFxMetadataProtocol',
 '_tradeV2PinnedBaseline','_tradeV2NormalizeCode',
 '_tradeV2BrowserCanonical','_tradeV2BrowserSha256',
 '_prepareTradeV2SyncContract','_markTradeV2ReadbackConfirmed_',
 '_recoverOutstandingTradeV2Receipt','_preflightTradeV2Receipt','syncTradesToGsheet'];
vm.runInContext(funcs.map(n=>source(sync,n)).join('\n')+'\n'
 +source(data,'_acknowledgePortfolioTradeV2Sync'),ctx);
const stale=[removed.id];
const result=await ctx.syncTradesToGsheet({targetUrl:url,generation,
 recoveryWrite:true,tradesOverride:[kept],tradeV2DeleteIds:stale});
assert.equal(result?.status,'ok',JSON.stringify(result));
assert.equal(networkWrites,1);
assert.deepEqual([...lastIntent],[],'already deleted ID must not reappear');
assert.deepEqual(stale,[removed.id],'caller stale array remains old as test precondition');
assert.deepEqual([...dirty[url].tradeV2DeleteIds],[]);
assert.equal(durableDirty[url].tradeV2Baseline.revision,rev1);
assert.equal(store[url].syncTradesV2.readbackConfirmedRevision,rev1);
assert.equal(browser._tradeLedgerV2BaselineTargets[url].revision,rev1);
console.log('WEB_V2_RECOVERED_DELETE_REUSE_PASS '+JSON.stringify({
 recoveryConsumedOldDelete:true,staleOptionsIgnored:true,
 duplicateDeleteWrites:0,productionWrites:0}));
