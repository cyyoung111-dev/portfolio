#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {summarizeMasterCoverage,summarizeSnapshotIntegrity,
 classifySnapshotSourceLabels,auditPost9295,
 SNAPSHOT_DATE,REQUIRED_GAS_VERSION} from './audit-post9295-source-reconciliation-readonly.mjs';

const codeMaster={status:'ok',gasVersion:'9.295',readOnly:true,codes:[
 {code:'005930',currency:'KRW'},{code:'000660',currency:'KRW'},
 {code:'F00001',currency:'KRW'},{code:'AAPL',currency:'USD'}]};
const holdings={status:'ok',holdings:[
 {code:'005930',qty:5,assetType:'주식'},
 {code:'AAPL',qty:2,assetType:'해외주식'},
 {code:'MSFT',qty:3,assetType:'해외주식'},
 {code:'F00001',qty:0,assetType:'펀드'},
 {code:'000660',qty:0,assetType:'주식'}]};
const trades={status:'ok',trades:[
 {code:'005930',assetType:'주식'},{code:'AAPL',assetType:'해외주식'},
 {code:'MSFT',assetType:'해외주식'},{code:'F00001',assetType:'펀드'}]};
const cover=summarizeMasterCoverage(codeMaster,holdings,trades);
assert.equal(cover.masterUsdRows,1);
assert.equal(cover.distinctActiveNonFundCodes,3);
assert.equal(cover.matchedActiveCodes,2);
assert.equal(cover.unmatchedActiveCodes,1);
assert.equal(cover.unmatchedUsTickerShapeHints,1);
assert.equal(cover.explicitlyForeignTaggedUnmatchedActiveCodes,1);
assert.equal(cover.historicalUsTickerShapeNotInMaster,1);
assert.equal(cover.classification,'ACTIVE_HOLDINGS_CODE_COVERAGE_REVIEW');
assert.equal(cover.externalBrokerageCoverageVerified,false);
assert.equal(cover.ledgerVsHoldingsQuantityReconciled,false);
assert.equal(cover.financialWrites,0);
for(const secret of ['005930','AAPL','MSFT','F00001'])
 assert(!JSON.stringify(cover).includes(secret),'never log security codes');
assert.throws(()=>summarizeMasterCoverage({...codeMaster,codes:[
 ...codeMaster.codes,codeMaster.codes[0]]},holdings,trades),/MASTER_CODES_UNVERIFIED/);
assert.throws(()=>summarizeMasterCoverage({...codeMaster,gasVersion:'9.294'},
 holdings,trades),/MASTER_SCHEMA/);
assert.throws(()=>summarizeMasterCoverage(codeMaster,holdings,
 {status:'ok',trades:{}}),/TRADES_SCHEMA/);
const krOnly=summarizeMasterCoverage({...codeMaster,
 codes:codeMaster.codes.filter(x=>x.currency==='KRW')},
 {status:'ok',holdings:[holdings.holdings[0]]},
 {status:'ok',trades:[trades.trades[0]]});
assert.equal(krOnly.masterUsdRows,0);
assert.equal(krOnly.unmatchedActiveCodes,0);
assert.equal(krOnly.classification,'CONNECTED_MASTER_NO_USD_ROWS');
assert.equal(krOnly.externalBrokerageCoverageVerified,false,
 'no connected USD codes is not proof user has no US brokerage assets');

const arrays=Object.fromEntries(['missingCodes','unexpectedCodes',
 'duplicateKeys','conflictKeys','qtyMismatches','costAmtMismatches',
 'evalUnitMismatches','evalAmtMismatches','sourceMismatches',
 'sourceDataErrors'].map(k=>[k,[]]));
const diagnostic={date:SNAPSHOT_DATE,status:'VALID',
 expectedRowCount:39,storedRowCount:39,totalEvalDifference:0,
 duplicateSummary:{groups:0},
 priceIntegrity:[{status:'VALID',code:'SECRET_STOCK'}],
 fundNavStates:[{code:'F00001'}],...arrays,
 // Values below MUST NOT leak into the audit summary.
 expectedRows:[[SNAPSHOT_DATE,'PRIVATE',10,20,3000]],
 storedRows:[[SNAPSHOT_DATE,'PRIVATE',10,20,3000]],
 totalStoredEvalAmt:123456789,totalExpectedEvalAmt:123456789};
const packet={status:'ok',checkedDates:[SNAPSHOT_DATE],
 diagnostics:[diagnostic],
 strictSourceDigest:'b'.repeat(64),integritySourceRevision:'opaque-private-revision',
 performance:{totalMs:20000,readMs:13000,indexBuildMs:3000,
 calculationMs:4000}};
