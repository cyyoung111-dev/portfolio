import assert from 'node:assert/strict';
import {runVerifiedPendingCleanup,APPROVED_DATES} from './finalize-verified-krx-pending.mjs';

const url='https://script.google.com/macros/s/AKfycb-example/exec';
const token='NEVER_PRINT_THIS_TOKEN';
function stub({badDate='',badApply=false}={}){
  const queue=new Set(APPROVED_DATES);
  const calls=[], applied=[];
  const fetchImpl=async (_url,opts)=>{
    assert.equal(opts.method,'POST');
    assert.equal(opts.body.get('action'),'reconcileCompletedKrxPending');
    const date=opts.body.get('dates'),apply=opts.body.get('apply');
    assert.ok(APPROVED_DATES.includes(date),'fixed approved dates only');
    assert.ok(['0','1'].includes(apply));
    calls.push({date,apply});
    if(opts.body.get('accessToken')!==token)
      return {ok:true,json:async()=>({status:'error',message:'인증 실패'})};
    if(apply==='1'){
      if(badApply)return {ok:true,json:async()=>({status:'ok',mode:'APPLIED',
        cleared:2,checked:[{date,queued:true,ok:true,verifiedCodes:37}]})};
      const queued=queue.has(date);
      if(queued){applied.push(date);queue.delete(date);}
      return {ok:true,json:async()=>({status:'ok',mode:'APPLIED',
        cleared:queued?1:0,
        checked:[{date,queued,ok:true,verifiedCodes:37,reason:''}]})};
    }
    return {ok:true,json:async()=>({status:'ok',mode:'DRY_RUN',cleared:0,
      checked:[{date,queued:queue.has(date),
        ok:date!==badDate,verifiedCodes:date===badDate?0:37,
        reason:date===badDate?'SNAPSHOT_INVALID':''}]})};
  };
  return {queue,calls,applied,fetchImpl};
}
const noop=stub();
const dry=await runVerifiedPendingCleanup({url,token,fetchImpl:noop.fetchImpl});
assert.equal(dry.mode,'DRY_RUN');
assert.equal(dry.cleared,0);
assert.equal(noop.applied.length,0,'read-only is the default');
assert.equal(noop.calls.every(x=>x.apply==='0'),true);
const live=stub();
const applied=await runVerifiedPendingCleanup({url,token,apply:true,fetchImpl:live.fetchImpl});
assert.equal(applied.mode,'APPLIED');
assert.deepEqual(live.applied,APPROVED_DATES);
assert.equal(live.queue.size,0);
assert.equal(applied.cleared,3);
assert.equal(applied.remainingApprovedDates,0);
assert.equal(live.calls.filter(x=>x.apply==='1').length,3);
const second=await runVerifiedPendingCleanup({url,token,apply:true,fetchImpl:live.fetchImpl});
assert.equal(second.cleared,0,'retry after success must be idempotent');
assert.equal(second.initialQueued,0);
const corrupt=stub({badDate:'2026-10-13'});
await assert.rejects(()=>runVerifiedPendingCleanup({url,token,apply:true,
  fetchImpl:corrupt.fetchImpl}),/KRX_FINALIZE_DRY_RUN_NOT_VERIFIED/);
assert.equal(corrupt.applied.length,0,'if any source proof fails, change no marker');
const forged=stub({badApply:true});
await assert.rejects(()=>runVerifiedPendingCleanup({url,token,apply:true,
  fetchImpl:forged.fetchImpl}),/KRX_FINALIZE_INVALID_APPLY_RESPONSE/);
assert.ok(forged.queue.size===3);
assert.throws(()=>APPROVED_DATES.push('2026-09-15'),TypeError);
assert.doesNotMatch(JSON.stringify(applied),/NEVER_PRINT_THIS_TOKEN/);
// Deployment safety: workflow file changes after the initial rollout must NOT
// silently re-apply. Verify the gate against an exact, reachable parent commit.
const workflow=(await import('node:fs')).readFileSync(
  '.github/workflows/krx-verified-pending-finalize.yml','utf8');
assert.match(workflow,/fetch-depth: 2/);
assert.match(workflow,/GIT_PREVIOUS_HEAD:/);
assert.match(workflow,/REVIEWED_PARENT_SHA: d18070fa3c85ced8b3f10c7ea83e03d6b264d7f5/);
assert.match(workflow,/GIT_PREVIOUS_HEAD.*REVIEWED_PARENT_SHA/);
assert.match(workflow,/is_first=false/);
assert.match(workflow,/git rev-parse HEAD\^/);
assert.match(workflow,/git cat-file -e/);
assert.match(workflow,/steps\.first_install\.outputs\.is_first == 'true'/);
assert.match(workflow,/github\.event_name == 'workflow_dispatch' && inputs\.apply/);
assert.doesNotMatch(workflow,/github\.event_name == 'push' && '1'/);

console.log('KRX verified pending finalization: exact 3 dates, dry-run gate, idempotence, invalid response PASS');
