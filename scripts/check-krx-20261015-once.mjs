import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runTargetedRecovery} from './run-krx-targeted-recovery.mjs';

const workflow=fs.readFileSync('.github/workflows/krx-20261015-targeted-once.yml','utf8');
assert.match(workflow,/APPROVED_PARENT_SHA: bdb0a9035c7f26de04fc34105d8a8298acdccca5/);
assert.match(workflow,/PRE_PUSH_SHA.*APPROVED_PARENT_SHA/);
assert.match(workflow,/git rev-parse HEAD\^/);
assert.match(workflow,/git cat-file -e/);
assert.match(workflow,/RECOVERY_DATE: '2026-10-15'/);
assert.match(workflow,/steps\.first_install\.outputs\.is_first == 'true'/);
assert.match(workflow,/github\.event_name == 'workflow_dispatch' && inputs\.apply/);
assert.doesNotMatch(workflow,/RECOVERY_APPLY: true/);
const maxRequestMs=3*240000;
const runnerMinutes=Number(workflow.match(/timeout-minutes: (\d+)/)?.[1]);
assert.ok(runnerMinutes*60000>=maxRequestMs+3*60000,'timeout must include source request headroom');

const url='https://script.google.com/macros/s/abc123/exec';
const token='NEVER_LOG_THIS_TOKEN';
const requested=[];
function fake({canRecover=true,applyOk=true}={}){
  return async (_url,options)=>{
    assert.equal(options.method,'POST');
    const body=options.body;
    assert.equal(body.get('action'),'recoverPendingKrxClose');
    assert.equal(body.get('date'),'2026-10-15');
    const mode=body.get('apply');
    assert.ok(mode==='0'||mode==='1');
    requested.push(mode);
    if(body.get('accessToken')!==token)
      return {ok:true,json:async()=>({status:'error',message:'인증 실패'})};
    if(mode==='0')return {ok:true,json:async()=>({
      status:'ok',mode:'DRY_RUN',date:'2026-10-15',ready:canRecover,expected:37
    })};
    return {ok:true,json:async()=>({
      status:'ok',mode:'APPLY',date:'2026-10-15',attempted:true,
      ok:applyOk,remaining:3
    })};
  };
}
const preview=await runTargetedRecovery({url,token,date:'2026-10-15',fetchImpl:fake()});
assert.equal(preview.mode,'DRY_RUN');
assert.deepEqual(requested,['0','0'],'default cannot call GAS apply');
requested.length=0;
await assert.rejects(()=>runTargetedRecovery({url,token,date:'2026-10-15',apply:true,
  fetchImpl:fake({canRecover:false})}),/TARGET_PREFLIGHT_BLOCKED/);
assert.deepEqual(requested,['0','0'],'no data write when official exact-date source missing');
requested.length=0;
const applied=await runTargetedRecovery({url,token,date:'2026-10-15',apply:true,fetchImpl:fake()});
assert.deepEqual(requested,['0','0','1']);
assert.equal(applied.mode,'APPLY');
assert.equal(applied.ok,true);
requested.length=0;
await assert.rejects(()=>runTargetedRecovery({url,token,date:'2026-10-15',apply:true,
  fetchImpl:fake({applyOk:false})}),/TARGET_APPLY_INCOMPLETE_VERIFY_BEFORE_RETRY/);
assert.doesNotMatch(JSON.stringify(applied),/NEVER_LOG_THIS_TOKEN/);
console.log('KRX 2026-10-15 one-time guarded apply: static gate, preflight failure, exact-day safety PASS');
