import assert from 'node:assert/strict';
import fs from 'node:fs';
import {FUNDS,auditFundRows,summarizeFundRows} from './diagnose-fund-valuation-readonly.mjs';

const DATE='2026-10-28',FROM='2026-10-24',TO='2026-10-30';
const row=(code,date,navState='EXISTING_CONFIRMED',evaluationState='EXISTING_VALID',snapshotState='EXISTING_VALID')=>
 ({code,date,navState,evaluationState,snapshotState,publicationExpected:true,unitsApplied:true,valuationRequired:true,reconciled:true});
const payload=(code,dates)=>
 ({status:'ok',fundResults:{[code]:{code,dates}}});
const sample=summarizeFundRows(payload('F00001',[
 row('F00001',DATE),
 row('F00001',TO,'UNPUBLISHED','WRITE_REQUIRED','NOT_CREATED')
]),'F00001',FROM,TO);
assert.deepEqual(sample,{
 code:'F00001',from:FROM,to:TO,activeDays:2,confirmedNavDays:1,
 navMissingDates:[],unpublishedDates:[TO],evaluationPendingDates:[TO],snapshotPendingDates:[TO],
 unitsNotAppliedDates:[],unreconciledDates:[],writerBlockedDates:[TO]
});
const failed=()=>({...row('F00002',DATE,'NAV_MISSING','WRITE_REQUIRED','NOT_CREATED'),
 unitsApplied:false,reconciled:false});
const blocker=summarizeFundRows(payload('F00002',[failed()]),'F00002',FROM,TO);
assert.deepEqual(blocker.unitsNotAppliedDates,[DATE]);
assert.deepEqual(blocker.unreconciledDates,[DATE]);
assert.deepEqual(blocker.writerBlockedDates,[DATE]);
assert.deepEqual(blocker.navMissingDates,[DATE]);
const noWriteRequired=summarizeFundRows(payload('F00002',[
 {...failed(),evaluationState:'EXISTING_VALID',snapshotState:'EXISTING_VALID'}
]),'F00002',FROM,TO);
assert.deepEqual(noWriteRequired.writerBlockedDates,[],
 'read-only audit must not flag a write blocker when no write is pending');
for(const bad of [
 payload('F00001',[row('F00001','2026-10-99')]),
 payload('F00001',[row('F00001',DATE),row('F00001',DATE)]),
 payload('F00001',[row('F00001',DATE,'PRIVATE_NAV_STATE')]),
 {status:'error',message:'PRIVATE_ACCOUNT'},
]) assert.throws(()=>summarizeFundRows(bad,'F00001',FROM,TO),/FUND_AUDIT_BAD_RESPONSE/);

const seen=[];
const result=await auditFundRows({
 url:'https://script.google.com/macros/s/TEST/exec',token:'PRIVATE_TOKEN',
 now:new Date('2026-10-30T12:00:00Z'),
 fetchImpl:async (_url,options)=>{
  seen.push(Object.fromEntries(options.body.entries()));
  return {ok:true,json:async()=>payload(options.body.get('code'),[row(options.body.get('code'),DATE)])};
 }
});
assert.deepEqual(result.map(x=>x.code),FUNDS);
assert.equal(seen.length,3);
assert.ok(seen.every(x=>x.action==='getFundValuationStatus'&&x.from===FROM&&x.to===TO&&x.accessToken==='PRIVATE_TOKEN'));
assert.deepEqual(seen.map(x=>x.code),FUNDS);
await assert.rejects(
 ()=>auditFundRows({url:'https://script.google.com/macros/s/TEST/exec',token:'PRIVATE_TOKEN',
   now:new Date('2026-10-30T12:00:00Z'),fetchImpl:async()=>{throw Error('PRIVATE_ACCOUNT');}}),
 /FUND_AUDIT_NETWORK_UNVERIFIED/
);
await assert.rejects(
 ()=>auditFundRows({url:'https://script.google.com/macros/s/TEST/exec',token:'PRIVATE_TOKEN',
   now:new Date('2026-10-30T12:00:00Z'),fetchImpl:async()=>({ok:false,status:500})}),
 /FUND_AUDIT_HTTP_UNVERIFIED/
);
const workflow=fs.readFileSync('.github/workflows/issue-507-fund-status-readonly.yml','utf8');
assert.match(workflow,/workflow_dispatch:/);
assert.match(workflow,/paths: \['\.github\/workflows\/issue-507-fund-status-readonly\.yml'\]/,
 'privileged read-only push audit must be limited to its own workflow');
assert.match(workflow,/github\.run_attempt == 1/);
assert.doesNotMatch(workflow,/^  schedule:|^  workflow_run:|--apply|confirm_recovery:/m);
assert.match(workflow,/node scripts\/diagnose-fund-valuation-readonly\.mjs/);
assert.match(workflow,/RESUME_READ_ONLY: '1'/);
assert.match(workflow,/name: Verify KB AQ018 exact source and pending import \(preview only\)/);
assert.match(workflow,/name: Verify Hanwha C-RPe exact source and shared-writer readiness \(preview only\)/);
assert.match(workflow,/run: node scripts\/collect-kb-fund-nav\.mjs\s*(?:\n|$)/);
assert.match(workflow,/run: node scripts\/collect-hanwha-fund-nav\.mjs\s*(?:\n|$)/);
assert.doesNotMatch(workflow,/run:\s*node\s+scripts\/(?:collect-kb-fund-nav|collect-hanwha-fund-nav)\.mjs\s+--apply/);
for(const marker of ['Inspect stored fund NAV, price-history and Snapshot states',
 'Verify KB AQ018 exact source','Verify Hanwha C-RPe exact source']){
 const idx=workflow.indexOf('      - name: '+marker);
 assert.notEqual(idx,-1);
 assert.match(workflow.slice(idx,idx+180),/if: always\(\)/,
  marker+': after previous blocked diagnostic still independently execute');
}

const script=fs.readFileSync('scripts/diagnose-fund-valuation-readonly.mjs','utf8');
assert.ok(script.includes("action:'getFundValuationStatus'"));
assert.doesNotMatch(script,/action:\s*'(?:collectKbFundNav|resumeIncompletePortfolioClose|saveSnapshot|importFundNav)'/);
console.log('issue507 fund valuation read-only audit contracts OK');
