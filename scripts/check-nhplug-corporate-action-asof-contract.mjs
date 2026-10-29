import assert from 'node:assert/strict';
import {assessNhCorporateActionAsOf} from './nhplug-corporate-action-asof-contract.mjs';
import {auditNhHeldCloseCoverage} from './nhplug-held-close-coverage-contract.mjs';

const day='2026-10-29',prior='2026-10-28',next='2026-10-30';
const copy=x=>JSON.parse(JSON.stringify(x));
const old={code:'005930',securityId:'SECURITY-A'};
const newCode={code:'000001',securityId:'SECURITY-A'};
const newSecurity={code:'000002',securityId:'SECURITY-B'};
const spinTarget={code:'000003',securityId:'SECURITY-C'};
const action=(type,source=old,targets=[],effectiveDate=day,fields={})=>({
 type,eventId:'EVENT:'+type+':001',source,targets,effectiveDate,...fields
});
const source={source:'KRX_CORPORATE_ACTION_HISTORY',verified:true,recordId:'SYNTHETIC_NOT_REAL',
 code:old.code,securityId:old.securityId,coveredFrom:'2026-01-01',
 coveredThrough:'2026-12-31',events:[]};
const listing={source:'KRX_OFFICIAL_HISTORY',verified:true,
 recordId:'SYNTHETIC_LISTING_NOT_REAL',securityId:old.securityId,code:old.code,
 codeValidFrom:'2020-01-01',codeValidUntilExclusive:null,
 periods:[{state:'ACTIVE',from:'2026-01-01',untilExclusive:'2027-01-01'}]};
const item={...old,kind:'STOCK',market:'KOSPI',currency:'KRW',
 listingState:'ACTIVE',listingStateAsOf:day,listingEvidence:listing,
 corporateActionEvidence:source};
const variant=(event,changes={})=>{
 const x=copy(item);
 x.corporateActionEvidence.events=event?[event]:[];
 return Object.assign(x,changes);
};
const classify=(v,d=day)=>assessNhCorporateActionAsOf(v,d);
const reject=(v,reason,d=day)=>{
 const actual=classify(v,d);
 assert.equal(actual.status,'BLOCKED');
 assert.equal(actual.reason,reason);
 assert.equal(actual.automaticCodeMapping,false);
 assert.equal(actual.ledgerMutationAllowed,false);
 assert.equal(actual.priceCarryForwardAllowed,false);
 assert.equal(Object.isFrozen(actual),true);
};
const quote=(code='005930',date=day)=>({code,price:71300,source:'NH_PLUG',market:'KRX',
 session:'REGULAR',priceScope:'KRX_REGULAR',priceKind:'DAILY_REGULAR_CLOSE',
 tradingDate:date,sourceDate:date,receivedAt:date+'T15:45:00+09:00',officialFinal:false});
function coverage(v,quotes=[quote()],date=day){
 return auditNhHeldCloseCoverage({tradingDate:date,asOf:date+'T16:00:00+09:00',
  ledgerSnapshot:{source:'GAS_VERIFIED_ASOF_LEDGER',asOfDate:date,verified:true,
   positions:[{code:v.code,quantity:10}]},
  masterSnapshot:{source:'GAS_VERIFIED_CODE_MASTER',asOfDate:date,verified:true,
   items:[{...v,listingStateAsOf:date}]},
  observations:quotes});
}
assert.equal(classify(item).status,'NO_EFFECTIVE_ACTION');
assert.equal(coverage(item).readyForProvisionalMessage,true,
 'only the synthetic no-action snapshot with all other evidence can pass');

reject(variant(null,{corporateActionEvidence:undefined}),'ACTION_EVIDENCE_MISSING');
for(const change of [
 {source:'LATEST_MASTER'}, {verified:false}, {recordId:''},
 {securityId:'REUSED-DIFFERENT-SECURITY'}, {code:'123456'},
 {coveredFrom:'2027-01-01'}, {coveredThrough:'2026-02-30'},
 {events:'not-an-array'}
]){
 const v=variant(null);
 Object.assign(v.corporateActionEvidence,change);
 reject(v,'ACTION_EVIDENCE_INVALID');
}
const gap=variant(null);
gap.corporateActionEvidence.coveredThrough=prior;
reject(gap,'ACTION_EVIDENCE_DATE_GAP');
const late=action('CODE_CHANGE',old,[newCode],next);
assert.equal(classify(variant(late)).status,'NO_EFFECTIVE_ACTION',
 'future event must not overwrite the pre-event holding');
const change=action('CODE_CHANGE',old,[newCode],day);
reject(variant(change),'CODE_CHANGE_RECONCILIATION_REQUIRED');
const oldChange=variant(change);
const oldReport=coverage(oldChange);
assert.equal(oldReport.issues.CODE_CHANGE_RECONCILIATION_REQUIRED,1);
assert.equal(oldReport.issues.NH_CLOSE_MISSING,undefined);
assert.equal(oldReport.receivedValidCodes,0);
assert.equal(oldReport.readyForProvisionalMessage,false);
const succ=variant(change,{code:newCode.code,securityId:newCode.securityId,
 corporateActionEvidence:{...source,code:newCode.code,securityId:newCode.securityId,
  events:[change]},
 listingEvidence:{...listing,code:newCode.code,securityId:newCode.securityId}});
