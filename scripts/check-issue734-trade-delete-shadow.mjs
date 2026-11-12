// #734: run actual web partial-delete UI -> _commitTrades -> saveHoldings
// -> durable v2 delete journal -> immutable-ID CAS proposal against a shadow.
// In-memory only: NEVER issue an HTTP request or write a financial Sheet.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {TextEncoder} from 'node:util';
import {inspectTradeV2Proposal,tradeV2Revision} from './trade-ledger-v2-oracle.mjs';

const src={
 views:fs.readFileSync('src/web/views/views_trades.js','utf8'),
 data:fs.readFileSync('src/web/domain/portfolio/data.js','utf8'),
 sync:fs.readFileSync('src/web/features/settings/settings_sync.js','utf8')
};
function extract(kind,name){
 const text=src[kind],match='function '+name+'(';
 const i=text.indexOf(match),start=text.slice(i-6,i)==='async '?i-6:i;
 const end=text.indexOf('\n}',start);
 assert(i>=0&&end>start,'missing live source '+kind+':'+name);
 return text.slice(start,end+2);
}
const names=[
 ['views','deleteSelectedTrades'],
 ...['_persistPortfolioRemoteDirtyMap','_markPortfolioRemoteDirty',
 'saveHoldings','_commitTrades','_acknowledgePortfolioTradeV2Sync'].map(x=>['data',x]),
 ...['_tradeV2PinnedBaseline','_tradeV2NormalizeCode',
 '_tradeV2BrowserCanonical','_tradeV2BrowserSha256',
 '_prepareTradeV2SyncContract'].map(x=>['sync',x])
];
const A={id:'tr_shadow10001',date:'2026-11-06',tradeType:'buy',
 acct:'ISA',name:'SHADOW',code:'005930',qty:10,price:1000,assetType:'주식',memo:''};
