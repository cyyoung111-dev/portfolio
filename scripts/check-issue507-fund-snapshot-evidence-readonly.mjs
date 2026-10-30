import assert from 'node:assert/strict';
import fs from 'node:fs';
import {summarizeEvidence,diagnoseSnapshot,TARGET_CODE,TARGET_DATE} from './diagnose-fund-snapshot-evidence-readonly.mjs';
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
const actions=[],emitted=[];
await diagnoseSnapshot({url:'https://script.google.com/macros/s/TEST/exec',
 token:'PRIVATE_TOKEN',emit:x=>emitted.push(x),
 fetchImpl:async (_url,{body})=>{
  actions.push(Object.fromEntries(body.entries()));
  const action=body.get('action');
  return {ok:true,json:async()=>action==='getHistoryDetail'?history:prices};
 }});
assert.deepEqual(actions.map(x=>x.action),['getHistoryDetail','getPriceHistory']);
assert.equal(actions[0].date,TARGET_DATE);
assert.equal(actions[1].from,TARGET_DATE);
assert.equal(actions[1].to,TARGET_DATE);
assert.equal(actions[1].codes,TARGET_CODE);
assert.ok(actions.every(x=>x.accessToken==='PRIVATE_TOKEN'));
assert.equal(emitted.length,1);
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