reject(succ,'CODE_CHANGE_RECONCILIATION_REQUIRED'); // no automatic successor alias
assert.equal(coverage(succ,[quote(newCode.code)]).readyForProvisionalMessage,false);
reject(variant(action('MERGER',old,[newSecurity])),'MERGER_RECONCILIATION_REQUIRED');
const mergedTarget=variant(action('MERGER',old,[newSecurity]),{
 code:newSecurity.code,securityId:newSecurity.securityId,
 corporateActionEvidence:{...source,code:newSecurity.code,securityId:newSecurity.securityId,
  events:[action('MERGER',old,[newSecurity])]},
 listingEvidence:{...listing,code:newSecurity.code,securityId:newSecurity.securityId}
});
reject(mergedTarget,'MERGER_RECONCILIATION_REQUIRED');
reject(variant(action('SPINOFF',old,[newSecurity,spinTarget])),'SPINOFF_RECONCILIATION_REQUIRED');
reject(variant(action('SPLIT',old,[],day,{ratioNumerator:2,ratioDenominator:1})),
 'SPLIT_RECONCILIATION_REQUIRED');
reject(variant(action('REVERSE_SPLIT',old,[],day,{ratioNumerator:1,ratioDenominator:10})),
 'REVERSE_SPLIT_RECONCILIATION_REQUIRED');
reject(variant(action('ETF_LIQUIDATION',old,[])),'ETF_LIQUIDATION_SETTLEMENT_UNVERIFIED');
const etf=variant(action('ETF_LIQUIDATION',old,[]),{kind:'ETF',market:'ETF'});
const liq=coverage(etf);
assert.equal(liq.issues.ETF_LIQUIDATION_SETTLEMENT_UNVERIFIED,1);
assert.equal(liq.issues.NH_CLOSE_MISSING,undefined);
assert.equal(liq.receivedValidCodes,0);
assert.equal(liq.updatedFinancialData,false);
assert.equal(liq.readyForProvisionalMessage,false);
reject(variant(action('DELISTING',old,[])),'DELISTING_SETTLEMENT_UNVERIFIED');
const ending=variant(action('DELISTING',old,[]));
assert.equal(coverage(ending,[]).issues.DELISTING_SETTLEMENT_UNVERIFIED,1,
 'delisting cash settlement is not the same as a missing NH price');

const invalidEvents=[
 action('SPLIT',old,[],day,{ratioNumerator:0,ratioDenominator:1}),
 action('SPLIT',old,[],day,{ratioNumerator:1.5,ratioDenominator:1}),
 action('REVERSE_SPLIT',old,[],day,{ratioNumerator:1,ratioDenominator:1}),
 action('CODE_CHANGE',old,[newSecurity]),
 action('CODE_CHANGE',old,[newCode,newSecurity]),
 action('MERGER',old,[newCode]),
 action('SPINOFF',old,[newCode]),
 action('ETF_LIQUIDATION',old,[newCode]),
 action('DELISTING',old,[newCode]),
 action('UNRECOGNIZED',old,[]),
 action('MERGER',old,[newSecurity],day,{ratioNumerator:2}),
 action('SPLIT',old,[],day,{ratioNumerator:2,ratioDenominator:0})
];
for(const event of invalidEvents)reject(variant(event),'ACTION_EVENT_INVALID');
reject(variant(action('CODE_CHANGE',{code:'999999',securityId:'SECURITY-D'},
 [{code:'999998',securityId:'SECURITY-D'}])),
 'ACTION_EVENT_NOT_FOR_SECURITY');
reject(variant(action('MERGER',{code:old.code,securityId:'SECURITY-IMPOSTOR'},[newSecurity])),
 'ACTION_SECURITY_IDENTITY_CONFLICT');

const dup=variant(change);
dup.corporateActionEvidence.events=[change,change];
reject(dup,'ACTION_EVENT_DUPLICATE');
const unordered=variant(change);
unordered.corporateActionEvidence.events=[
 action('SPLIT',old,[],day,{ratioNumerator:2,ratioDenominator:1}),
 action('CODE_CHANGE',old,[newCode],prior)
];
reject(unordered,'ACTION_EVENT_UNORDERED');
const conflicting=variant(change);
conflicting.corporateActionEvidence.events=[
 action('SPLIT',old,[],day,{ratioNumerator:2,ratioDenominator:1}),
 action('CODE_CHANGE',old,[newCode],day)
];
reject(conflicting,'ACTION_MULTIPLE_SAME_DATE');
const pastEvent=variant(action('CODE_CHANGE',old,[newCode],prior));
reject(pastEvent,'CODE_CHANGE_RECONCILIATION_REQUIRED');
const historical=variant(action('CODE_CHANGE',old,[newCode],day),{listingStateAsOf:prior});
assert.equal(classify(historical,prior).status,'NO_EFFECTIVE_ACTION',
 'later corporate action must not rewrite historical position in the contract');
assert.doesNotMatch(JSON.stringify(oldReport),/005930|000001|SECURITY|71300/);
console.log('NH corporate actions: rename, merger, spinoff, split, liquidation and as-of barriers PASS (synthetic only)');
