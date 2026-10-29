import assert from 'node:assert/strict';
import {assessNhListingAsOf} from './nhplug-listing-asof-contract.mjs';
import {auditNhHeldCloseCoverage} from './nhplug-held-close-coverage-contract.mjs';

const day='2026-10-29';
const clone=x=>JSON.parse(JSON.stringify(x));
const entry={
 code:'005930',securityId:'FIXTURE-ISSUER:001',kind:'STOCK',market:'KOSPI',currency:'KRW',
 corporateActionEvidence:{source:'KRX_CORPORATE_ACTION_HISTORY',verified:true,
  recordId:'SYNTHETIC_ACTION_HISTORY',code:'005930',securityId:'FIXTURE-ISSUER:001',
  coveredFrom:'2026-01-01',coveredThrough:'2026-12-31',events:[]}, 
 listingState:'ACTIVE',listingStateAsOf:day,
 listingEvidence:{
  source:'KRX_OFFICIAL_HISTORY',verified:true,recordId:'SYNTHETIC_NOT_REAL_RECORD',
  securityId:'FIXTURE-ISSUER:001',code:'005930',
  codeValidFrom:'2010-01-01',codeValidUntilExclusive:null,
  periods:[{state:'ACTIVE',from:'2026-01-01',untilExclusive:'2027-01-01'}]
 }
};
const e=patch=>Object.assign(clone(entry),patch);
const result=(item,date=day)=>assessNhListingAsOf(item,date);
assert.equal(result(entry).status,'ACTIVE_PERIOD_MATCH');
assert.equal(result(entry).reason,null);
function reject(item,reason,date=day){
 const r=result(item,date);
 assert.deepEqual(r,{status:'BLOCKED',reason});
 assert.equal(Object.isFrozen(r),true);
}
reject(e({listingEvidence:undefined}),'LISTING_EVIDENCE_MISSING');
reject(e({listingEvidence:{...entry.listingEvidence,verified:false}}),'LISTING_EVIDENCE_INVALID');
reject(e({securityId:'REUSED-OTHER-SECURITY'}),'LISTING_EVIDENCE_INVALID');
reject(e({listingEvidence:{...entry.listingEvidence,code:'000001'}}),'LISTING_EVIDENCE_INVALID');
reject(e({listingEvidence:{...entry.listingEvidence,recordId:''}}),'LISTING_EVIDENCE_INVALID');
reject(e({listingEvidence:{...entry.listingEvidence,source:'MASTER_CURRENT'}}),'LISTING_EVIDENCE_INVALID');
reject(e({listingEvidence:{...entry.listingEvidence,codeValidFrom:'2026-10-30'}}),'CODE_NOT_YET_EFFECTIVE');
reject(e({listingEvidence:{...entry.listingEvidence,codeValidUntilExclusive:day}}),'CODE_EXPIRED');
reject(e({listingEvidence:{...entry.listingEvidence,codeValidUntilExclusive:'2009-01-01'}}),'LISTING_EVIDENCE_INVALID');
reject(e({listingEvidence:{...entry.listingEvidence,codeValidUntilExclusive:'2026-02-30'}}),'LISTING_EVIDENCE_INVALID');
reject(e({listingEvidence:{...entry.listingEvidence,periods:[
 {state:'ACTIVE',from:'2026-01-01',untilExclusive:'2026-10-28'}
]}}),'LISTING_PERIOD_UNVERIFIED');
reject(e({listingEvidence:{...entry.listingEvidence,periods:[
 {state:'ACTIVE',from:'2026-01-01',untilExclusive:'2026-10-30'},
 {state:'SUSPENDED',from:'2026-10-29',untilExclusive:'2026-11-01'}
]}}),'LISTING_EVIDENCE_CONFLICT');
reject(e({listingEvidence:{...entry.listingEvidence,periods:[
 {state:'ACTIVE',from:'2026-01-01',untilExclusive:null},
 {state:'ACTIVE',from:'2026-10-29',untilExclusive:'2026-11-01'}
]}}),'LISTING_EVIDENCE_CONFLICT');
reject(e({listingStateAsOf:'2026-10-28'}),'LISTING_STATUS_CONFLICT');
reject(e({listingState:'SUSPENDED'}),'LISTING_STATUS_CONFLICT');
reject(e({listingEvidence:{...entry.listingEvidence,periods:[
 {state:'SUSPENDED',from:'2026-01-01',untilExclusive:'2027-01-01'}
]}}),'LISTING_STATUS_CONFLICT');
reject(e({listingEvidence:{...entry.listingEvidence,periods:[
 {state:'INVALID',from:'2026-01-01',untilExclusive:'2027-01-01'}
]}}),'LISTING_EVIDENCE_INVALID');

