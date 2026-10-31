import assert from 'node:assert/strict';
import {planIssue507Oct30ScopedRevaluation,TARGET_DATE}
 from './issue507-oct30-scoped-valuation-plan.mjs';
import {verifyIssue507Oct30PostState}
 from './issue507-oct30-postwrite-reconciliation.mjs';
import {inspectOct30RepairAdmission,simulateOct30PlannedRecovery}
 from './issue507-oct30-repair-admission-audit.mjs';

// Real cross-module contract test. All prices/positions are fabricated.
// No network, Google Sheets, GAS deployment, or production financial writes.
const names=Array.from({length:37},(_,i)=>String(i+1).padStart(6,'0'));
const holdings=names.map(code=>({code,qty:2,costAmt:400}));
const original=names.map(code=>[
 TARGET_DATE,code,'SYNTHETIC_HOLDING',2,200,400,100,200,-200,-50,
 'KRX_CARRY@2026-10-29',''
]);
for(const [code,nav] of [['F00001',1250],['F00002',1450]]){
 original.push([TARGET_DATE,code,'SYNTHETIC_FUND',1,1000,1000,
  nav,nav,nav-1000,(nav-1000)/10,'FUND_NAV','']);
}
const existingHistory=[
 [TARGET_DATE,'F00001','SYNTHETIC_FUND',1250,'','FUND_NAV'],
 [TARGET_DATE,'F00002','SYNTHETIC_FUND',1450,'','FUND_NAV']
];
const quotes=Object.fromEntries(names.map((code,i)=>[code,{
 price:120+i,usedDate:TARGET_DATE,source:i%2?'KRX_OTP':'KRX'
}]));
const proof={
 mode:'ISSUE507_OCT30_PRIVATE_KRX_QUOTE_PROOF',
 date:TARGET_DATE,status:'PER_CODE_SOURCE_AND_STORAGE_SCOPE_VERIFIED',
 verifiedPrivateQuoteCount:37,individualQuoteValuesDisclosed:false,
 safeToWrite:false
};
const inputs={date:TARGET_DATE,snapshotRows:original,
 historyRows:existingHistory,officialCloses:quotes,
 ledgerHoldings:holdings,sourceEvidence:proof};
const planner=planIssue507Oct30ScopedRevaluation(structuredClone(inputs));
assert.equal(planner.summary.domesticRowRevaluations,37);
assert.equal(planner.summary.safeToApply,false);
const verifiedAfter=planner.privatePlan.domestic.map(x=>structuredClone(x.after))
  .concat(original.slice(37).map(x=>structuredClone(x)));
const verifiedHistory=existingHistory.map(x=>structuredClone(x))
  .concat(planner.privatePlan.priceHistoryInserts.map(x=>structuredClone(x)));
function crossCheck(afterSnapshot=verifiedAfter,afterHistory=verifiedHistory,plan=planner){
 return verifyIssue507Oct30PostState({
  date:TARGET_DATE,beforeSnapshot:structuredClone(original),
  afterSnapshot:structuredClone(afterSnapshot),
  beforeHistory:structuredClone(existingHistory),
  afterHistory:structuredClone(afterHistory),
  plan:structuredClone(plan)
 });
}
const verified=crossCheck();
assert.equal(verified.verifiedDomesticSnapshotRows,37);
assert.equal(verified.verifiedExactPriceHistoryRows,37);
assert.equal(verified.unchangedFundSnapshots,2);
assert.equal(verified.safeToFinalize,false);
const admission=inspectOct30RepairAdmission({
 source:{date:TARGET_DATE,snapshotRows:39,domesticCarried:37,
 domesticHistoryRows:0,fundNavRows:2,fundHistoryRows:2,
 officialExactCount:37,individualPricesVerifiedInsideProtectedProcess:false,
 priceValuesDisclosed:false,dateCodeSourceOneToOne:true},
 provenance:{frozenGasBlob:'9c1a5f31d1abc4b44f7da9af7a50fe3f15967134',
 gasVersion:'9.281',scriptTimezone:'Asia/Seoul',
 sheetTimezoneVerified:false,sourceSameWithinRun:true}
});
assert.equal(admission.status,'BLOCKED');
assert.ok(admission.blockers.includes('PRIVATE_OFFICIAL_SOURCE_OR_ORIGINAL_SCOPE_MISSING'));
assert.ok(admission.blockers.includes('EXPLICIT_WRITE_APPROVAL_MISSING'));
assert.equal(admission.writeAuthorized,false);
const partial=simulateOct30PlannedRecovery([
 {step:'BACKUPS',outcome:'OK'},
 {step:'PRICE_HISTORY',outcome:'TIMEOUT'}
]);
assert.equal(partial.status,'INCIDENT_PARTIAL_UNKNOWN');
assert.equal(partial.autoRetryAuthorized,false);
let failClosed=0;
function rejectRun(kind,edit){
 const post=structuredClone(verifiedAfter),hist=structuredClone(verifiedHistory);
 const clonedPlan=structuredClone(planner);
 edit({post,hist,plan:clonedPlan});
 assert.throws(()=>crossCheck(post,hist,clonedPlan),
  /ISSUE507_OCT30_POSTSTATE_/);
 failClosed++;
}
rejectRun('partial-quote-insert',({hist})=>hist.pop());
rejectRun('fund-nav-changed',({post})=>post[37][7]+=100);
rejectRun('domestic-price-incorrect',({post})=>post[0][7]+=10);
rejectRun('source-mismatch',({hist})=>hist[2][5]='YAHOO');
rejectRun('quantity-rewritten',({post})=>post[0][3]+=1);
rejectRun('price-plan-manipulation',({plan})=>plan.privatePlan.priceHistoryInserts[0][3]+=1);
const invalidQuotes=structuredClone(inputs);
invalidQuotes.officialCloses[names[0]].usedDate='2026-10-29';
assert.throws(()=>planIssue507Oct30ScopedRevaluation(invalidQuotes),
 /ISSUE507_SCOPE_PLAN_OFFICIAL_NOT_EXACT/);
failClosed++;
assert.equal(planner.summary.financialWrites,0);
assert.equal(verified.financialWrites,0);
assert.equal(admission.financialWrites,0);
const publicSummary={mode:'ISSUE507_OCT30_INTEGRATED_SOURCE_ONLY_REGRESSION',
 result:'PASS',modules:3,domestic:37,preservedFunds:2,
 negativeCrossModuleCases:failClosed,unverifiedLivePrices:true,
 writeAuthorized:false,financialWrites:0,gasDeploy:false,nhTokenRequests:0};
for(const sensitive of ['000001','120','SYNTHETIC_HOLDING','SYNTHETIC_FUND'])
 assert.ok(!JSON.stringify(publicSummary).includes(sensitive));
console.log(JSON.stringify(publicSummary));
