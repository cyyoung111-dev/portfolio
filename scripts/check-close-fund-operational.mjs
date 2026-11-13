#!/usr/bin/env node
// Offline only: no production GAS, data mutation, or financial source reads.
import assert from 'node:assert/strict';
import {assessCloseFundOperational} from './assess-close-fund-operational.mjs';

const asOf='2026-11-14',closeDate='2026-11-13';
const close={
 closeRunDate:closeDate,storedPriceDate:closeDate,
 snapshotLastDate:closeDate,priceHistoryLastDate:closeDate,
 expectedSnapshotDate:closeDate,snapshotStale:false,
 closeComplete:true,closeState:'COMPLETE',closeStage:'COMPLETE',
 priceCloseState:'COMPLETE',fundCloseState:'DONE',
 priceOk:true,fundOk:true,fundAttemptState:'DONE',
 fundAttemptDate:closeDate,fundFailureClass:'NONE',
 fundErrorPresent:false,pendingKrxDatesCount:0,
 overallStatus:'WARNING',fundWarningPresent:true,
 fundWarningClass:'PARTIAL_FUND_VALUATION'
};
const from='2026-10-14';
const mkFund=(code,changes={})=>({
 code,from,to:asOf,activeDays:code==='F00003'?0:32,
 navMissingDates:[],unpublishedDates:code==='F00003'?[]:[closeDate],
 evaluationPendingDates:[],snapshotPendingDates:[],
 unitsNotAppliedDates:[],unreconciledDates:[],writerBlockedDates:[],
 ...changes
});
const funds=['F00001','F00002','F00003'].map(c=>mkFund(c));
const report=(options={})=>assessCloseFundOperational({
 close,asOf,funds,...options
});
const normal=report();
assert.equal(normal.health,'CLOSE_COMPLETE_NAV_PUBLICATION_PENDING');
assert.equal(normal.actionRequired,false);
assert.deepEqual(normal.publicationPendingFunds,['F00001','F00002']);
assert.deepEqual(normal.overdueFunds,[]);
assert.equal(normal.closePersistedComplete,true);
assert.equal(normal.executionOwnerIndependentlyVerified,false);
assert.deepEqual([normal.financialWrites,normal.gasDeployments,normal.telegramSends],[0,0,0]);
assert.equal(normal.rawOverallStatus,'WARNING','retain the persisted GAS WARNING');
assert.equal(normal.rawFundWarningClass,'PARTIAL_FUND_VALUATION');
const green=report({close:{...close,overallStatus:'NORMAL',
 fundWarningPresent:false,fundWarningClass:'NONE'},
 funds:funds.map(f=>({...f,unpublishedDates:[]}))});
assert.equal(green.health,'CLOSE_DATA_VERIFIED');
assert.equal(green.actionRequired,false);

assert.throws(()=>report({funds:funds.map(f=>({...f,to:'2026-11-13'}))}),
 /CLOSE_FUND_EVIDENCE_SCHEMA/,'date-scoped evidence must reach exact KST audit date');

const staleWarning=report({funds:funds.map(f=>({...f,unpublishedDates:[]}))});
assert.equal(staleWarning.health,'PERSISTED_WARNING_UNCLASSIFIED');
assert.equal(staleWarning.actionRequired,true);
const staleDate=report({close:{...close,storedPriceDate:'2026-11-12'}});
assert.equal(staleDate.health,'CLOSE_INCOMPLETE_OR_UNVERIFIED');
assert.equal(staleDate.actionRequired,true);
const wrongRun=report({close:{...close,closeState:'INCOMPLETE',closeComplete:false}});
assert.equal(wrongRun.health,'CLOSE_INCOMPLETE_OR_UNVERIFIED');
const ownerMismatch=report({close:{...close,fundAttemptDate:'2026-11-12'}});
assert.equal(ownerMismatch.health,'CLOSE_INCOMPLETE_OR_UNVERIFIED');
const oldGap=report({funds:[mkFund('F00001',{navMissingDates:['2026-11-10']}),
 mkFund('F00002'),mkFund('F00003')]});
assert.equal(oldGap.health,'FUND_NAV_OR_DERIVED_OVERDUE');
assert.deepEqual(oldGap.overdueFunds,['F00001']);
const failedDerived=report({funds:[mkFund('F00001'),
 mkFund('F00002',{snapshotPendingDates:['2026-11-12']}),mkFund('F00003')]});
assert.equal(failedDerived.health,'FUND_NAV_OR_DERIVED_OVERDUE');
assert.deepEqual(failedDerived.overdueFunds,['F00002']);
const unexpectedWarning=report({close:{...close,
 fundWarningClass:'SNAPSHOT_PROTECTED'}});
assert.equal(unexpectedWarning.health,'PERSISTED_WARNING_UNCLASSIFIED');
assert.equal(unexpectedWarning.actionRequired,true);
const closedError=report({close:{...close,overallStatus:'ERROR'}});
assert.equal(closedError.health,'CLOSE_INCOMPLETE_OR_UNVERIFIED');
const asOfMonday='2026-11-16';
const monday=report({asOf:asOfMonday,funds:funds.map(f=>({...f,
 from:'2026-10-17',to:asOfMonday}))});
assert.equal(monday.health,'CLOSE_COMPLETE_NAV_PUBLICATION_PENDING',
 'Friday NAV is allowed through Monday before independent publication proof');
const asOfTuesday='2026-11-17';
const tuesday=report({asOf:asOfTuesday,funds:funds.map(f=>({...f,
 from:'2026-10-18',to:asOfTuesday}))});
assert.equal(tuesday.health,'FUND_NAV_OR_DERIVED_OVERDUE');
assert.deepEqual(tuesday.publicationOverdueFunds,['F00001','F00002']);
assert.throws(()=>report({funds:[funds[0],funds[1],funds[1]]}),
 /CLOSE_FUND_EVIDENCE_SCHEMA/,'duplicate fund must never hide a missing fund');
assert.throws(()=>report({funds:[{...funds[0],
 unpublishedDates:[closeDate,closeDate]},funds[1],funds[2]]}),
 /CLOSE_FUND_EVIDENCE_SCHEMA/);
assert.throws(()=>report({asOf:'2026-11-99'}),/CLOSE_FUND_EVIDENCE_SCHEMA/);
assert(!JSON.stringify(normal).includes('1234.56'),
 'operational verdict never emits NAV amounts');
console.log(JSON.stringify({kind:'CLOSE_FUND_OPERATIONAL_OFFLINE_PASS',
 scenarios:16,financialWrites:0,gasDeployments:0,telegramSends:0}));
