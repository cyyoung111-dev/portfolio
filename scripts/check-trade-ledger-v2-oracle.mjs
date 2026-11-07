// Design-contract tests for trade-ledger identity v2; does not assert that
// current GAS v9.284 or the 13-column v9.285 preview already supports v2.
import assert from 'node:assert/strict';
import {inspectTradeV2Proposal,tradeV2Revision,tradeV2RowHash} from './trade-ledger-v2-oracle.mjs';
const fx={id:'tr_fx00001',date:'2026-11-06',tradeType:'buy',
 acct:'일반미국',name:'US_TEST',code:'US_TEST',qty:10,price:209925,
 assetType:'주식',memo:'',priceRaw:155.5,fxRateAtBuy:1350};
const regular={id:'tr_plain001',date:'2026-11-06',tradeType:'buy',
 acct:'일반미국',name:'US_TEST',code:'US_TEST',qty:2,price:100,
 assetType:'주식',memo:''};
const before=[regular,fx],expectedRevision=tradeV2Revision(before);
const intent=(type,row)=>({type,id:row.id,beforeHash:tradeV2RowHash(row)});
const inspect=(after,intents=[],old=before,rev=expectedRevision)=>
 inspectTradeV2Proposal({before:old,after,intents,expectedRevision:rev});
const ok=(label,after,intents=[],old=before,rev=expectedRevision)=>{
 const result=inspect(after,intents,old,rev);
 assert.equal(result.ok,true,label+': '+JSON.stringify(result));
 assert.equal(result.counts.after,after.length);
};
const error=(label,code,after,intents=[],old=before,rev=expectedRevision)=>{
 const result=inspect(after,intents,old,rev);
 assert.equal(result.ok,false,label);
 assert.equal(result.errorCode,code,label+': '+JSON.stringify(result));
};
const untouched=JSON.stringify(before);
const acctChangedWithoutFx={...fx,acct:'퇴직연금',priceRaw:undefined,fxRateAtBuy:undefined};
error('account change must not bypass FX guard','TRADE_FX_METADATA_LOSS_RISK',
 [regular,acctChangedWithoutFx],[intent('update',fx)]);
const codeChangedWithoutFx={...fx,code:'US_NEW',priceRaw:undefined,fxRateAtBuy:undefined};
error('code change must not bypass FX guard','TRADE_FX_METADATA_LOSS_RISK',
 [regular,codeChangedWithoutFx],[intent('update',fx)]);
ok('account and memo changes preserve existing ID and FX',
 [regular,{...fx,acct:'퇴직연금',memo:'이전'}],[intent('update',fx)]);
ok('ordinary memo edit with FX untouched',
 [{...regular,memo:'수정'},fx],[intent('update',regular)]);
const sale={id:'tr_sale001',...regular,tradeType:'sell',date:'2026-11-07',qty:1};
ok('new sale in same group as FX',
 [regular,fx,sale],[{type:'create',id:sale.id}]);
const split={id:'tr_split01',...regular,tradeType:'split',date:'2026-11-07',
 qty:1,price:0,ratio:2};
ok('new split in same group as FX',
 [regular,fx,split],[{type:'create',id:split.id}]);
ok('explicit FX deletion leaves ordinary row', [regular],[intent('delete',fx)]);
error('missing FX row without deletion intent','TRADE_DELETE_INTENT_REQUIRED',[regular]);
error('FX edit without declared update','TRADE_UPDATE_INTENT_REQUIRED',
 [regular,{...fx,memo:'unexpected'}]);
error('wrong previous-row hash','TRADE_PREIMAGE_MISMATCH',
 [regular,{...fx,memo:'expected'}],[{...intent('update',fx),beforeHash:'bad'}]);
error('old browser cannot discard row IDs','TRADE_ID_MISSING_OR_INVALID',
 [{...regular,id:undefined},fx]);
error('stale browser revision cannot overwrite','TRADE_LEDGER_REVISION_CONFLICT',
 [regular,fx],[] ,before,'old-revision');
error('duplicate ID cannot collapse records','TRADE_ID_DUPLICATE',
 [regular,{...fx,id:regular.id}]);
error('FX metadata must be a complete pair','TRADE_FX_METADATA_INCOMPLETE',
 [regular,{...fx,fxRateAtBuy:undefined}],[intent('update',fx)]);
error('FX multiplication must match stored KRW unit price',
 'TRADE_FX_METADATA_PRICE_MISMATCH',
 [regular,{...fx,fxRateAtBuy:1300}],[intent('update',fx)]);
const twin={...regular,id:'tr_twin0001'};
const duplicates=[regular,twin,fx];
const duplicateRev=tradeV2Revision(duplicates);
ok('identical ordinary trades have distinct immutable IDs',
 [regular,fx],[intent('delete',twin)],duplicates,duplicateRev);
const recreated={...regular,id:'tr_created1'};
ok('explicit delete and create distinguish account transfer from FX edit',
 [regular,recreated],[intent('delete',fx),{type:'create',id:recreated.id}]);
assert.equal(JSON.stringify(before),untouched,'all checks are pure and read-only');
console.log('TRADE_LEDGER_V2_ORACLE_PASS '+JSON.stringify({
 checks:17,productionGasImplemented:false,financeWrites:0,
 deploymentWrites:0,scope:'contract-only'}));
