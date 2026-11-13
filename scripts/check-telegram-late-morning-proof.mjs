import assert from 'node:assert/strict';
import fs from 'node:fs';
import {verifyLateScheduledMorningSent as verify} from './telegram-morning-late-sent-readonly.mjs';
const repo='cyyoung111-dev/portfolio',date='2026-11-13',id=43319571808;
const path='.github/workflows/telegram-morning-punctual-arm.yml';
const name='telegram-morning-claim-'+date;
const claim={id:1222301,name,expired:false,created_at:'2026-11-12T22:40:25Z',workflow_run:{id}};
const sent={id:1222302,name:name+'-sent',expired:false,created_at:'2026-11-12T22:40:39Z',workflow_run:{id}};
const run={id,status:'completed',conclusion:'success',head_branch:'main',
 head_repository:{full_name:repo},path,event:'push',run_attempt:1};
const base={date,repository:repo,token:'SYNTHETIC_GITHUB_TOKEN'};
function mock({claimRow=claim,sentRow=sent,runRow=run,fail=false}={}){
 let calls=0;
 const fetchImpl=async(url,opts)=>{
  calls++;
  assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');
  assert.equal(opts.headers.authorization,'Bearer SYNTHETIC_GITHUB_TOKEN');
  assert.ok(String(url).startsWith('https://api.github.com/repos/'+repo+'/actions/'));
  if(fail)return {ok:false};
  const u=new URL(url),v=u.searchParams.get('name');
  if(u.pathname.endsWith('/artifacts')){
   const a=v===name?claimRow:v===name+'-sent'?sentRow:null;
   return {ok:true,json:async()=>({total_count:a?1:0,artifacts:a?[a]:[]})};
  }
  assert.equal(u.pathname,'/repos/'+repo+'/actions/runs/'+id);
  return {ok:true,json:async()=>runRow};
 };
 return {fetchImpl,getCalls:()=>calls};
}
const good=mock();
const verified=await verify({...base,fetchImpl:good.fetchImpl});
assert.deepEqual(verified,{date,status:'LATE_SCHEDULE_ALREADY_SENT',
 verifiedSent:true,financeWrites:0,telegramSends:0,githubReads:3});
assert.equal(good.getCalls(),3);
for(const patch of [
 {sentRow:null},{claimRow:null},{sentRow:{...sent,expired:true}},
 {sentRow:{...sent,created_at:'2026-11-12T23:20:00Z'}},
 {claimRow:{...claim,workflow_run:{id:id+1}}},
 {runRow:{...run,conclusion:'failure'}},{runRow:{...run,head_branch:'feature'}},
 {runRow:{...run,head_repository:{full_name:'other/repo'}}},
 {runRow:{...run,path:'.github/workflows/untrusted.yml'}},
 {runRow:{...run,run_attempt:2}},{fail:true}
])await assert.rejects(verify({...base,fetchImpl:mock(patch).fetchImpl}),
 /TELEGRAM_SCHEDULE_LATE_UNVERIFIED/);
await assert.rejects(verify({...base,repository:'other/repo',fetchImpl:async()=>assert.fail('must not GET')}),
 /TELEGRAM_SCHEDULE_LATE_UNVERIFIED/);
const source=fs.readFileSync('scripts/telegram-morning-workflow.mjs','utf8');
assert.match(source,/GITHUB_EVENT_NAME==='schedule'&&!clock.allowed/);
assert.ok(source.includes('verifyLateScheduledMorningSent('));
assert.match(source,/LATE_SCHEDULE_ALREADY_SENT/);
assert.match(source,/ready=false/);
assert.match(source,/deliverAndRecordWeekday/);
console.log('MORNING_LATE_SCHEDULE_READONLY_PROOF_PASS 12 failure gates; no sends or financial writes');
