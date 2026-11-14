// Regress the three Codex P2 findings on the unpublished web v2 branch.
// Source excerpts execute in an isolated VM; no production storage or GAS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {TextEncoder} from 'node:util';
const settings=fs.readFileSync('src/web/features/settings/settings.js','utf8');
const data=fs.readFileSync('src/web/domain/portfolio/data.js','utf8');
const sync=fs.readFileSync('src/web/features/settings/settings_sync.js','utf8');
const get=(src,name)=>{
 const start=src.indexOf('function '+name+'('),end=src.indexOf('\n}',start);
 assert(start>=0&&end>start,'missing '+name);
 return src.slice(src.slice(start-6,start)==='async '?start-6:start,end+2);
};
const url='https://mock-gas.invalid/v2',generation=5,rev='b'.repeat(64);
const before={id:'tr_fx000001',date:'2026-11-06',tradeType:'buy',
 acct:'US',name:'US_TEST',code:'005930',qty:10,price:209925,
 assetType:'주식',memo:'',priceRaw:155.5,fxRateAtBuy:1350};
const other={...before,qty:20};
const common={window:{_tradeLedgerV2BaselineTargets:{}},
 crypto:webcrypto,TextEncoder,Map,Set,Number,String,JSON,Math,Uint8Array};
const functions=['_tradeV2PinnedBaseline','_tradeV2NormalizeCode',
 '_tradeV2BrowserCanonical','_tradeV2BrowserSha256','_prepareTradeV2SyncContract'];
const vmBase=vm.createContext({...common});
vm.runInContext(functions.map(n=>get(sync,n)).join('\n'),vmBase);
const blockFrom=settings.indexOf('    const v2RemoteRows =');
const blockTo=settings.indexOf('    _gsBootRestored = true;',blockFrom);
assert(blockFrom>0&&blockTo>blockFrom);
const localMatch=(local,remote,dirty=false)=> {
 const c=vm.createContext({...common,window:{_tradeLedgerV2BaselineTargets:{}},
  rawTrades:local,bootstrapTradesOk:true,isBootstrap:true,
  data:{trades:remote,tradeLedgerProtocolVersion:2,ledgerRevision:rev},
  dirtyPortfolioAtLoad:dirty?{}:null,pendingEmptySyncAtLoad:null,
  dirtyPortfolioSyncResolvedAtLoad:false,loadTarget:url,loadGeneration:generation});
 vm.runInContext([get(sync,'_tradeV2NormalizeCode'),get(sync,'_tradeV2BrowserCanonical'),get(sync,'_tradeV2PinnedBaseline')].join('\n'),c);
 vm.runInContext('(function(){'+settings.slice(blockFrom,blockTo)+'})()',c);
 return c.window._tradeLedgerV2BaselineTargets[url];
};
assert.equal(localMatch([before],[other]),null,
 'SAME ID with stale quantity must not pin newer revision');
assert.equal(localMatch([before],[before])?.revision,rev);
assert.equal(localMatch([other],[other],true),null,
 'dirty portfolio must not be declared clean merely because content matches');
const restoredJournal={targetUrl:url,protocol:2,revision:rev,trades:[before]};
const restoreStart=settings.indexOf('    let serverTradeV2 =');
const restoreEnd=settings.indexOf('    const bootstrapCodeMasterSource',restoreStart);
assert(restoreStart>0&&restoreEnd>restoreStart);
assert(restoreEnd<settings.indexOf('_retryPortfolioRemoteDirtySync({',restoreEnd),
 'durable v2 baseline must be restored before dirty retry');
const restoredCtx=vm.createContext({...common,
 window:{_tradeLedgerV2BaselineTargets:{},_tradeLedgerV2RequiredTargets:{}},
 isBootstrap:true,loadTarget:url,loadGeneration:generation,
 dirtyPortfolioAtLoad:{tradeV2Baseline:restoredJournal},
 data:{tradeLedgerProtocolVersion:2,portfolioReadStatus:{tradesOk:true},
  trades:[other],ledgerRevision:'c'.repeat(64)},
 failLoad:code=>{throw Error('unexpected failure '+code)}
});
vm.runInContext('(function(){'+settings.slice(restoreStart,restoreEnd)+'})()',restoredCtx);
assert.equal(restoredCtx.window._tradeLedgerV2BaselineTargets[url].revision,rev,
 'lost ACK keeps original revision, not newest Bootstrap revision');
