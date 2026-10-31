import assert from 'node:assert/strict';
import fs from 'node:fs';
import {summarizeEvidence,summarizeFullIntegrity,classifySingleFundRepairReview,summarizeExactFundDay,summarizeMismatchScope,summarizeSourceMismatchKinds,summarizeKnownFundSourcePairs,classifyF00001ScopedReview,runtimeProof,compareRuntimeProofs,diagnoseSnapshot,TARGET_CODE,TARGET_DATE} from './diagnose-fund-snapshot-evidence-readonly.mjs';
const history={status:'ok',date:TARGET_DATE,items:[{code:TARGET_CODE,evalAmt:150,source:'FUND_NAV'}]};
const prices={status:'ok',prices:{[TARGET_CODE]:[{date:TARGET_DATE,price:150,source:'FUND_NAV'}]}};
const run=(h,p)=>summarizeEvidence(h,p);
assert.equal(run(history,prices).classification,'REPRESENTATIVES_MATCH_CHECK_FULL_GAS_PROVENANCE');
assert.equal(run({...history,items:[]},prices).classification,'SNAPSHOT_REPRESENTATIVE_ABSENT');
assert.equal(run(history,{...prices,prices:{}}).classification,'PRICE_REPRESENTATIVE_ABSENT');
assert.equal(run({...history,items:[{...history.items[0],evalAmt:151}]},prices).classification,'REPRESENTATIVE_AMOUNT_DIFFERENT');
assert.equal(run({...history,items:[{...history.items[0],source:'FUND_NAV_CARRY@2026-10-29'}]},prices).classification,'REPRESENTATIVE_SOURCE_TEXT_DIFFERENT');
assert.throws(()=>run({...history,items:[history.items[0],history.items[0]]},prices),/AMBIGUOUS_ROWS/);
assert.throws(()=>run({...history,items:[{...history.items[0],source:'PRIVATE_ACCOUNT'}]},prices),/BAD_RESPONSE/);
assert.throws(()=>run({status:'error',message:'PRIVATE_ACCOUNT'},prices),/BAD_RESPONSE/);
const integrity={status:'ok',diagnostic:{
 date:TARGET_DATE,status:'MISMATCH',expectedRowCount:38,storedRowCount:38,
 expectedCodes:[TARGET_CODE],storedCodes:[TARGET_CODE],missingCodes:[],unexpectedCodes:[],
 evalAmtMismatches:[{code:TARGET_CODE,expected:200,stored:150}],
 sourceMismatches:[{code:TARGET_CODE,expected:'FUND_NAV',stored:'FUND_NAV_CARRY'}],
 qtyMismatches:[],costAmtMismatches:[],evalUnitMismatches:[],priceIntegrity:[{code:TARGET_CODE,status:'VALID'}],
 expectedRows:[[TARGET_DATE,TARGET_CODE],...Array.from({length:37},(_,i)=>[TARGET_DATE,'OTHER'+i])],
 storedRows:[[TARGET_DATE,TARGET_CODE],...Array.from({length:37},(_,i)=>[TARGET_DATE,'OTHER'+i])],
 duplicateKeys:[],conflictKeys:[],sourceDataErrors:[]
}};
const recomputed=summarizeFullIntegrity(integrity);
assert.deepEqual({status:recomputed.integrityStatus,amount:recomputed.fundAmountMismatch,
 source:recomputed.fundSourceMismatch,price:recomputed.fundPriceIntegrityState},
 {status:'MISMATCH',amount:true,source:true,price:'VALID'});
assert.ok(!JSON.stringify(recomputed).includes('200'));
assert.ok(!JSON.stringify(recomputed).includes('150'));
assert.throws(()=>summarizeFullIntegrity({status:'ok',diagnostic:{...integrity.diagnostic,status:'PRIVATE'}}),/BAD_INTEGRITY/);
assert.throws(()=>summarizeFullIntegrity({status:'error',message:'PRIVATE_TOKEN'}),/BAD_INTEGRITY/);