const B={...A,id:'tr_shadow10002',date:'2026-11-07',qty:5,price:2000};
const C={...A,id:'tr_shadow10003',date:'2026-11-08',qty:2,price:1200};
const url='https://shadow.example.invalid/gas',generation=7;
function fixture(initial,selected,confirmDelete=true){
 const storage=new Map(),timers=[],alerts=[],requests=[];
 const baseline={targetUrl:url,generation,protocol:2,
  revision:tradeV2Revision(initial),trades:structuredClone(initial)};
 const w={_tradeLedgerV2BaselineTargets:{[url]:baseline}};
 const ctx=vm.createContext({
  window:w,crypto:webcrypto,TextEncoder,JSON,Array,Map,Set,String,
  Number,Boolean,Math,Date,Uint8Array,
  rawTrades:structuredClone(initial),rawHoldings:[],
  EDITABLE_PRICES:[],STOCK_CODE:{},SECTOR_COLORS:{},fundDirect:{},
  savedPrices:{},_portfolioRemoteDirtyByTarget:{},
  _portfolioRemoteSyncEpoch:0,_saveHoldingsGasTimer:null,
  PORTFOLIO_REMOTE_DIRTY_KEY:'portfolio_remote_dirty',
  HOLDINGS_KEY:'holdings',STOCKCODE_KEY:'codes',EDITABLES_KEY:'editables',
  TRADES_KEY:'trades',SECTOR_COLORS_KEY:'colors',FUNDDIRECT_KEY:'funds',
  _portfolioTradeDateKey:v=>String(v||'').slice(0,10),
  document:{querySelectorAll:selector=>{
   assert.equal(selector,'.trade-check:checked');
   return selected.map(id=>({dataset:{id}}));
  }},
  $el:()=>null,confirm:()=>confirmDelete,
  showToast:(...msg)=>alerts.push(msg),
  syncHoldingsFromTrades:()=>{},
  refreshAll:()=>{},saveAcctColors:()=>{},saveAcctOrder:()=>{},
  _currentGsheetSyncTarget:()=>url,
  getGsheetConnectionGeneration:()=>generation,
  _readPortfolioRecoveryReceipts:()=>({}),
  clearTimeout:()=>{},
  setTimeout:(cb,delay)=>{timers.push({cb,delay});return timers.length;},
  lsSave:(key,value)=>{storage.set(key,structuredClone(value));return true;},
  lsGet:(key,fallback)=>storage.has(key)
   ?structuredClone(storage.get(key)):fallback,
  lsRemove:key=>{storage.delete(key)},
  _setPendingExplicitEmptyTradeSync:x=>storage.set('empty-token',structuredClone(x)),
  _getPendingExplicitEmptyTradeSync:()=>storage.get('empty-token')||null,
  // Any unexpected remote network or deploy call is prohibited in this test.
  requestGsheetFormJson:()=>{requests.push('POST');throw Error('NETWORK_FORBIDDEN');},
  requestGsheetActionJson:()=>{requests.push('GET');throw Error('NETWORK_FORBIDDEN');}
 });
 vm.runInContext(names.map(([kind,name])=>extract(kind,name)).join('\n'),ctx);
 return {ctx,storage,timers,alerts,requests,baseline,w};
}
async function contract(f){
 const journal=f.ctx._portfolioRemoteDirtyByTarget[url];
 assert(journal,'editing must persist a dirty journal');
 const data=await f.ctx._prepareTradeV2SyncContract(
  f.baseline,f.ctx.rawTrades,journal.tradeV2DeleteIds);
 const intents=JSON.parse(data.intents);
 const validated=inspectTradeV2Proposal({
  before:f.baseline.trades,after:f.ctx.rawTrades,intents,
  expectedRevision:data.expectedLedgerRevision});
 assert.equal(validated.ok,true,JSON.stringify(validated));
 assert.equal(data.targetRevision,validated.newRevision);
 return {journal,data,intents,validated};
}
// Actual selected row deletion, preserving the unaffected remote preimage.
{
 const f=fixture([A,B], [A.id]);
 f.ctx.deleteSelectedTrades();
 assert.deepEqual(Array.from(f.ctx.rawTrades.map(x=>x.id)),[B.id]);
 assert.deepEqual(f.storage.get('trades').map(x=>x.id),[B.id],
  'local reload must preserve deleted selection');
 assert.equal(f.timers.length,1);
 assert.equal(f.timers[0].delay,300);
 assert.equal(f.storage.has('empty-token'),false,
  'partial delete cannot request empty-remote-ledger override');
 const {journal,intents,data}=await contract(f);
 assert.deepEqual(Array.from(journal.tradeV2DeleteIds),[A.id]);
 assert.deepEqual(intents.map(x=>x.type),['delete']);
 assert.equal(intents[0].id,A.id);
 assert.equal(journal.tradeV2Baseline.revision,f.baseline.revision);
 assert.equal(f.ctx._acknowledgePortfolioTradeV2Sync(url,f.baseline,
  {revision:data.targetRevision,trades:f.ctx.rawTrades}),true);
 assert.equal(f.ctx._portfolioRemoteDirtyByTarget[url].tradeV2DeleteIds.length,0);
 assert.equal(f.ctx._portfolioRemoteDirtyByTarget[url].tradeV2Baseline.revision,
  data.targetRevision);
 assert.equal(f.requests.length,0);
}
// Explicit last-trade deletion still retains exact transaction ID and
// first affected date for safe historical snapshot replay.
{
 const f=fixture([A],[A.id]);
 f.ctx.deleteSelectedTrades();
 const {intents}=await contract(f);
 assert.deepEqual(intents.map(x=>x.id),[A.id]);
 assert.equal(f.ctx.rawTrades.length,0);
 assert.equal(f.storage.get('empty-token').from,A.date);
 assert.equal(f.storage.get('empty-token').target,url);
 assert.equal(f.requests.length,0);
}
// An uncommitted create deleted locally is NOT a remote deletion; no
// fabricated intent should reach the authoritative ledger.
{
 const f=fixture([A],[C.id]);
 f.ctx.rawTrades.push({...C});
 f.ctx.deleteSelectedTrades();
 const {intents,journal}=await contract(f);
 assert.deepEqual(intents,[]);
 assert.deepEqual(Array.from(journal.tradeV2DeleteIds),[]);
 assert.deepEqual(Array.from(f.ctx.rawTrades.map(x=>x.id)),[A.id]);
 assert.equal(f.requests.length,0);
}
// No row removed, or user cancels confirmation: no journal or timers.
for(const [choice,confirmed] of [[[C.id],true],[[A.id],false]]){
 const f=fixture([A,B],choice,confirmed);
 f.ctx.deleteSelectedTrades();
 assert.equal(f.ctx.rawTrades.length,2);
 assert.equal(f.timers.length,0);
 assert.equal(f.ctx._portfolioRemoteDirtyByTarget[url],undefined);
 assert.equal(f.requests.length,0);
}
// The server-side CAS oracle must continue to reject a missing delete intent.
assert.equal(inspectTradeV2Proposal({before:[A,B],after:[B],intents:[],
 expectedRevision:tradeV2Revision([A,B])}).errorCode,
 'TRADE_DELETE_INTENT_REQUIRED');
console.log(JSON.stringify({kind:'ISSUE734_WEB_DELETE_SHADOW_PASS',
 scenarios:5,realUiDelete:true,realCommit:true,realSave:true,
 durableDeleteIntent:true,exactBeforeHash:true,casValidated:true,
 fullDeleteEarliestDatePreserved:true,unsentCreateCancelled:true,
 receiptsNotForged:true,remoteRequests:0,financeWrites:0}));
