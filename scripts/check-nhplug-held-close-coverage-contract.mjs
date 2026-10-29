import assert from 'node:assert/strict';
import {auditNhHeldCloseCoverage} from './nhplug-held-close-coverage-contract.mjs';

const day='2026-10-29',asOf=day+'T16:00:00+09:00';
const ledger={source:'GAS_VERIFIED_ASOF_LEDGER',asOfDate:day,verified:true,positions:[
 {code:'005930',quantity:2,accountId:'fixture-account-1'},
 {code:'005930',quantity:3,accountId:'fixture-account-2'},
 {code:'069500',quantity:1},
 {code:'AAPL',quantity:0.5},
 {code:'F00001',quantity:15},
 {code:'035420',quantity:0}
]};
const m=(code,kind,market,currency,listingState='ACTIVE')=>({
 code,kind,market,currency,listingState,listingStateAsOf:day,securityId:'FIXTURE:'+code,
 corporateActionEvidence:{source:'KRX_CORPORATE_ACTION_HISTORY',verified:true,
  recordId:'SYNTHETIC_ACTIONS:'+code,code,securityId:'FIXTURE:'+code,
  coveredFrom:'2026-01-01',coveredThrough:'2026-12-31',events:[]}, 
 listingEvidence:{
  source:'KRX_OFFICIAL_HISTORY',verified:true,recordId:'SYNTHETIC_ONLY:'+code,
  securityId:'FIXTURE:'+code,code,
  codeValidFrom:'2020-01-01',codeValidUntilExclusive:null,
  periods:[{state:listingState,from:'2026-01-01',untilExclusive:'2027-01-01'}]
 }
});
const master={source:'GAS_VERIFIED_CODE_MASTER',asOfDate:day,verified:true,items:[
 m('005930','STOCK','KOSPI','KRW'),m('069500','ETF','ETF','KRW'),
 m('AAPL','STOCK','US','USD'),m('F00001','FUND','KR','KRW'),
 m('035420','STOCK','KOSPI','KRW')
]};
const q=(code,price,extra={})=>({
 code,price,source:'NH_PLUG',market:'KRX',session:'REGULAR',
 priceScope:'KRX_REGULAR',priceKind:'DAILY_REGULAR_CLOSE',
 tradingDate:day,sourceDate:day,officialFinal:false,
 receivedAt:day+'T15:45:00+09:00',...extra
});
const input={tradingDate:day,asOf,ledgerSnapshot:ledger,masterSnapshot:master,
 observations:[q('005930',71300),q('069500',31000)]};
const clone=v=>JSON.parse(JSON.stringify(v));
const run=(patch={})=>auditNhHeldCloseCoverage({...clone(input),...patch});
const ok=run();
assert.equal(ok.status,'SOURCE_COVERAGE_COMPLETE_OFFICIAL_FINALITY_UNVERIFIED');
assert.equal(ok.readyForProvisionalMessage,true);
assert.equal(ok.expectedHeldCodes,2,'same domestic code on two accounts counts only once');
assert.equal(ok.receivedValidCodes,2);
assert.deepEqual(ok.market.STOCK,{kind:'STOCK',expected:1,covered:1,missing:0,blocked:0});
assert.deepEqual(ok.market.ETF,{kind:'ETF',expected:1,covered:1,missing:0,blocked:0});
assert.equal(ok.excludedNonDomesticPositions,2);
assert.equal(ok.ignoredZeroPositions,1);
assert.equal(ok.officialKrxFinal,false);
assert.equal(ok.updatedFinancialData,false);
assert.deepEqual(ok.issues,{});
assert.doesNotMatch(JSON.stringify(ok),/005930|069500|AAPL|F00001|fixture-account|71300|31000/,
 'aggregate report must not include holdings identities or prices');
assert.deepEqual(run(),ok,'deterministic audit results');
assert.deepEqual(input.ledgerSnapshot,ledger,'audit must not mutate input ledger');
assert.equal(Object.isFrozen(ok),true);