// One target fund only, equal row counts, full persisted rows, and no other errors.
const scope=classifySingleFundRepairReview(integrity);
assert.equal(scope.candidate,true);
assert.deepEqual(scope.blockers,[]);
assert.equal(scope.writeAuthorized,false);
assert.equal(scope.mutationPerformed,false);
assert.equal(scope.requiresBackup,true);
assert.equal(scope.requiresWriterExclusion,true);
const mutate=patch=>({status:'ok',diagnostic:{...integrity.diagnostic,...patch}});
for(const patch of [
 {evalAmtMismatches:[integrity.diagnostic.evalAmtMismatches[0],{code:'OTHER',expected:1,stored:2}]},
 {sourceMismatches:[integrity.diagnostic.sourceMismatches[0],{code:'OTHER',expected:'A',stored:'B'}]},
 {evalUnitMismatches:[{code:'OTHER'}]},
 {qtyMismatches:[{code:TARGET_CODE}]},
 {missingCodes:['OTHER']},
 {expectedRowCount:39},
 {storedRows:[]},
 {sourceDataErrors:['PRIVATE_ACCOUNT']},
 {duplicateKeys:[TARGET_DATE+'|'+TARGET_CODE]},
 {conflictKeys:[TARGET_DATE+'|'+TARGET_CODE]},
 {priceIntegrity:[{code:TARGET_CODE,status:'MISMATCH'}]},
 {priceIntegrity:[{code:TARGET_CODE,status:'VALID'},{code:'OTHER',status:'MISMATCH'}]},
 {status:'SOURCE_INCOMPLETE'},
 {status:'VALID'}
]){
 const blocked=classifySingleFundRepairReview(mutate(patch));
 assert.equal(blocked.candidate,false,JSON.stringify(Object.keys(patch)));
 assert.equal(blocked.writeAuthorized,false);
 assert.equal(blocked.classification,'REPAIR_PREFLIGHT_BLOCKED');
 assert.ok(blocked.blockers.length>=1,'blocked result must explain why');
 assert.ok(blocked.blockers.every(x=>/^[A-Z_]+$/.test(x)),'enum only');
 assert.ok(!JSON.stringify(blocked).includes('PRIVATE_ACCOUNT'));
}


// Only sanitized static labels are emitted; never expose raw codes, numbers or errors.
const amountUnit=classifySingleFundRepairReview(mutate({evalUnitMismatches:[{code:TARGET_CODE,expected:999999999,stored:777777777}]}));
assert.deepEqual(amountUnit.blockers,['EVALUATION_UNIT_MISMATCH']);
assert.ok(!JSON.stringify(amountUnit).includes('999999999'));
assert.ok(!JSON.stringify(amountUnit).includes('777777777'));
const unrelated=classifySingleFundRepairReview(mutate({sourceMismatches:[{code:TARGET_CODE},{code:'PRIVATE_CODE'}]}));
assert.deepEqual(unrelated.blockers,['SOURCE_SCOPE']);
assert.ok(!JSON.stringify(unrelated).includes('PRIVATE_CODE'));


const activeRow=(code,navState='EXISTING_CONFIRMED',publicationExpected=true)=>({
 code,date:TARGET_DATE,navState,publicationExpected,evaluationState:'EXISTING_VALID',
 snapshotState:code===TARGET_CODE?'WRITE_REQUIRED':'EXISTING_VALID',reconciled:true});
const hanwhaStatus={status:'ok',fundResults:{F00001:{code:'F00001',dates:[activeRow('F00001')]}}};
const kbStatus={status:'ok',fundResults:{F00002:{code:'F00002',dates:[activeRow('F00002','NAV_MISSING')]}}};
assert.deepEqual(summarizeExactFundDay(hanwhaStatus,'F00001'),{
 code:'F00001',date:TARGET_DATE,active:true,navState:'EXISTING_CONFIRMED',publicationExpected:true,
 evaluationState:'EXISTING_VALID',snapshotState:'WRITE_REQUIRED'});
assert.equal(summarizeExactFundDay(kbStatus,'F00002').navState,'NAV_MISSING');
assert.equal(summarizeExactFundDay({status:'ok',fundResults:{F00002:{code:'F00002',dates:[]}}},'F00002').active,false);
assert.throws(()=>summarizeExactFundDay({status:'error',secret:'PRIVATE'},'F00001'),/BAD_FUND_STATUS/);
assert.throws(()=>summarizeExactFundDay({status:'ok',fundResults:{F00001:{code:'F00001',dates:[
 activeRow('F00001'),activeRow('F00001')]}}},'F00001'),/BAD_FUND_STATUS/);
