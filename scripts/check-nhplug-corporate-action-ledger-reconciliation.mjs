import assert from 'node:assert/strict';
import {auditNhCorporateActionLedger} from './nhplug-corporate-action-ledger-reconciliation.mjs';
import {assessNhCorporateActionAsOf} from './nhplug-corporate-action-asof-contract.mjs';
import {auditNhHeldCloseCoverage} from './nhplug-held-close-coverage-contract.mjs';

const date='2026-10-29',beforeDate='2026-10-28';
const old={code:'005930',securityId:'ISSUER-A'},replacement={code:'000001',securityId:'ISSUER-A'};
const merged={code:'000002',securityId:'ISSUER-B'};
const spin={code:'000003',securityId:'ISSUER-C'};
const split={type:'SPLIT',eventId:'SPLIT-A',effectiveDate:date,source:old,targets:[],
 ratioNumerator:2,ratioDenominator:1};
const codeChange={type:'CODE_CHANGE',eventId:'RENAME-A',effectiveDate:date,source:old,targets:[replacement]};
const merger={type:'MERGER',eventId:'MERGER-A',effectiveDate:date,source:old,targets:[merged]};
const spinoff={type:'SPINOFF',eventId:'SPINOFF-A',effectiveDate:date,source:old,targets:[spin]};
const liquidation={type:'ETF_LIQUIDATION',eventId:'ETF-A',effectiveDate:date,source:old,targets:[]};
const delisting={type:'DELISTING',eventId:'DELIST-A',effectiveDate:date,source:old,targets:[]};
const copy=x=>JSON.parse(JSON.stringify(x));
const row=(p,quantity,costBasisKrw)=>({...p,quantity,costBasisKrw});
const snapshot=(asOfDate,positions)=>({
 source:'GAS_READONLY_ASOF_UNVERIFIED',verified:false,
 asOfDate,ledgerFingerprint:'FIXTURE-ONLY-'+asOfDate,positions
});
const input=(event,preRows,postRows,more={})=>({
 event,before:snapshot(beforeDate,preRows),after:snapshot(date,postRows),
 cashEntries:[],settlementEvidence:null,...more
});
const test=(params,reason)=>{
 const original=JSON.stringify(params);
 const got=auditNhCorporateActionLedger(params);
 assert.equal(got.status,'BLOCKED');
 assert.equal(got.reason,reason);
 assert.equal(got.ledgerVerified,false);
 assert.equal(got.accountLineageVerified,false);
 assert.equal(got.readyForCoverage,false);
 assert.equal(got.officialEntitlementVerified,false);
 assert.equal(got.canWriteLedger,false);
 assert.equal(got.canWriteSnapshot,false);
 assert.equal(got.canSendTelegram,false);
 assert.ok(Object.isFrozen(got));
 assert.ok(Object.isFrozen(got.arithmeticChecks));
 assert.equal(JSON.stringify(params),original,'read-only arithmetic check cannot mutate input');
 assert.doesNotMatch(JSON.stringify(got),/005930|000001|ISSUER-A|100000|PAYMENT-ACCOUNT|987654/);
 return got;
};
const codeRows=input(codeChange,[row(old,'10.0000','100000'),row(replacement,'0','0')],
 [row(old,'0','0'),row(replacement,'10.0000','100000')]);
assert.ok(test(codeRows,'ARITHMETIC_MATCH_PROVENANCE_UNVERIFIED').arithmeticChecks.includes('BASIS_MATCH'));
test({...copy(codeRows),after:snapshot(date,[row(old,'0','0'),row(replacement,'9.0000','100000')])},'QUANTITY_MISMATCH');
test({...copy(codeRows),after:snapshot(date,[row(old,'0','0'),row(replacement,'10.0000','100001')])},'BASIS_MISMATCH');
test({...copy(codeRows),after:snapshot(date,[row(old,'1','10000'),row(replacement,'9.0000','90000')])},'CODE_CHANGE_RESIDUAL_OR_PREEXISTING');
test({...copy(codeRows),before:snapshot(beforeDate,[row(old,'10.0000','100000'),row(replacement,'1','20000')])},'CODE_CHANGE_RESIDUAL_OR_PREEXISTING');
test({...copy(codeRows),cashEntries:[{eventId:'RENAME-A',cashEntryId:'CASH-1',postedDate:date,amountKrw:'1000'}]},'CASH_ALLOCATION_NOT_PROVEN');
test({...copy(codeRows),after:snapshot(date,[row(old,'0','100'),row(replacement,'10','100000')])},'ZERO_POSITION_COST_REMAINS');
test({...copy(codeRows),after:snapshot(date,[row(old,'0','0')])},'PARTICIPANT_LEDGER_ROW_MISSING');
test({...copy(codeRows),after:snapshot(date,[row(old,'0','0'),row(replacement,'10','100000'),row(replacement,'10','100000')])},'SNAPSHOT_INPUT_INVALID');