function invalidQuote(patch,category='NH_CLOSE_INVALID_OR_STALE'){
 const a=run({observations:[q('005930',71300,patch),q('069500',31000)]});
 assert.equal(a.readyForProvisionalMessage,false);
 assert.equal(a.receivedValidCodes,1);
 assert.equal(a.blockedCodes,1);
 assert.equal(a.issues[category],1);
}
for(const patch of [
 {tradingDate:'2026-10-28'}, {sourceDate:'2026-10-28'},
 {source:'KRX'}, {market:'NXT'}, {session:'AFTER'},
 {priceScope:'NXT_AFTER'}, {priceKind:'CURRENT_PRICE'},
 {officialFinal:true}, {officialFinal:undefined},
 {receivedAt:day+'T15:29:59+09:00'}, {receivedAt:day+'T16:00:01+09:00'},
 {receivedAt:day+'T15:45:00'}, {price:0}, {price:-1}, {price:'NaN'},
 {price:'7,100'}, {price:Infinity}
]) invalidQuote(patch);
const stale=run({observations:[q('005930',71300)]});
assert.equal(stale.readyForProvisionalMessage,false);
assert.equal(stale.missingCodes,1);
assert.equal(stale.market.ETF.missing,1);
assert.equal(stale.issues.NH_CLOSE_MISSING,1);
const duplicate=run({observations:[q('005930',71300),q('005930',71300),q('069500',31000)]});
assert.equal(duplicate.receivedValidCodes,1);
assert.equal(duplicate.issues.DUPLICATE_QUOTE_ROWS,1);
assert.equal(duplicate.readyForProvisionalMessage,false);
const unexpected=run({observations:[...input.observations,q('035420',90000)]});
assert.equal(unexpected.expectedHeldCodes,2,'extra quote may not expand the ledger denominator');
assert.equal(unexpected.readyForProvisionalMessage,false);
assert.equal(unexpected.issues.UNEXPECTED_QUOTE_CODES,1);
const orphan=run({ledgerSnapshot:{...ledger,positions:[...ledger.positions,{code:'999999',quantity:1}]}});
assert.equal(orphan.expectedHeldCodes,2);
assert.equal(orphan.readyForProvisionalMessage,false);
assert.equal(orphan.issues.ORPHAN_LEDGER_CODES,1);
const dupMaster=run({masterSnapshot:{...master,items:[...master.items,m('005930','STOCK','KOSPI','KRW')]}});
assert.equal(dupMaster.readyForProvisionalMessage,false);
assert.equal(dupMaster.issues.DUPLICATE_MASTER_CODES,1);
assert.equal(dupMaster.issues.AMBIGUOUS_HELD_MASTER,1,'two accounts holding same code produce one conflict');
const unrelatedDuplicate=run({masterSnapshot:{...master,items:[...master.items,m('MSFT','STOCK','US','USD'),m('MSFT','STOCK','US','USD')]}});
assert.equal(unrelatedDuplicate.readyForProvisionalMessage,true,
 'duplicate master code absent from holdings must not block domestic coverage');
const suspended=run({masterSnapshot:{...master,items:master.items.map(x=>x.code==='005930'?m(x.code,x.kind,x.market,x.currency,'SUSPENDED'):x)}});
assert.equal(suspended.readyForProvisionalMessage,false);
assert.equal(suspended.issues.SUSPENDED_HELD_CODES,1);
assert.equal(suspended.market.STOCK.blocked,1);
const delisted=run({masterSnapshot:{...master,items:master.items.map(x=>x.code==='069500'?m(x.code,x.kind,x.market,x.currency,'DELISTED'):x)}});
assert.equal(delisted.issues.DELISTED_HELD_CODES,1);
assert.equal(delisted.readyForProvisionalMessage,false);
const listingStale=run({masterSnapshot:{...master,items:master.items.map(x=>x.code==='069500'?{...x,listingStateAsOf:'2026-10-28'}:x)}});
assert.equal(listingStale.issues.LISTING_STATUS_CONFLICT,1);
const missingMaster=run({masterSnapshot:{...master,items:master.items.filter(x=>x.code!=='005930')}});
assert.equal(missingMaster.issues.ORPHAN_LEDGER_CODES,1,'orphan counts distinct held code');
const malformedCurrency=run({masterSnapshot:{...master,items:master.items.map(x=>x.code==='AAPL'?{...x,currency:'KRW'}:x)}});
assert.equal(malformedCurrency.readyForProvisionalMessage,false);
assert.equal(malformedCurrency.issues.MARKET_CURRENCY_UNVERIFIED,1);
const domesticCurrency=run({masterSnapshot:{...master,items:master.items.map(x=>x.code==='005930'?{...x,currency:'USD'}:x)}});
assert.equal(domesticCurrency.readyForProvisionalMessage,false);
assert.equal(domesticCurrency.issues.MARKET_CURRENCY_UNVERIFIED,1,'currency error counts once per unique held code');
assert.equal(domesticCurrency.expectedHeldCodes,1);
const negative=clone(input);negative.ledgerSnapshot.positions[0].quantity=-2;
assert.throws(()=>auditNhHeldCloseCoverage(negative),/NH_HELD_POSITION_INVALID/);
const invalidMaster=clone(input);invalidMaster.masterSnapshot.items[0].kind='SOMETHING';
assert.throws(()=>auditNhHeldCloseCoverage(invalidMaster),/NH_HELD_MASTER_SCHEMA_INVALID/);
const invalidLedger=clone(input);invalidLedger.ledgerSnapshot.verified=false;
assert.throws(()=>auditNhHeldCloseCoverage(invalidLedger),/NH_HELD_LEDGER_NOT_VERIFIED/);
const invalidMasterSource=clone(input);invalidMasterSource.masterSnapshot.asOfDate='2026-10-28';
assert.throws(()=>auditNhHeldCloseCoverage(invalidMasterSource),/NH_HELD_MASTER_NOT_VERIFIED/);
for(const at of [day+'T15:29:59+09:00',day+'T16:10:01+09:00','2026-10-30T16:00:00+09:00'])
 assert.throws(()=>run({asOf:at}),/NH_HELD_CUTOFF_OUT_OF_WINDOW/);
for(const badDay of ['2026-10-09','2026-10-31','2026-02-30','2028-10-29'])
 assert.throws(()=>run({tradingDate:badDay}),/NH_HELD_MARKET_DAY_UNVERIFIED/);
const noHold=run({ledgerSnapshot:{...ledger,positions:[]},observations:[]});
assert.equal(noHold.readyForProvisionalMessage,false,'an empty verified ledger cannot imply full coverage');
assert.equal(noHold.expectedHeldCodes,0);
console.log('NH domestic stock/ETF as-of holdings close coverage dry-run checks passed');
