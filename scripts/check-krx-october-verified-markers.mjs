import assert from 'node:assert/strict';
import fs from 'node:fs';
import {APPROVED_DATES,finalizeOctoberMarkers}
  from './finalize-krx-october-verified-markers.mjs';
const url='https://script.google.com/macros/s/AKfycb-test/exec';
const secret='NEVER_ECHO_THIS';
function fixture({failDate='',gasVersion='9.233',badApply=false,uncertainDate=''}={}){
  const queue=new Set(APPROVED_DATES), calls=[], writes=[];
  const fetchImpl=async (_url,opts)=>{
    assert.equal(_url,url);
    assert.equal(opts.method,'POST');
    const action=opts.body.get('action');
    const token=opts.body.get('accessToken');
    assert.ok(['getAutomationStatus','reconcileCompletedKrxPending'].includes(action));
    const date=opts.body.get('dates')||'';
    const apply=opts.body.get('apply')||'';
    calls.push({action,date,apply});
    if(token!==secret)return {ok:true,json:async()=>({status:'error',message:'인증 실패'})};
    if(action==='getAutomationStatus')
      return {ok:true,json:async()=>({status:'ok',automation:{gasVersion}})};
    assert.ok(APPROVED_DATES.includes(date),'strict date whitelist');
    assert.ok(['0','1'].includes(apply));
    if(apply==='1'){
      if(date===uncertainDate)throw Error('HTTP response lost');
      if(badApply)return {ok:true,json:async()=>({
        status:'ok',mode:'APPLIED',cleared:2,checked:[{date,queued:true,ok:true,verifiedCodes:37,reason:''}]
      })};
      const queued=queue.has(date);
      if(queued){writes.push(date);queue.delete(date);}
      return {ok:true,json:async()=>({
        status:'ok',mode:'APPLIED',cleared:queued?1:0,
        checked:[{date,queued,ok:true,verifiedCodes:37,reason:''}]
      })};
    }
    const failed=date===failDate;
    return {ok:true,json:async()=>({
      status:'ok',mode:'DRY_RUN',cleared:0,
      checked:[{date,queued:queue.has(date),ok:!failed,
        verifiedCodes:failed?0:37,
        reason:failed?'FULL_SNAPSHOT_MISMATCH':''}]
    })};
  };
  return {queue,calls,writes,fetchImpl};
}
assert.deepEqual([...APPROVED_DATES],[
  '2026-10-06','2026-10-07','2026-10-08',
  '2026-10-12','2026-10-13','2026-10-14','2026-10-15'
]);
assert.throws(()=>APPROVED_DATES.push('2026-09-15'),TypeError);
const dry=fixture();
const preview=await finalizeOctoberMarkers({url,token:secret,fetchImpl:dry.fetchImpl});
assert.equal(preview.mode,'DRY_RUN');
assert.equal(preview.verifiedDates,7);
assert.equal(preview.cleared,0);
assert.deepEqual(preview.initiallyQueued,APPROVED_DATES);
assert.equal(dry.writes.length,0);
assert.equal(dry.calls.filter(x=>x.apply==='1').length,0);
const run=fixture();
const progress=[];
const result=await finalizeOctoberMarkers({
  url,token:secret,apply:true,fetchImpl:run.fetchImpl,
  onProgress:stage=>progress.push(stage)
});
assert.deepEqual(progress.slice(0,4),[
  'STATUS_START','STATUS_OK','PRECHECK_GROUP_1_START','PRECHECK_GROUP_1_PASS']);
assert.ok(progress.includes('APPLY_1_PASS'));
assert.ok(progress.includes('APPLY_7_PASS'));
assert.ok(progress.includes('POSTCHECK_GROUP_3_PASS'));
assert.doesNotMatch(progress.join(' '),/NEVER_ECHO_THIS/);
assert.deepEqual(run.writes,APPROVED_DATES);
assert.equal(result.cleared,7);
assert.equal(result.remainingApprovedDates,0);
assert.equal(run.queue.size,0);
assert.equal(run.calls.filter(x=>x.apply==='1').length,7);
const rerun=await finalizeOctoberMarkers({url,token:secret,apply:true,fetchImpl:run.fetchImpl});
assert.equal(rerun.cleared,0,'idempotent after completed proof');
assert.equal(rerun.initiallyQueued,0);
assert.equal(run.writes.length,7,'repeated run must not write markers');
const blocked=fixture({failDate:'2026-10-15'});
await assert.rejects(()=>finalizeOctoberMarkers({
  url,token:secret,apply:true,fetchImpl:blocked.fetchImpl
}),/KRX_OCTOBER_PROOF_NOT_VERIFIED/);
assert.equal(blocked.writes.length,0,'fail final preflight means no partial apply');
const wrongVersion=fixture({gasVersion:'9.232'});
await assert.rejects(()=>finalizeOctoberMarkers({
  url,token:secret,apply:true,fetchImpl:wrongVersion.fetchImpl
}),/KRX_OCTOBER_VERSION_UNVERIFIED/);
assert.equal(wrongVersion.writes.length,0);
const bad=fixture({badApply:true});
await assert.rejects(()=>finalizeOctoberMarkers({
  url,token:secret,apply:true,fetchImpl:bad.fetchImpl
}),/KRX_OCTOBER_APPLY_NOT_VERIFIED/);
const uncertain=fixture({uncertainDate:'2026-10-08'});
await assert.rejects(()=>finalizeOctoberMarkers({
  url,token:secret,apply:true,fetchImpl:uncertain.fetchImpl
}),/KRX_OCTOBER_NETWORK_FAILED/);
assert.deepEqual(uncertain.writes,APPROVED_DATES.slice(0,2),
  'uncertain response must not blindly retry or touch later dates');
assert.doesNotMatch(JSON.stringify(result),/NEVER_ECHO_THIS/);
const workflow=fs.readFileSync(
  '.github/workflows/krx-october-verified-marker-cleanup.yml','utf8');
const minutes=Number(workflow.match(/timeout-minutes: (\d+)/)?.[1]);
assert.ok(minutes*60>=2*10*90+7*120+180,
  'time budget must cover preflight, apply, postflight and runner startup');
assert.match(workflow,/REVIEWED_PARENT_SHA: 6fbf6887910c1792c27e99965864b4052725be4d/);
assert.match(workflow,/REVIEWED_RETRY_PARENT_SHA: eed86c47f7d06f2b9cc1ce7239647c470f09e8ea/);
assert.match(workflow,/GIT_PREVIOUS_HEAD.*REVIEWED_RETRY_PARENT_SHA/);
assert.match(workflow,/fetch-depth: 2/);
assert.match(workflow,/git rev-parse HEAD\^/);
assert.match(workflow,/git cat-file -e/);
assert.match(workflow,/steps\.first_install\.outputs\.is_first == 'true'/);
assert.match(workflow,/if: github\.event_name == 'push' && github\.run_attempt == 1/);
assert.match(workflow,/github\.event_name == 'push' && github\.run_attempt == 1 && steps\.first_install\.outputs\.is_first == 'true'/);
assert.match(workflow,/github\.event_name == 'workflow_dispatch' && inputs\.apply/);
assert.doesNotMatch(workflow,/github\.event_name == 'push' && '1'/);
console.log('KRX October 7-date pending marker cleanup: exact whitelist, source contract, proof-first, recheck, retry safety PASS');