const splitRows=input(split,[row(old,'10','100000')],[row(old,'20','100000')]);
test(splitRows,'ARITHMETIC_MATCH_PROVENANCE_UNVERIFIED');
test({...copy(splitRows),after:snapshot(date,[row(old,'19.9999','100000')])},'QUANTITY_MISMATCH');
test({...copy(splitRows),after:snapshot(date,[row(old,'20','99999')])},'BASIS_MISMATCH');
test({...copy(splitRows),cashEntries:[{eventId:'SPLIT-A',cashEntryId:'CASH-2',postedDate:date,amountKrw:'100'}]},'FRACTIONAL_CASH_BASIS_UNVERIFIED');

const reverse={...split,type:'REVERSE_SPLIT',eventId:'REVERSE-A',ratioNumerator:1,ratioDenominator:10};
test(input(reverse,[row(old,'10','100000')],[row(old,'1','100000')]),
 'ARITHMETIC_MATCH_PROVENANCE_UNVERIFIED');
test(input(reverse,[row(old,'1.0001','100000')],[row(old,'0.1000','100000')]),
 'FRACTIONAL_UNIT_SETTLEMENT_REQUIRED');
test(input(reverse,[row(old,'10','100000')],[row(old,'2','100000')]),
 'QUANTITY_MISMATCH');

const mergeRows=input(merger,[row(old,'10','100000'),row(merged,'0','0')],
 [row(old,'0','0'),row(merged,'5','100000')]);
test(mergeRows,'MERGER_EXCHANGE_TERMS_UNVERIFIED');
test({...copy(mergeRows),after:snapshot(date,[row(old,'1','10000'),row(merged,'5','90000')])},
 'PREDECESSOR_RESIDUAL_HOLDING');
test({...copy(mergeRows),before:snapshot(beforeDate,[row(old,'10','100000'),row(merged,'2','20000')])},
 'PREEXISTING_SUCCESSOR_HOLDING');
test({...copy(mergeRows),after:snapshot(date,[row(old,'0','0'),row(merged,'0','0')])},
 'SUCCESSOR_HOLDING_MISSING');

test(input(spinoff,[row(old,'10','100000'),row(spin,'0','0')],
 [row(old,'10','75000'),row(spin,'5','25000')]),'SPINOFF_BASIS_ALLOCATION_UNVERIFIED');
test(input(spinoff,[row(old,'10','100000'),row(spin,'0','0')],
 [row(old,'10','75000'),row(spin,'0','0')]),'SPINOFF_SUCCESSOR_MISSING');
test(input(spinoff,[row(old,'10','100000'),row(spin,'1','1000')],
 [row(old,'10','75000'),row(spin,'5','25000')]),'SPINOFF_PREEXISTING_SUCCESSOR');

const liqRows=input(liquidation,[row(old,'10','100000')],[row(old,'0','0')]);
test(liqRows,'ETF_SETTLEMENT_EVIDENCE_MISSING');
const evidence={source:'ETF_SETTLEMENT_CLAIM_UNVERIFIED',recordId:'SYNTHETIC-1',
 eventId:'ETF-A',amountKrw:'987654'};
const receipt={eventId:'ETF-A',cashEntryId:'CASH-ETF',postedDate:date,amountKrw:'987654'};
test({...copy(liqRows),settlementEvidence:evidence},'ETF_CASH_RECEIPT_MISSING');
test({...copy(liqRows),settlementEvidence:evidence,cashEntries:[receipt]},
 'ETF_CASH_MATCH_ENTITLEMENT_UNVERIFIED');
test({...copy(liqRows),settlementEvidence:evidence,cashEntries:[{...receipt,amountKrw:'987653'}]},
 'ETF_CASH_RECEIPT_MISMATCH');