const mismatch=summarizeMismatchScope(integrity);
assert.deepEqual(mismatch,{
 unitMismatchScope:'NONE',sourceMismatchScope:'TARGET_ONLY',evaluationAmountMismatchScope:'TARGET_ONLY'});
const multiMismatch=mutate({evalUnitMismatches:[{code:TARGET_CODE,expected:888888,stored:777777}],
 sourceMismatches:[{code:TARGET_CODE,expected:'FUND_NAV',stored:'FUND_NAV_CARRY'},
 {code:'PRIVATE_HOLDING_CODE',expected:'OTHER_PRIVATE',stored:'ANOTHER_PRIVATE'}]});
assert.deepEqual(summarizeMismatchScope(multiMismatch),{
 unitMismatchScope:'TARGET_ONLY',sourceMismatchScope:'TARGET_AND_OTHER',evaluationAmountMismatchScope:'TARGET_ONLY'});
assert.ok(!JSON.stringify(summarizeMismatchScope(multiMismatch)).includes('PRIVATE'));
assert.throws(()=>summarizeMismatchScope(mutate({sourceMismatches:[{code:null}]})),/BAD_INTEGRITY/);


const withSource=patch=>({status:'ok',diagnostic:{...integrity.diagnostic,...patch}});
const rawSources=withSource({
 sourceMismatches:[
  {code:TARGET_CODE,expected:'FUND_NAV',stored:'FUND_NAV_CARRY@2026-10-29'},
  {code:'F00002',expected:'FUND_NAV_CARRY@2026-10-29',stored:'FUND_NAV_CARRY'},
  {code:'PRIVATE_OTHER_STOCK',expected:'NH_REGULAR_CLOSE',stored:'UNVERIFIED_SOURCE_NAME'}],
 fundNavStates:[{code:'F00002',sourceDate:'2026-10-29'}]
});
const classified=summarizeSourceMismatchKinds(rawSources);
assert.deepEqual(classified,{
 targetSourceKinds:{expectedSourceKind:'CONFIRMED_NAV',storedSourceKind:'CARRY_NAV',carryAliasReview:false},
 otherMismatchCount:2,otherFundCount:1,otherNonFundCount:1,
 otherCarryAliasReviewCount:1,otherNonAliasCount:1,
 allOtherSourceDifferencesCarryAliases:false,writeAuthorized:false});
assert.ok(!JSON.stringify(classified).includes('PRIVATE'));
assert.ok(!JSON.stringify(classified).includes('2026-10-29'));
const aliasesOnly=withSource({
 sourceMismatches:[
  {code:TARGET_CODE,expected:'FUND_NAV',stored:'FUND_NAV_CARRY'},
  {code:'F00002',expected:'FUND_NAV_CARRY@2026-10-29',stored:'FUND_NAV_CARRY'}],
 fundNavStates:[{code:'F00002',sourceDate:'2026-10-29'}]});
assert.equal(summarizeSourceMismatchKinds(aliasesOnly).allOtherSourceDifferencesCarryAliases,true);
assert.equal(summarizeSourceMismatchKinds(withSource({
 sourceMismatches:[{code:'F00002',expected:'FUND_NAV_CARRY@2026-10-29',stored:'FUND_NAV_CARRY'}],
 fundNavStates:[]})).otherCarryAliasReviewCount,0,'alias requires proven sourceDate');
assert.throws(()=>summarizeSourceMismatchKinds(withSource({sourceMismatches:[
 {code:'PRIVATE',expected:'PRIVATE',stored:'PRIVATE'}]})),/BAD_INTEGRITY/);
assert.throws(()=>summarizeSourceMismatchKinds(withSource({sourceMismatches:[
 {code:TARGET_CODE,expected:'FUND_NAV',stored:'MANUAL'},
 {code:TARGET_CODE,expected:'FUND_NAV',stored:'MANUAL'}]})),/BAD_INTEGRITY/);


