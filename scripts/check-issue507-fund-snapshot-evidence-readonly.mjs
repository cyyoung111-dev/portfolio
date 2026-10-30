import assert from 'node:assert/strict';
import fs from 'node:fs';
import {summarizeEvidence,summarizeFullIntegrity,classifySingleFundRepairReview,summarizeExactFundDay,summarizeMismatchScope,diagnoseSnapshot,TARGET_CODE,TARGET_DATE} from './diagnose-fund-snapshot-evidence-readonly.mjs';
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

const actions=[],emitted=[];
await diagnoseSnapshot({url:'https://script.google.com/macros/s/TEST/exec',
 token:'PRIVATE_TOKEN',emit:x=>emitted.push(x),
 fetchImpl:async (_url,{body})=>{
  actions.push(Object.fromEntries(body.entries()));
  const action=body.get('action');
  return {ok:true,json:async()=>action==='getHistoryDetail'?history:action==='getPriceHistory'?prices:action==='diagnoseSnapshotIntegrity'?integrity:body.get('code')==='F00001'?hanwhaStatus:kbStatus};
 }});
assert.deepEqual(actions.map(x=>x.action),['getHistoryDetail','getPriceHistory','diagnoseSnapshotIntegrity','getFundValuationStatus','getFundValuationStatus']);
assert.ok(actions.slice(3).every(x=>x.from===TARGET_DATE&&x.to===TARGET_DATE));
assert.deepEqual(actions.slice(3).map(x=>x.code),['F00001','F00002']);
assert.equal(actions[2].date,TARGET_DATE);
assert.equal(actions[0].date,TARGET_DATE);
assert.equal(actions[1].from,TARGET_DATE);
assert.equal(actions[1].to,TARGET_DATE);
assert.equal(actions[1].codes,TARGET_CODE);
assert.ok(actions.every(x=>x.accessToken==='PRIVATE_TOKEN'));
assert.equal(emitted.length,1);
assert.equal(emitted[0].fundAmountMismatch,true);
assert.equal(emitted[0].fundSourceMismatch,true);
assert.equal(emitted[0].fundDayStates[0].navState,'EXISTING_CONFIRMED');
assert.equal(emitted[0].fundDayStates[1].navState,'NAV_MISSING');
assert.equal(emitted[0].sourceMismatchScope,'TARGET_ONLY');
assert.equal(emitted[0].candidate,true);
assert.deepEqual(emitted[0].blockers,[]);
assert.equal(emitted[0].writeAuthorized,false);
assert.ok(!JSON.stringify(emitted).includes('PRIVATE_TOKEN'));
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