const periods=[
 {state:'ACTIVE',from:'2026-01-01',untilExclusive:'2026-10-29'},
 {state:'SUSPENDED',from:'2026-10-29',untilExclusive:'2026-10-30'},
 {state:'ACTIVE',from:'2026-10-30',untilExclusive:null}
];
const status=(date,state)=>e({
 listingStateAsOf:date,listingState:state,
 listingEvidence:{...entry.listingEvidence,periods}
});
assert.equal(result(status('2026-10-28','ACTIVE'),'2026-10-28').status,'ACTIVE_PERIOD_MATCH',
 'historical status must not be overwritten by present-day suspension');
reject(status(day,'SUSPENDED'),'SUSPENDED_HELD_CODES');
assert.equal(result(status('2026-10-30','ACTIVE'),'2026-10-30').status,'ACTIVE_PERIOD_MATCH');
const delisted=e({listingState:'DELISTED',listingEvidence:{...entry.listingEvidence,periods:[
 {state:'ACTIVE',from:'2026-01-01',untilExclusive:day},
 {state:'DELISTED',from:day,untilExclusive:null}
]}});
reject(delisted,'DELISTED_HELD_CODES');

const quote=date=>({
 code:'005930',price:71300,source:'NH_PLUG',market:'KRX',session:'REGULAR',
 priceScope:'KRX_REGULAR',priceKind:'DAILY_REGULAR_CLOSE',
 tradingDate:date,sourceDate:date,receivedAt:date+'T15:45:00+09:00',officialFinal:false
});
function coverage(item,atDate=day,prices=[]){
 return auditNhHeldCloseCoverage({
  tradingDate:atDate,asOf:atDate+'T16:00:00+09:00',
  ledgerSnapshot:{source:'GAS_VERIFIED_ASOF_LEDGER',verified:true,asOfDate:atDate,
   positions:[{code:'005930',quantity:1}]},
  masterSnapshot:{source:'GAS_VERIFIED_CODE_MASTER',verified:true,asOfDate:atDate,
   items:[item]},observations:prices
 });
}
const suspendedNoQuote=coverage(status(day,'SUSPENDED'));
assert.equal(suspendedNoQuote.issues.SUSPENDED_HELD_CODES,1);
assert.equal(suspendedNoQuote.issues.NH_CLOSE_MISSING,undefined,
 'suspension is a separate reason from a missing NH quote');
assert.equal(suspendedNoQuote.blockedCodes,1);
assert.equal(suspendedNoQuote.missingCodes,0);
assert.equal(suspendedNoQuote.readyForProvisionalMessage,false);
const suspendedHasQuote=coverage(status(day,'SUSPENDED'),day,[quote(day)]);
assert.equal(suspendedHasQuote.issues.SUSPENDED_HELD_CODES,1,
 'a received price must not override a suspension');
assert.equal(suspendedHasQuote.receivedValidCodes,0);
const delistedWithQuote=coverage(delisted,day,[quote(day)]);
assert.equal(delistedWithQuote.issues.DELISTED_HELD_CODES,1);
assert.equal(delistedWithQuote.readyForProvisionalMessage,false);
const inactiveCode=coverage(e({listingEvidence:{...entry.listingEvidence,
 codeValidUntilExclusive:day}}),day,[quote(day)]);
assert.equal(inactiveCode.issues.CODE_EXPIRED,1);
assert.equal(inactiveCode.receivedValidCodes,0);
const noProof=coverage(e({listingEvidence:undefined}),day,[quote(day)]);
assert.equal(noProof.issues.LISTING_EVIDENCE_MISSING,1);
assert.equal(noProof.readyForProvisionalMessage,false);
const past=coverage(status('2026-10-28','ACTIVE'),'2026-10-28',[quote('2026-10-28')]);
assert.equal(past.readyForProvisionalMessage,true,
 'synthetic historical period is valid for the historical day, not proven live');
assert.equal(past.receivedValidCodes,1);
assert.doesNotMatch(JSON.stringify(past),/005930|71300|FIXTURE-ISSUER/);
console.log('NH historical listing interval, code validity, suspension vs missing close synthetic tests passed');