const clean=summarizeSnapshotIntegrity(packet);
assert.equal(clean.status,'RECALC_MATCH_CONFIRMED');
assert.equal(clean.financialAmountsRecomputedAndMatched,true);
assert.equal(clean.fullSourceProvenanceMatched,true);
assert.equal(clean.manualSourceLabelReviewOpen,false);
assert.equal(clean.expectedRows,39);
assert.equal(clean.storedRows,39);
assert.equal(clean.differenceZeroVerified,true);
assert.equal(clean.strictSourceDigestPresent,true);
assert.equal(clean.rangeTotalMs,20000);
assert.equal(clean.financialWrites,0);
assert.equal(clean.officialExternalSourceIndependentlyVerified,false);
assert.equal(clean.processWriterOwnerIndependentlyVerified,false);
assert(!JSON.stringify(clean).includes('PRIVATE'));
assert(!JSON.stringify(clean).includes('123456789'));
const mismatched={...diagnostic,status:'MISMATCH',
 sourceMismatches:[
  {code:'F00001',expected:'FUND_NAV_CARRY@2026-11-13',
   stored:'FUND_NAV_CARRY'},
  {code:'F00002',expected:'FUND_NAV',stored:'FUND_NAV_CARRY'}
 ],
 fundNavStates:[
  {code:'F00001',sourceDate:'2026-11-13'},
  {code:'F00002',sourceDate:'2026-11-13'}]
};
const labelKinds=classifySnapshotSourceLabels(mismatched);
assert.equal(labelKinds.fundSourceLabelMismatchRows,2);
assert.equal(labelKinds.nonFundSourceLabelMismatchRows,0);
assert.equal(labelKinds.exactNavDatedCarryAliasReviewCandidates,1);
assert.equal(labelKinds.allMismatchesResolved,false);
assert.equal(labelKinds.automaticRepairAuthorized,false);
assert(labelKinds.labelKindPairs.some(x=>x.pair==='DATED_FUND_NAV_CARRY__VS__UNDATED_FUND_NAV_CARRY'&&x.count===1));
const mismatchOut=summarizeSnapshotIntegrity({...packet,diagnostics:[mismatched]});
assert.equal(mismatchOut.status,'RECALC_VALUES_CONFIRMED_NAV_CARRY_LABEL_REVIEW',
 'exact dated carry may be NON-WRITE label review but not full source parity');
assert.equal(mismatchOut.integrityState,'MISMATCH');
assert.equal(mismatchOut.financialAmountsRecomputedAndMatched,true);
assert.equal(mismatchOut.fullSourceProvenanceMatched,false);
assert.equal(mismatchOut.manualSourceLabelReviewOpen,true);
assert.equal(mismatchOut.automaticRepairAuthorized,false);
assert.equal(mismatchOut.sourceLabelReview.fundSourceLabelMismatchRows,2);
for(const delta of [
 {sourceMismatches:[{code:'F00001',expected:'FUND_NAV_CARRY@2026-11-12',
    stored:'FUND_NAV_CARRY'},...mismatched.sourceMismatches.slice(1)]},
 {evalAmtMismatches:[{code:'F00001',expected:100,stored:101}]},
 {priceIntegrity:[{status:'FX_MISSING'}]},
 {totalEvalDifference:1},
 {duplicateSummary:{groups:1}}
]){
 const v=summarizeSnapshotIntegrity({...packet,diagnostics:[{...mismatched,...delta}]});
 assert.equal(v.status,'RECALC_REVIEW_REQUIRED');
 assert.equal(v.financialAmountsRecomputedAndMatched,false);
 assert.equal(v.automaticRepairAuthorized,false);
}
for(const secret of ['F00001','F00002','2026-11-13','PRIVATE'])
 assert(!JSON.stringify(mismatchOut.sourceLabelReview).includes(secret));
assert.throws(()=>classifySnapshotSourceLabels({...mismatched,
 sourceMismatches:[{code:'PRIVATE',expected:'FUND_NAV',stored:'FUND_NAV'}]}),
 /POST9295_SOURCE_LABEL_ROW_SCHEMA/);