// The other exact source-only mismatch must be attributable to a known fund,
// with no guessed underlying NAV, dates, amount or other asset identities.
const carryFundStatus=withSource({
 sourceMismatches:[
  {code:TARGET_CODE,expected:'FUND_NAV',stored:'FUND_NAV_CARRY@2026-10-29'},
  {code:'F00002',expected:'FUND_NAV_CARRY@2026-10-29',stored:'FUND_NAV_CARRY_INPUT_REQUIRED@2026-10-29'}],
 fundNavStates:[{code:'F00002',sourceDate:'2026-10-29'}]
});
assert.deepEqual(summarizeKnownFundSourcePairs(carryFundStatus),{
 knownFundSourcePairs:{
  F00002:{mismatch:true,expectedKind:'CARRY_NAV',storedKind:'CARRY_INPUT_REQUIRED',
    expectedCarryDateMatchesNav:true,storedCarryDateMatchesNav:true,
    bothCarryFamilies:true,confirmedNavExpected:false,writeAuthorized:false},
  F00003:{mismatch:false}
 }
});
const changedProvider=withSource({
 sourceMismatches:[{code:'F00002',expected:'FUND_NAV',stored:'FUND_NAV_CARRY'}],
 fundNavStates:[{code:'F00002',sourceDate:'2026-10-29'}]
});
const observed=summarizeKnownFundSourcePairs(changedProvider).knownFundSourcePairs.F00002;
assert.deepEqual({expectedKind:observed.expectedKind,storedKind:observed.storedKind,
 bothCarry:observed.bothCarryFamilies},{expectedKind:'CONFIRMED_NAV',
 storedKind:'CARRY_NAV',bothCarry:false});
assert.equal(observed.expectedCarryDateMatchesNav,null);
const dateConflict=withSource({
 sourceMismatches:[{code:'F00003',expected:'FUND_NAV_CARRY@2026-10-28',stored:'FUND_NAV_CARRY_INPUT_REQUIRED'}],
 fundNavStates:[{code:'F00003',sourceDate:'2026-10-29'}]
});
const f3=summarizeKnownFundSourcePairs(dateConflict).knownFundSourcePairs.F00003;
assert.equal(f3.expectedCarryDateMatchesNav,false);
assert.equal(f3.storedCarryDateMatchesNav,null);
for(const input of [
 {sourceMismatches:[{code:'F00002',expected:'PRIVATE',stored:'PRIVATE'}]},
 {sourceMismatches:[{code:'F00002',expected:'FUND_NAV',stored:'MANUAL'},
                    {code:'F00002',expected:'FUND_NAV',stored:'MANUAL'}]},
 {sourceMismatches:[{code:'F00002',expected:null,stored:'MANUAL'}]},
 {sourceMismatches:[{code:'F00002',expected:'FUND_NAV',stored:'MANUAL'}],
  fundNavStates:[{code:'F00002',sourceDate:'2026-10-29'},
   {code:'F00002',sourceDate:'2026-10-29'}]}
])assert.throws(()=>summarizeKnownFundSourcePairs(withSource(input)),/BAD_INTEGRITY/);
const noUnknownLeak=withSource({sourceMismatches:[
 {code:'UNKNOWN_PRIVATE_ASSET',expected:'OTHER_PROVIDER_SECRET',stored:'PRIVATE_TOKEN'}]});
assert.ok(!JSON.stringify(summarizeKnownFundSourcePairs(noUnknownLeak)).includes('PRIVATE'));


