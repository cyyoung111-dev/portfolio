import assert from 'node:assert/strict';
import {assessNhHeldSourceIntegration} from './nhplug-held-coverage-integration-gate.mjs';
import {auditNhHeldCloseCoverage} from './nhplug-held-close-coverage-contract.mjs';

const date='2026-10-29',asOf='2026-10-29T16:00:00+09:00';
const ledgerSnapshot={
  source:'GAS_VERIFIED_ASOF_LEDGER',asOfDate:date,verified:false,
  positions:[{code:'005930',quantity:4},{code:'069500',quantity:1}]
};
const masterSnapshot={
  source:'GAS_VERIFIED_CODE_MASTER',asOfDate:date,verified:false,
  items:[
    {code:'005930',kind:'STOCK',market:'KOSPI',currency:'KRW',
      listingState:'UNKNOWN',listingStateAsOf:null},
    {code:'069500',kind:'ETF',market:'ETF',currency:'KRW',
      listingState:'UNKNOWN',listingStateAsOf:null}
  ]
};
const quotes=['005930','069500'].map(code=>({
  code,price:50000,source:'NH_PLUG',market:'KRX',session:'REGULAR',
  priceScope:'KRX_REGULAR',priceKind:'DAILY_REGULAR_CLOSE',tradingDate:date,
  sourceDate:date,receivedAt:'2026-10-29T15:45:00+09:00',officialFinal:false
}));
const bridge705={
  status:'CANDIDATE_NON_ATOMIC_UNVERIFIED',asOfDate:date,readOnly:true,
  verified:false,ledgerSnapshot,masterSnapshot,
  blockers:['NON_ATOMIC_GAS_READ','LISTING_STATUS_UNVERIFIED','SOURCE_PROVENANCE_UNVERIFIED']
};
const proposal706={
  status:'ok',mode:'READ_ONLY_PROPOSAL',asOfDate:date,readOnly:true,
  verified:false,sourceConsistency:'GAS_SCRIPT_LOCK_DOUBLE_READ_MATCH_NOT_ATOMIC',
  ledgerSnapshot,masterSnapshot,
  listingStatusVerified:false
};
const copy=x=>JSON.parse(JSON.stringify(x));
for(const [source,kind] of [[bridge705,'PR705_NON_ATOMIC_BRIDGE'],[proposal706,'PR706_LOCKED_PROPOSAL']]){
 const snapshot=JSON.stringify(source);
 const outcome=assessNhHeldSourceIntegration({candidate:source,tradingDate:date});
 assert.equal(outcome.kind,kind);
 assert.equal(outcome.status,'BLOCKED_SOURCE_UNVERIFIED');
 assert.equal(outcome.canAuditAsVerified,false);
 assert.equal(outcome.canSendTelegram,false);
 assert.equal(outcome.canWriteFinancialData,false);
 assert.equal(outcome.officialClose,false);
 assert.equal(outcome.heldCodeCount,2);
 assert.equal(outcome.masterItemCount,2);
 assert.ok(outcome.blockers.includes('NON_ATOMIC_GAS_SNAPSHOT'));
 assert.ok(outcome.blockers.includes('HISTORICAL_LISTING_EVIDENCE_MISSING'));
 assert.ok(outcome.blockers.includes('SOURCE_INTEGRITY_NOT_PROVEN'));
 assert.equal(JSON.stringify(source),snapshot,'the gate must not mutate financial inputs');
 assert.doesNotMatch(JSON.stringify(outcome),/005930|069500|50000/);
 assert.ok(Object.isFrozen(outcome));

 // Critical: execute PR #704's actual coverage audit, not merely a mocked
 // assertion that a verified boolean is absent.
 assert.throws(()=>auditNhHeldCloseCoverage({
   tradingDate:date,asOf,ledgerSnapshot:source.ledgerSnapshot,
   masterSnapshot:source.masterSnapshot,observations:quotes
 }),/NH_HELD_LEDGER_NOT_VERIFIED/);

 const fakeLedger=copy(source);fakeLedger.ledgerSnapshot.verified=true;
 const modified=assessNhHeldSourceIntegration({candidate:fakeLedger,tradingDate:date});
 assert.ok(modified.blockers.includes('INPUT_CONTRACT_MISMATCH'));
 assert.equal(modified.canAuditAsVerified,false);

 const fakeEverything=copy(source);
 fakeEverything.verified=true;
 fakeEverything.ledgerSnapshot.verified=true;
 fakeEverything.masterSnapshot.verified=true;
 for(const row of fakeEverything.masterSnapshot.items){
   row.listingState='ACTIVE';row.listingStateAsOf=date;
 }
 assert.equal(assessNhHeldSourceIntegration({
   candidate:fakeEverything,tradingDate:date
 }).canSendTelegram,false,'forged verification flags cannot bypass source gate');

 const stale=copy(source);stale.asOfDate='2026-10-28';
 assert.ok(assessNhHeldSourceIntegration({candidate:stale,tradingDate:date})
   .blockers.includes('INPUT_CONTRACT_MISMATCH'));
 const wrongMaster=copy(source);wrongMaster.masterSnapshot.asOfDate='2026-10-28';
 assert.ok(assessNhHeldSourceIntegration({candidate:wrongMaster,tradingDate:date})
   .blockers.includes('INPUT_CONTRACT_MISMATCH'));
 const fakeListing=copy(source);
 fakeListing.masterSnapshot.items[0].listingState='ACTIVE';
 fakeListing.masterSnapshot.items[0].listingStateAsOf=date;
 assert.ok(assessNhHeldSourceIntegration({candidate:fakeListing,tradingDate:date})
   .blockers.includes('INPUT_CONTRACT_MISMATCH'));
 const incomplete=copy(source);incomplete.ledgerSnapshot.positions=[{code:'005930',quantity:0}];
 assert.ok(assessNhHeldSourceIntegration({candidate:incomplete,tradingDate:date})
   .blockers.includes('INPUT_CONTRACT_MISMATCH'));
}

for(const badDate of ['2026-10-09','2026-10-31','2026-02-30','2031-10-29']){
 const out=assessNhHeldSourceIntegration({candidate:bridge705,tradingDate:badDate});
 assert.equal(out.canSendTelegram,false);
 assert.equal(out.kind,'INVALID');
}
const altered=copy(proposal706);
altered.sourceConsistency='FULLY_ATOMIC';
assert.equal(assessNhHeldSourceIntegration({candidate:altered,tradingDate:date}).kind,'INVALID');
const n=assessNhHeldSourceIntegration({candidate:null,tradingDate:date});
assert.equal(n.canAuditAsVerified,false);
const empty=copy(bridge705);empty.ledgerSnapshot.positions=[];
assert.equal(assessNhHeldSourceIntegration({candidate:empty,tradingDate:date}).heldCodeCount,0);
console.log('NH #704/#705/#706 candidate handoff: non-atomic sources cannot become verified/send-ready; synthetic integration passed');
