import assert from 'node:assert/strict';
import {runDaily,DATES} from './run-issue507-daily-finalize.mjs';
import fs from 'node:fs';
assert.deepEqual(DATES,['2026-10-22','2026-10-23','2026-10-26']);
const url='https://script.google.com/macros/s/TEST/exec',token='PRIVATE_TEST';
// Reuse the actual status producer fixture through a captured normalized
// response shape is unnecessary here: stop after both dates with a deliberate
// final-status transport error and assert all earlier financial/queue calls.
function server({apply=false,blocked=false,badApply=false,dates=DATES}={}){
 const writes=[],queue=new Set(dates),calls=[];
 return {writes,queue,calls,fetchImpl:async(_url,{body})=>{
  const action=body.get('action'),date=body.get('dates')||body.get('date'),mode=body.get('apply');calls.push(action);
  let data;
  if(body.get('accessToken')!==token)data={status:'error',message:'인증 실패'};
  else if(action==='getAutomationStatus')throw Error('PRIVATE_FAILURE');
  else if(action==='reconcileCompletedKrxPending'){
   const verified=!blocked;
   if(mode==='1'){writes.push(date);if(!badApply)queue.delete(date);}
   data={status:'ok',mode:mode==='1'?'APPLIED':'DRY_RUN',cleared:mode==='1'?1:0,checked:[{date,queued:mode==='1'?true:queue.has(date),ok:verified,verifiedCodes:verified?2:0,reason:verified?'':'INCOMPLETE_COVERAGE'}]};
  } else if(action==='getKrxHeldCloseCoverage')data={status:'ok',coverage:{mode:'READ_ONLY',requestedDate:date,expectedHeldCodes:2,officialExactDateCodes:0,missingCodes:2,staleCodes:0,duplicateMasterCodes:0,orphanLedgerCodes:0,market:{STOCK:{expected:1,confirmed:0},ETF:{expected:1,confirmed:0}},ready:false}};
  else throw Error('UNEXPECTED_ACTION');
  return {ok:true,json:async()=>data};
 }};
}
for(const apply of [false,true]){const s=server();await assert.rejects(()=>runDaily({url,token,apply,fetchImpl:s.fetchImpl}),/AUTOMATION_DIAG_NETWORK_FAILED/);assert.deepEqual(s.writes,apply?DATES:[]);assert.equal(s.queue.size,apply?0:DATES.length);assert.equal(s.calls.filter(x=>x==='reconcileCompletedKrxPending').length,apply?DATES.length*5:DATES.length*2,'dry-run avoids duplicate proof; apply retains independent readback');}
const blocked=server({blocked:true});await assert.rejects(()=>runDaily({url,token,apply:true,fetchImpl:blocked.fetchImpl}),/AUTOMATION_DIAG_NETWORK_FAILED/);assert.equal(blocked.writes.length,0);assert.ok(!blocked.calls.includes('recoverPendingKrxClose'));
const bad=server({badApply:true});await assert.rejects(()=>runDaily({url,token,apply:true,fetchImpl:bad.fetchImpl}),/DAILY_READBACK/);assert.equal(bad.writes.length,1,'stop before next date on uncertain readback');
const workflow=fs.readFileSync('.github/workflows/issue-507-daily-finalize.yml','utf8');assert.match(workflow,/APPROVED_PARENT: 78f4b15173b087acf58b4d64e1ea7d1ba74cb42a/);assert.match(workflow,/portfolio-production-gas/);
assert.match(workflow,/if: github\.event_name == 'workflow_dispatch' \|\| steps\.first\.outputs\.apply == 'true'/,'Only explicit manual dispatch or approved first installation may hit production GAS');assert.match(workflow,/git cat-file -e/);
console.log('Daily exact-date finalize: dry-run, verified apply, source blocked, queue readback PASS');

// Explicit 10/27 and newly verified 10/29 marker cleanup must never recover or rewrite source data.
for(const date of ['2026-10-27','2026-10-29'])for(const blocked of [false,true]){
 const s=server({blocked,dates:[date]});
 await assert.rejects(()=>runDaily({url,token,apply:true,dates:[date],clearOnly:true,fetchImpl:s.fetchImpl}),/AUTOMATION_DIAG_NETWORK_FAILED/);
 assert.deepEqual(s.writes,blocked?[]:[date]);
 assert.ok(!s.calls.includes('recoverPendingKrxClose')&&!s.calls.includes('getKrxHeldCloseCoverage'));
}
await assert.rejects(()=>runDaily({url,token,dates:['2026-10-28'],clearOnly:true}),/DAILY_DATES/);
assert.match(workflow,/2026-10-22,23,26,27,29/,'manual allowed dates must identify newly verified 10\/29');