// Review only: F00001 confirmed NAV needs exact single-row review, while the
// F00002 missing-Friday NAV label must remain intact and NEVER be auto-erased.
const reviewFixture=withSource({
 expectedCodes:[TARGET_CODE,'F00002'],storedCodes:[TARGET_CODE,'F00002'],
 expectedRows:[[TARGET_DATE,TARGET_CODE],[TARGET_DATE,'F00002'],...Array.from({length:36},(_,i)=>[TARGET_DATE,'OTHER'+i])],
 storedRows:[[TARGET_DATE,TARGET_CODE],[TARGET_DATE,'F00002'],...Array.from({length:36},(_,i)=>[TARGET_DATE,'OTHER'+i])],
 evalUnitMismatches:[{code:TARGET_CODE,expected:888,stored:777}],
 sourceMismatches:[
  {code:TARGET_CODE,expected:'FUND_NAV',stored:'FUND_NAV_CARRY@2026-10-29'},
  {code:'F00002',expected:'FUND_NAV_CARRY@2026-10-29',stored:'FUND_NAV_CARRY_INPUT_REQUIRED'}],
 fundNavStates:[{code:'F00002',sourceDate:'2026-10-29'}],
 priceIntegrity:[{code:TARGET_CODE,status:'VALID'},{code:'F00002',status:'VALID'}]
});
const review=classifyF00001ScopedReview(reviewFixture,hanwhaStatus,kbStatus);
assert.equal(review.reviewOnlyCandidate,true);
assert.equal(review.existingSingleFundGateBlocked,true);
assert.equal(review.retainF00002MissingNavWarning,true);
assert.equal(review.writeAuthorized,false);
assert.equal(review.mutationPerformed,false);
assert.equal(review.requiresBackup,true);
assert.equal(review.requiresWriterExclusion,true);
assert.equal(review.requiresExplicitApproval,true);
assert.deepEqual(review.blockers,[]);
assert.ok(!JSON.stringify(review).includes('888'));
for(const [mutation,secondStatus] of [
 [{qtyMismatches:[{code:'F00002'}]}],
 [{evalAmtMismatches:[{code:TARGET_CODE},{code:'F00002'}]}],
 [{sourceMismatches:[{code:TARGET_CODE,expected:'FUND_NAV',stored:'FUND_NAV_CARRY@2026-10-29'},
     {code:'F00002',expected:'FUND_NAV_CARRY@2026-10-29',stored:'MANUAL'}]}],
 [{sourceMismatches:[{code:TARGET_CODE,expected:'FUND_NAV',stored:'FUND_NAV_CARRY@2026-10-29'},
     {code:'F00002',expected:'FUND_NAV_CARRY@2026-10-29',stored:'FUND_NAV_CARRY_INPUT_REQUIRED'},
     {code:'PRIVATE_ACCOUNT',expected:'MANUAL',stored:'OTHER'}]}],
 [{priceIntegrity:[{code:TARGET_CODE,status:'VALID'},{code:'F00002',status:'SUSPICIOUS'}]}],
 [{sourceMismatches:[
  {code:TARGET_CODE,expected:'FUND_NAV',stored:'FUND_NAV_CARRY@2026-10-29'},
  {code:'F00002',expected:'FUND_NAV_CARRY@2026-10-29',
   stored:'FUND_NAV_CARRY_INPUT_REQUIRED@2026-10-28'}]}],
 [{sourceDataErrors:['PRIVATE_SECRET']}],
 [{expectedRowCount:39}],
 [{storedRows:[]}],
 [{evalUnitMismatches:[]}],
 [{sourceMismatches:reviewFixture.diagnostic.sourceMismatches,
    fundNavStates:[{code:'F00002',sourceDate:'2026-10-28'}]}],
 [{}, {...kbStatus,fundResults:{F00002:{code:'F00002',dates:[activeRow('F00002','EXISTING_CONFIRMED')]}}}]
]){
 const payload=withSource({...reviewFixture.diagnostic,...mutation});
 const result=classifyF00001ScopedReview(payload,hanwhaStatus,secondStatus||kbStatus);
 assert.equal(result.reviewOnlyCandidate,false,JSON.stringify(Object.keys(mutation)));
 assert.equal(result.writeAuthorized,false);
 assert.equal(result.retainF00002MissingNavWarning,true);
 assert.ok(result.blockers.length>=1);
 assert.ok(result.blockers.every(x=>/^[A-Z_]+$/.test(x)));
 assert.ok(!JSON.stringify(result).includes('PRIVATE'));
}

const statusV281={status:'ok',gasVersion:'9.281',automation:{gasVersion:'9.281'}};
const strictRange={status:'ok',checkedDates:[TARGET_DATE],
 diagnostics:[{date:TARGET_DATE}],strictSourceDigest:'a'.repeat(64),
 integritySourceRevision:'101'};