for(const delta of [
 {diagnostic:{...diagnostic,status:'MISMATCH',
  evalAmtMismatches:[{code:'PRIVATE',amount:123456789}]}},
 {diagnostic:{...diagnostic,totalEvalDifference:1}},
 {diagnostic:{...diagnostic,duplicateSummary:{groups:1}}},
 {diagnostic:{...diagnostic,storedRowCount:38}},
 {strictSourceDigest:''},
 {integritySourceRevision:''}
]){
 const changed={...packet,...delta};
 if(delta.diagnostic)changed.diagnostics=[delta.diagnostic];
 const value=summarizeSnapshotIntegrity(changed);
 assert.equal(value.status,'RECALC_REVIEW_REQUIRED');
 assert(!JSON.stringify(value).includes('123456789'));
}
assert.throws(()=>summarizeSnapshotIntegrity({...packet,
 checkedDates:['2026-11-13']}),/SNAPSHOT_SCHEMA/);
assert.throws(()=>summarizeSnapshotIntegrity({...packet,
 diagnostics:[{...diagnostic,evalUnitMismatches:'not-array'}]}),
 /SNAPSHOT_ISSUES_SCHEMA/);

const endpoint='https://script.google.com/macros/s/TEST_READ_ONLY/exec';
const calls=[],reports=[];
const request=async(url,options)=>{
 assert.equal(url,endpoint);
 assert.equal(options.method,'POST');
 assert.equal(options.body.get('accessToken'),'PRIVATE_AUTH_123456789');
 const action=options.body.get('action');
 calls.push(action);
 const opts=Object.fromEntries(options.body);
 assert.deepEqual(Object.keys(opts).sort(),action==='diagnoseSnapshotIntegrityRange'
  ?['accessToken','action','dates','strictReadonly']
  :['accessToken','action']);
 if(action==='diagnoseSnapshotIntegrityRange'){
  assert.equal(opts.strictReadonly,'1');
  assert.equal(opts.dates,SNAPSHOT_DATE);
 }
 const response=action==='getCodeListReadOnly'?codeMaster:
  action==='getHoldings'?holdings:
  action==='getTrades'?trades:packet;
 return {ok:true,json:async()=>response};
};
const read=await auditPost9295({url:endpoint,token:'PRIVATE_AUTH_123456789',
 fetchImpl:request,report:x=>reports.push(x)});
assert.equal(read.coverage.classification,'ACTIVE_HOLDINGS_CODE_COVERAGE_REVIEW');
assert.equal(read.snapshot.status,'RECALC_MATCH_CONFIRMED');
assert.deepEqual(calls,['getCodeListReadOnly','getHoldings','getTrades',
 'diagnoseSnapshotIntegrityRange']);
assert.equal(reports.length,2);
assert(!JSON.stringify(reports).includes('AAPL'));
await assert.rejects(()=>auditPost9295({url:endpoint,token:'PRIVATE_AUTH_123456789',
 fetchImpl:request,mode:'write'}),/POST9295_MODE_INVALID/);
await assert.rejects(()=>auditPost9295({url:endpoint,token:'',
 fetchImpl:request}),/POST9295_AUTH_MISSING/);
const workflowSource=fs.readFileSync(
 '.github/workflows/portfolio-9295-source-integrity-readonly.yml','utf8');
assert.match(workflowSource,/environment: portfolio-production-gas/);
assert.match(workflowSource,/group: portfolio-heavy-gas-readonly/);
assert.match(workflowSource,/cancel-in-progress: false/);
assert.match(workflowSource,/if: github.event_name == 'workflow_dispatch'/,
 'further one-shot pushes must run only Snapshot, not re-export the whole ledger');
assert.match(workflowSource,/strict.*Snapshot|Snapshot.*strict/i);
assert.match(workflowSource,/workflow_dispatch/);
assert(!/schedule:/.test(workflowSource));
assert(!/--apply|saveNhConfig|syncTrades|updateContent|runDailyClose|collectFundNav/.test(workflowSource));
assert.deepEqual(workflowSource.split('\n')
 .map(x=>x.trim()).filter(x=>x.startsWith('run: node scripts/audit-post9295'))
 .map(x=>x.slice(5)),[
 'node scripts/audit-post9295-source-reconciliation-readonly.mjs coverage',
 'node scripts/audit-post9295-source-reconciliation-readonly.mjs snapshot']);
const script=fs.readFileSync('scripts/audit-post9295-source-reconciliation-readonly.mjs','utf8');
assert.doesNotMatch(script,/saveNhConfig|syncTrades|putRange|setValues|SnapshotWriter|rebuildSnapshot/);
console.log('POST9295_SOURCE_RECONCILIATION_CONTRACT_OK '+JSON.stringify({
 scenarios:17,privateValuesLogged:false,liveCalls:0,financialWrites:0,
 gasDeployments:0,hasExplicitSnapshotProof:true
}));
