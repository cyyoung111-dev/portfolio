// Codex P2: a lost ACK must be rehydrated before a later mutation's CAS.
// Pure VM fixture for actual web functions; live GAS/Sheets writes = 0.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import {TextEncoder} from 'node:util';
const sync=fs.readFileSync('src/web/features/settings/settings_sync.js','utf8');
const get=name=>{
 const start=sync.indexOf('function '+name+'('),end=sync.indexOf('\n}',start);
 assert(start>=0&&end>start,name+' missing');
 return sync.slice(sync.slice(start-6,start)==='async '?start-6:start,end+2);
};
const funcs=['_normalizeSyncCode','_hasTradeFxMetadataProtocol',
 '_tradeV2PinnedBaseline','_tradeV2NormalizeCode','_tradeV2BrowserCanonical',
 '_tradeV2BrowserSha256','_prepareTradeV2SyncContract',
 '_recoverOutstandingTradeV2Receipt','syncTradesToGsheet'];
const url='https://test-gas.invalid/v2',generation=7;
const original={id:'tr_old000001',date:'2026-11-06',tradeType:'buy',
 acct:'US',name:'TEST',code:'005930',qty:10,price:100,assetType:'주식',memo:''};
const saved={...original,qty:20};
const edited={...original,qty:30};
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canon=t=>[String(t.id||''),t.date,t.tradeType,t.acct,t.name,t.code,
 Number(t.qty),Number(t.price),t.assetType,t.memo||'','','','',''];
const rev10=sha([canon(original)]),rev20=sha([canon(saved)]),rev30=sha([canon(edited)]);
const receipt={action:'syncTradesV2',scope:'trade-v2:'+rev10,attempted:true,
 completed:false,id:'pr_lostack01234567890123',
 params:{tradeLedgerProtocolVersion:'2',expectedLedgerRevision:rev10,
  data:JSON.stringify([saved]),intents:JSON.stringify([{
   type:'update',id:original.id,beforeHash:sha(canon(original))
  }]),explicitEmpty:'',rebuildFrom:''}};
let remote=[saved],receiptState='COMPLETE',newWrites=0,receiptReads=0,
 oldRevRecovered=false,storagePersisted=0,legacyWrites=0;
const targetStore={[url]:{syncTradesV2:receipt}};
const browser={_tradeLedgerV2BaselineTargets:{[url]:{
 targetUrl:url,generation,protocol:2,revision:rev10,trades:[original]
}},_tradeLedgerV2RequiredTargets:{[url]:true},
 _tradeFxMetadataTargets:{[url]:true}};
const ctx=vm.createContext({window:browser,crypto:webcrypto,TextEncoder,
 Array,Set,Map,JSON,Number,String,Date,Math,Uint8Array,
 GSHEET_API_URL:url,rawTrades:[edited],STOCK_CODE:{TEST:'005930'},
 getGsheetConnectionGeneration:()=>generation,
 isGsheetConnectionCurrent:(dest,gen)=>dest===url&&gen===generation,
 isGsheetPortfolioWriteReady:()=>true,
 normalizeStockCode:v=>String(v||''),
 getEPByCode:()=>({name:'TEST',code:'005930',assetType:'주식'}),
 getEP:()=>({name:'TEST',code:'005930',assetType:'주식'}),
 getEPType:(x,fallback)=>x?.assetType||fallback,
 isCodeLessDirectFundTrade:()=>false,
 showToast:()=>{},_syncWarn:()=>{},
 _readPortfolioRecoveryReceipts:()=>targetStore,
 _savePortfolioRecoveryReceipts:()=>{storagePersisted++;return true},
 _acknowledgePortfolioTradeV2Sync:()=>{oldRevRecovered=true;return true},
 requestGsheetFormJson:async(action,params)=>{
  if(action==='getPortfolioSyncReceipt'){
   receiptReads++;
   assert.equal(params.operationId,receipt.id);
   assert.equal(params.expectedLedgerRevision,rev10);
   return {status:'ok',receiptState,operationId:receipt.id,kind:'syncTradesV2'};
  }
  legacyWrites++;
  return {status:'error',errorCode:'UNEXPECTED_LEGACY_WRITER'};
 },
 requestGsheetActionJson:async action=>{
  assert.equal(action,'getTrades');
  const data=remote;
  return {status:'ok',tradeLedgerProtocolVersion:2,
   ledgerRevision:data[0].qty===20?rev20:rev30,trades:data};
 },
 _requestPortfolioRecoveryWrite:async(action,params)=>{
  assert.equal(action,'syncTradesV2');
  assert.equal(params.expectedLedgerRevision,rev20,
   'must advance baseline after ACK recovery before later CAS');
  const intents=JSON.parse(params.intents);
  assert.equal(intents.length,1);
  assert.equal(intents[0].beforeHash,sha(canon(saved)));
  newWrites++;
  remote=[edited];
  return {status:'ok',receiptState:'COMPLETE',saveState:'success',
   tradeLedgerProtocolVersion:2,ledgerRevision:rev30};
 },
 syncIssuesToGsheet:async()=>{}
});
vm.runInContext(funcs.map(get).join('\n')+
 '\nglobalThis.save=syncTradesToGsheet;',ctx);
const result=await ctx.save({targetUrl:url,generation});
assert.equal(result.status,'ok',JSON.stringify(result));
assert.equal(newWrites,1);
assert.equal(legacyWrites,0);
assert.equal(receiptReads,1);
assert.equal(oldRevRecovered,true);
assert.equal(receipt.completed,true);
assert.equal(browser._tradeLedgerV2BaselineTargets[url].revision,rev30);
assert.ok(storagePersisted>=1);
const prior=browser._tradeLedgerV2BaselineTargets[url];
// A PARTIAL prior receipt must block a new CAS, never create a FAILED write.
receipt.completed=false;
receiptState='PARTIAL';
browser._tradeLedgerV2BaselineTargets[url]={
 targetUrl:url,generation,protocol:2,revision:rev10,trades:[original]};
remote=[saved];
ctx.rawTrades=[edited];
const blocked=await ctx.save({targetUrl:url,generation});
assert.equal(blocked.errorCode,'TRADE_V2_RECEIPT_PARTIAL');
assert.equal(newWrites,1,'no second mutation while first is PARTIAL');
assert.equal(legacyWrites,0);
browser._tradeLedgerV2BaselineTargets[url]=null;
const downgrade=await ctx.save({targetUrl:url,generation});
assert.equal(downgrade.errorCode,'TRADE_V2_BASELINE_REQUIRED');
assert.equal(legacyWrites,0);
console.log('WEB_TRADE_V2_ACK_CHAIN_PASS '+JSON.stringify({
 lostAckRecovered:true,subsequentCASFresh:true,
 priorPartialBlocked:true,legacyDowngradeBlocked:true,realWrites:0}));