assert.equal(runtimeProof(statusV281,strictRange).version,'9.281');
assert.deepEqual(compareRuntimeProofs(runtimeProof(statusV281,strictRange),
 runtimeProof(statusV281,strictRange)),{
 gasVersionVerified:'9.281',sourceStableWithinRun:true,liveWriteAuthorized:false});
assert.throws(()=>runtimeProof({...statusV281,gasVersion:'9.283'},strictRange),/VERSION_UNVERIFIED/);
assert.throws(()=>runtimeProof({...statusV281,automation:{gasVersion:'9.282'}},strictRange),
 /VERSION_UNVERIFIED/);
assert.throws(()=>runtimeProof(statusV281,{...strictRange,strictSourceDigest:'PRIVATE'}),
 /SOURCE_PROOF_UNVERIFIED/);
assert.throws(()=>compareRuntimeProofs(runtimeProof(statusV281,strictRange),
 {...runtimeProof(statusV281,strictRange),version:'9.282'}),/RUNTIME_VERSION_CHANGED/);
assert.throws(()=>compareRuntimeProofs(runtimeProof(statusV281,strictRange),
 {...runtimeProof(statusV281,strictRange),sourceDigest:'b'.repeat(64)}),/SOURCE_CHANGED/);
assert.throws(()=>compareRuntimeProofs(runtimeProof(statusV281,strictRange),
 {...runtimeProof(statusV281,strictRange),sourceRevision:'102'}),/SOURCE_CHANGED/);
const actions=[],emitted=[];
await diagnoseSnapshot({url:'https://script.google.com/macros/s/TEST/exec',
 token:'PRIVATE_TOKEN',emit:x=>emitted.push(x),
 fetchImpl:async (_url,{body})=>{
  actions.push(Object.fromEntries(body.entries()));
  const action=body.get('action');
  return {ok:true,json:async()=>action==='getAutomationStatus'?statusV281
    :action==='diagnoseSnapshotIntegrityRange'?strictRange
    :action==='getHistoryDetail'?history:action==='getPriceHistory'?prices
    :action==='diagnoseSnapshotIntegrity'?integrity
    :body.get('code')==='F00001'?hanwhaStatus:kbStatus};
 }});
assert.deepEqual(actions.map(x=>x.action),[
 'getAutomationStatus','diagnoseSnapshotIntegrityRange',
 'getHistoryDetail','getPriceHistory','diagnoseSnapshotIntegrity',
 'getFundValuationStatus','getFundValuationStatus',
 'getAutomationStatus','diagnoseSnapshotIntegrityRange']);
