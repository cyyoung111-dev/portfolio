// Web v2 contract independent VM test. Does not write to a real GAS endpoint.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash,webcrypto} from 'node:crypto';
import {TextEncoder} from 'node:util';
import {composeGas9285TradeV2Preview} from './compose-gas9285-trade-v2-preview.mjs';
const sync=fs.readFileSync('src/web/features/settings/settings_sync.js','utf8');
const settings=fs.readFileSync('src/web/features/settings/settings.js','utf8');
const start=sync.indexOf('// The live v9.284 connection must never acquire v2 capabilities');
const end=sync.indexOf('function _readPortfolioRecoveryReceipts()',start);
assert(start>=0&&end>start,'v2 web preflight helpers must exist');
const window={_tradeLedgerV2BaselineTargets:{}};
const ctx=vm.createContext({window,TextEncoder,crypto:webcrypto,
 JSON,Map,Set,String,Number,Date,Math,Array,Uint8Array});
vm.runInContext(sync.slice(start,end),ctx);
const fx={id:'tr_fx00001',date:'2026-11-06',tradeType:'buy',acct:'US',
 name:'TEST',code:'005930',qty:3,price:209925,assetType:'주식',
 memo:'',priceRaw:155.5,fxRateAtBuy:1350,ratio:0,fractionalCash:0};
const local={id:'tr_plain001',date:'2026-11-05',tradeType:'buy',acct:'ISA',
 name:'TEST',code:'005930',qty:5,price:100,assetType:'주식',memo:''};
const revision='a'.repeat(64),url='https://script.google.test/v2',generation=17;
const baseline={targetUrl:url,generation,protocol:2,revision,trades:[local,fx]};
window._tradeLedgerV2BaselineTargets[url]=baseline;
assert.equal(ctx._tradeV2PinnedBaseline(url,generation).revision,revision);
assert.equal(ctx._tradeV2PinnedBaseline(url,generation+1),null);
assert.equal(ctx._tradeV2PinnedBaseline('https://other-url',generation),null);
const canonical=ctx._tradeV2BrowserCanonical(fx);
assert.equal(canonical[0],fx.id);
assert.equal(canonical[5],'005930');
assert.equal(canonical[10],'');
assert.equal(canonical[11],'');
assert.equal(canonical[12],155.5);
assert.equal(canonical[13],1350);
assert.equal(ctx._tradeV2NormalizeCode('5930'),'005930');
const expectedHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
assert.equal(await ctx._tradeV2BrowserSha256(canonical),expectedHash(Array.from(canonical)));
const editFx={...fx,acct:'OTHER',memo:'changed with FX pair'};
const allowed=await ctx._prepareTradeV2SyncContract(baseline,[local,editFx],[]);
const intents=JSON.parse(allowed.intents);
assert.equal(intents.length,1);
assert.equal(intents[0].type,'update');
assert.equal(intents[0].id,fx.id);
assert.equal(intents[0].beforeHash,expectedHash(Array.from(canonical)));
assert.equal(allowed.expectedLedgerRevision,revision);
assert.equal(allowed.tradeLedgerProtocolVersion,'2');
assert.equal(allowed.targetRevision,expectedHash(
 [ctx._tradeV2BrowserCanonical(local),ctx._tradeV2BrowserCanonical(editFx)]
 .map(v=>Array.from(v))));
const droppedFx={...fx,acct:'OTHER',priceRaw:undefined,fxRateAtBuy:undefined};
await assert.rejects(ctx._prepareTradeV2SyncContract(baseline,[local,droppedFx],[]),
 /TRADE_FX_METADATA_LOSS_RISK/);
await assert.rejects(ctx._prepareTradeV2SyncContract(baseline,[local],[]),
 /TRADE_DELETE_INTENT_REQUIRED/);
const deletion=await ctx._prepareTradeV2SyncContract(baseline,[local],[fx.id]);
const deletes=JSON.parse(deletion.intents);
assert.equal(deletes.length,1);
assert.equal(deletes[0].type,'delete');
assert.equal(deletes[0].beforeHash,expectedHash(Array.from(canonical)));
await assert.rejects(ctx._prepareTradeV2SyncContract(baseline,[local,fx],[fx.id]),
 /TRADE_DELETE_INTENT_INVALID/);
const created={...local,id:'tr_new00001',date:'2026-11-07'};
const creation=await ctx._prepareTradeV2SyncContract(baseline,[local,fx,created],[]);
assert.equal(JSON.parse(creation.intents)[0].type,'create');
await assert.rejects(ctx._prepareTradeV2SyncContract(baseline,[local,local],[]),
 /TRADE_ID_DUPLICATE/);
await assert.rejects(ctx._prepareTradeV2SyncContract(
 {...baseline,revision:''},[local,fx],[]),/TRADE_V2_BASELINE_UNVERIFIED/);
await assert.rejects(ctx._prepareTradeV2SyncContract(baseline,[local,
 {...fx,fxRateAtBuy:undefined}],[]),/TRADE_FX_METADATA_INCOMPLETE/);
assert.match(settings,/window\._tradeLedgerV2BaselineTargets=/);
assert.match(sync,/id:\s+t\.id \|\| ''/);
const gas=composeGas9285TradeV2Preview();
assert.match(gas.candidate,/tradeLedgerProtocolVersion:tradesOk\?Number/);
assert.equal(gas.manifest.productionDeploymentApproved,false);
console.log('WEB_TRADE_LEDGER_V2_CONTRACT_PASS '+JSON.stringify({
 readOnlyProtocolPinned:true,clientDeletesMustBeExplicit:true,
 serverHashParity:true,fxPreserved:true,productionWrites:0}));