test({...copy(liqRows),settlementEvidence:evidence,cashEntries:[receipt,receipt]},
 'CASH_ENTRIES_INVALID');
test({...copy(liqRows),settlementEvidence:evidence,cashEntries:[{...receipt,eventId:'OTHER'}]},
 'CASH_ENTRIES_INVALID');
test({...copy(liqRows),settlementEvidence:evidence,cashEntries:[{...receipt,postedDate:beforeDate}]},
 'CASH_ENTRIES_INVALID');
test({...copy(liqRows),after:snapshot(date,[row(old,'1','10000')]),settlementEvidence:evidence,cashEntries:[receipt]},
 'UNSETTLED_RESIDUAL_UNITS');
test(input(delisting,[row(old,'10','100000')],[row(old,'0','0')]),
 'DELISTING_SETTLEMENT_METHOD_UNVERIFIED');

// Missing/late snapshots, duplicate rows, nonnumeric/currency precision errors,
// a future-dated corporate action and unsupported ratios must fail closed.
for(const corrupt of [
 {before:{...codeRows.before,verified:true}},
 {after:{...codeRows.after,asOfDate:beforeDate}},
 {before:{...codeRows.before,asOfDate:date}},
 {before:{...codeRows.before,ledgerFingerprint:''}},
 {before:{...codeRows.before,positions:[row(old,'10.12345','100000'),row(replacement,'0','0')]}},
 {after:{...codeRows.after,positions:[row(old,'0','0'),row(replacement,'10','100000.5')]}},
 {before:{...codeRows.before,positions:[row(old,'-1','100000'),row(replacement,'0','0')]}},
 {before:{...codeRows.before,positions:[row(old,'10','100000'),row(replacement,'0','0'),row(old,'10','100000')]}}
]) test({...copy(codeRows),...corrupt},'SNAPSHOT_INPUT_INVALID');

test({...copy(codeRows),event:{...codeChange,effectiveDate:'2026-02-30'}},'EVENT_INVALID');
test({...copy(splitRows),event:{...split,ratioNumerator:0}},'EVENT_INVALID');
test({...copy(mergeRows),event:{...merger,ratioNumerator:2}},'EVENT_INVALID');

// Even when source/target balances and received quote look perfect, the
// already-reviewed PR #704 classifier stays BLOCKED at the action boundary.
const corporateItem={...old,kind:'STOCK',market:'KOSPI',currency:'KRW',
 listingState:'ACTIVE',listingStateAsOf:date,
 listingEvidence:{source:'KRX_OFFICIAL_HISTORY',verified:true,recordId:'SYNTHETIC',
  code:old.code,securityId:old.securityId,codeValidFrom:'2020-01-01',
  codeValidUntilExclusive:null,
  periods:[{state:'ACTIVE',from:'2026-01-01',untilExclusive:'2027-01-01'}]},
 corporateActionEvidence:{source:'KRX_CORPORATE_ACTION_HISTORY',verified:true,
  recordId:'SYNTHETIC',securityId:old.securityId,code:old.code,
  coveredFrom:'2026-01-01',coveredThrough:'2026-12-31',events:[codeChange]}
};
assert.equal(assessNhCorporateActionAsOf(corporateItem,date).status,'BLOCKED');
const close=auditNhHeldCloseCoverage({tradingDate:date,asOf:date+'T16:00:00+09:00',
 ledgerSnapshot:{source:'GAS_VERIFIED_ASOF_LEDGER',asOfDate:date,verified:true,
  positions:[{code:old.code,quantity:10}]},
 masterSnapshot:{source:'GAS_VERIFIED_CODE_MASTER',asOfDate:date,verified:true,
  items:[corporateItem]},
 observations:[{code:old.code,price:71300,source:'NH_PLUG',market:'KRX',
  session:'REGULAR',priceScope:'KRX_REGULAR',priceKind:'DAILY_REGULAR_CLOSE',
  tradingDate:date,sourceDate:date,receivedAt:date+'T15:40:00+09:00',
  officialFinal:false}]});
assert.equal(close.readyForProvisionalMessage,false);
assert.equal(close.issues.CODE_CHANGE_RECONCILIATION_REQUIRED,1);
assert.equal(close.updatedFinancialData,false);
console.log('NH corporate-action pre/post quantity, basis and cash settlement synthetic checks passed; no promotion or mutation');