assert.ok(actions.slice(5,7).every(x=>x.from===TARGET_DATE&&x.to===TARGET_DATE));
assert.ok([1,8].every(i=>actions[i].dates===TARGET_DATE&&actions[i].strictReadonly==='1'));
assert.deepEqual(actions.slice(5,7).map(x=>x.code),['F00001','F00002']);
assert.equal(actions[4].date,TARGET_DATE);
assert.equal(actions[2].date,TARGET_DATE);
assert.equal(actions[3].from,TARGET_DATE);
assert.equal(actions[3].to,TARGET_DATE);
assert.equal(actions[3].codes,TARGET_CODE);
assert.ok(actions.every(x=>x.accessToken==='PRIVATE_TOKEN'));
assert.equal(emitted.length,1);
assert.equal(emitted[0].gasVersionVerified,'9.281');
assert.equal(emitted[0].sourceStableWithinRun,true);
assert.equal(emitted[0].liveWriteAuthorized,false);
assert.ok(!JSON.stringify(emitted).includes(strictRange.strictSourceDigest));
assert.ok(!JSON.stringify(emitted).includes(strictRange.integritySourceRevision));
assert.equal(emitted[0].fundAmountMismatch,true);
assert.equal(emitted[0].fundSourceMismatch,true);
assert.equal(emitted[0].fundDayStates[0].navState,'EXISTING_CONFIRMED');
assert.equal(emitted[0].fundDayStates[1].navState,'NAV_MISSING');
assert.equal(emitted[0].sourceMismatchScope,'TARGET_ONLY');
assert.equal(emitted[0].targetSourceKinds.expectedSourceKind,'CONFIRMED_NAV');
assert.equal(emitted[0].otherMismatchCount,0);
assert.deepEqual(emitted[0].knownFundSourcePairs,{F00002:{mismatch:false},F00003:{mismatch:false}});
assert.equal(emitted[0].writeAuthorized,false);
assert.equal(emitted[0].scopedRepairReview.writeAuthorized,false);
assert.equal(emitted[0].scopedRepairReview.reviewOnlyCandidate,false);
assert.equal(emitted[0].candidate,true);
assert.deepEqual(emitted[0].blockers,[]);
assert.equal(emitted[0].writeAuthorized,false);
assert.ok(!JSON.stringify(emitted).includes('PRIVATE_TOKEN'));
// A stale or changing run must fail without producing an approved-looking
// read-only assessment or exposing source digests / private financial rows.
for(const scenario of ['VERSION_DRIFT','SOURCE_DRIFT','MISSING_DIGEST']){
 let statusReads=0,sourceReads=0;
 const failedEmissions=[];
 const fake=async(_url,{body})=>{
  const action=body.get('action');
  let result;
  if(action==='getAutomationStatus'){
   statusReads++;
   const version=scenario==='VERSION_DRIFT'&&statusReads===2?'9.282':'9.281';
   result={status:'ok',gasVersion:version,automation:{gasVersion:version}};
  }else if(action==='diagnoseSnapshotIntegrityRange'){
   sourceReads++;
   result=scenario==='MISSING_DIGEST'
     ?{...strictRange,strictSourceDigest:null}
     :scenario==='SOURCE_DRIFT'&&sourceReads===2
       ?{...strictRange,strictSourceDigest:'b'.repeat(64)}:strictRange;
  }else if(action==='getHistoryDetail')result=history;
  else if(action==='getPriceHistory')result=prices;
  else if(action==='diagnoseSnapshotIntegrity')result=integrity;
  else if(action==='getFundValuationStatus')
   result=body.get('code')==='F00001'?hanwhaStatus:kbStatus;
  else throw Error('WRITE_ACTION_FORBIDDEN');
  return {ok:true,json:async()=>result};
 };
 await assert.rejects(()=>diagnoseSnapshot({url:'https://script.google.com/macros/s/TEST/exec',
    token:'PRIVATE_TOKEN',fetchImpl:fake,emit:x=>failedEmissions.push(x)}),
   /FUND_SNAPSHOT_(?:RUNTIME_VERSION_CHANGED|SOURCE_CHANGED|SOURCE_PROOF_UNVERIFIED)/);
 assert.equal(failedEmissions.length,0);
}
for(const mock of [
 async()=>{throw Error('PRIVATE_ACCOUNT')},
 async()=>({ok:false,status:500}),
 async()=>({ok:true,json:async()=>{throw Error('PRIVATE_ACCOUNT')}})
]){
 await assert.rejects(()=>diagnoseSnapshot({url:'https://script.google.com/macros/s/TEST/exec',token:'PRIVATE_TOKEN',fetchImpl:mock}),/FUND_SNAPSHOT_(?:NETWORK|HTTP|JSON)_UNVERIFIED/);
}
const workflow=fs.readFileSync('.github/workflows/issue-507-fund-snapshot-evidence-readonly.yml','utf8');
assert.match(workflow,/workflow_dispatch:/);
assert.match(workflow,/refs\/heads\/main/);
assert.match(workflow,/node scripts\/diagnose-fund-snapshot-evidence-readonly\.mjs/);
assert.doesNotMatch(workflow,/^  schedule:|^  workflow_run:|--apply|confirm_recovery:/m);
const code=fs.readFileSync('scripts/diagnose-fund-snapshot-evidence-readonly.mjs','utf8');
for(const denied of ['collectKbFundNav','resumeIncompletePortfolioClose','saveSnapshot','getSnapshotRepairStatus','issue507Maintenance'])
 assert.ok(!code.includes("read('"+denied+"'"));
console.log('issue507 focused Snapshot read-only evidence contracts OK');