assert.equal(restoredCtx.window._tradeLedgerV2RequiredTargets[url],true);
const missing=vm.createContext({...common,window:{},
 isBootstrap:true,loadTarget:url,loadGeneration:generation,
 dirtyPortfolioAtLoad:{trades:[before]},
 data:{tradeLedgerProtocolVersion:2,portfolioReadStatus:{tradesOk:true},
  trades:[other],ledgerRevision:'c'.repeat(64)},
 failLoad:code=>({status:'blocked',code})
});
const blocked=vm.runInContext('(function(){'+settings.slice(restoreStart,restoreEnd)+'})()',missing);
assert.equal(blocked.code,'TRADE_V2_DIRTY_BASELINE_REQUIRED',
 '14-column server cannot downgrade a pre-v2 dirty journal');
let durable={};let dirty={};
const journal=vm.createContext({
 ...common,window:{_tradeLedgerV2BaselineTargets:{[url]:{
  ...restoredJournal,generation}}},
 Date,rawTrades:[],rawHoldings:[],fundDirect:{},_portfolioRemoteSyncEpoch:0,
 _portfolioRemoteDirtyByTarget:dirty,
 PORTFOLIO_REMOTE_DIRTY_KEY:'dirty-fixture',
 _currentGsheetSyncTarget:()=>url,
 getGsheetConnectionGeneration:()=>generation,
 lsGet:(key,defaultValue)=>durable[key]||defaultValue,
 _persistPortfolioRemoteDirtyMap:()=>{
  durable['dirty-fixture']=JSON.parse(JSON.stringify(journal._portfolioRemoteDirtyByTarget))
 }
});
vm.runInContext(
 [get(sync,'_tradeV2PinnedBaseline'),
  get(data,'_normalizePortfolioRemoteDirtyEntry'),
  get(data,'_markPortfolioRemoteDirty'),
  get(data,'_acknowledgePortfolioTradeV2Sync')].join('\n'),journal);
journal._markPortfolioRemoteDirty([before.id]);
assert.equal(journal._portfolioRemoteDirtyByTarget[url].tradeV2Baseline.revision,rev);
assert.deepEqual(Array.from(journal._portfolioRemoteDirtyByTarget[url].tradeV2DeleteIds),
 [before.id]);
const startup=journal._normalizePortfolioRemoteDirtyEntry(
 durable['dirty-fixture'][url]);
assert.equal(startup.tradeV2Baseline.revision,rev,'reboot journal preimage retained');
assert.equal(startup.tradeV2DeleteIds[0],before.id);
const confirmed={revision:'d'.repeat(64),trades:[]};
assert.equal(journal._acknowledgePortfolioTradeV2Sync(url,
 restoredJournal,confirmed),true);
assert.equal(journal._portfolioRemoteDirtyByTarget[url].tradeV2DeleteIds.length,0);
assert.equal(durable['dirty-fixture'][url].tradeV2DeleteIds.length,0);
assert.equal(durable['dirty-fixture'][url].tradeV2Baseline.revision,
 confirmed.revision);
assert.equal(journal._acknowledgePortfolioTradeV2Sync(url,
 restoredJournal,confirmed),false,'stale ACK must not advance newer baseline');
journal._markPortfolioRemoteDirty();
assert.equal(journal._portfolioRemoteDirtyByTarget[url].tradeV2DeleteIds.length,0,
 'later Settings retry cannot reuse an already confirmed deletion');
assert.equal(journal._portfolioRemoteDirtyByTarget[url].tradeV2Baseline.revision,
 confirmed.revision);
// Local create + delete before any network attempt is a cancellation,
// never a server delete of an ID the server has never seen.
const localCreated={...before,id:'tr_local000001',qty:1};
journal.rawTrades=[localCreated];
journal._markPortfolioRemoteDirty();
journal.rawTrades=[];
journal._markPortfolioRemoteDirty([localCreated.id]);
assert.equal(journal._portfolioRemoteDirtyByTarget[url].tradeV2DeleteIds.length,0,
 'delete of an unsent local create must not poison the v2 journal');
const attempt={action:'syncTradesV2',attempted:true,
 params:{data:JSON.stringify([localCreated])}};
journal._readPortfolioRecoveryReceipts=()=>({[url]:{syncTradesV2:attempt}});
journal._markPortfolioRemoteDirty([localCreated.id]);
assert.deepEqual(
 Array.from(journal._portfolioRemoteDirtyByTarget[url].tradeV2DeleteIds),
 [localCreated.id],
 'an attempted remote create must be recovered before deleting its ID');
const prep=await vmBase._prepareTradeV2SyncContract(
 {...restoredJournal,revision:confirmed.revision,trades:[]},[],[]);
assert.deepEqual(JSON.parse(prep.intents),[]);
assert.match(sync,/TRADE_V2_BASELINE_REQUIRED/);
assert.match(sync,/_acknowledgePortfolioTradeV2Sync/);
console.log('WEB_TRADE_V2_REVIEW_P2_PASS '+JSON.stringify({
 staleSameIdBlocked:true,rebootBaselineRestored:true,
 confirmedDeletesConsumed:true,localCreateCancellation:true,productionWrites:0}));
