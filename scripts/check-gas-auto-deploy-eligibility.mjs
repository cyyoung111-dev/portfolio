import assert from 'node:assert/strict';
import {checkGasAutoDeployEligibility} from './gas-auto-deploy-eligibility.mjs';
const repo='cyyoung111-dev/portfolio',token='PRIVATE_AUTH_VALUE';
const sha='a'.repeat(40),old='c'.repeat(40),current='b'.repeat(40);
const makeRun=(id,hash=sha)=>({
 id,name:'gas-deploy',event:'workflow_run',conclusion:'success',
 head_branch:'main',head_sha:hash,head_repository:{full_name:repo}
});
const deployedJob={name:'deploy',conclusion:'success',steps:[{name:'Deploy GAS',conclusion:'success'}]};
const skippedJob={name:'deploy',conclusion:'skipped',steps:[]};
function stub({runs=[makeRun(42)],pages=null,jobsById={42:[deployedJob]},oldBlob=current,
 headBlob=current,failApi=false,failGit=false,currentRunId=100}={}){
 const calls={urls:[],git:[]};
 const fetchImpl=async (url,opts)=>{
  calls.urls.push(url);
  assert.equal(opts.headers.authorization,'Bearer '+token);
  if(failApi) return {ok:false,status:403};
  const match=url.match(/\/runs\/(\d+)\/jobs\?/);
  const page=Number(url.match(/[?&]page=(\d+)/)?.[1]||1);
  if(!match)assert.match(url,/\/actions\/workflows\/gas-deploy\.yml\/runs\?per_page=100&page=/);
  return {ok:true,json:async()=>match?{jobs:jobsById[Number(match[1])]||[]}
    :{workflow_runs:pages?pages[page-1]||[]:runs}};
 };
 const gitExec=(_binary,args)=>{
  calls.git.push(args);
  if(failGit)throw Error('PRIVATE_REMOTE_DATA');
  if(args[0]==='fetch')return '';
  if(args[0]==='rev-parse'&&args[1].startsWith('HEAD:'))return headBlob+'\n';
  if(args[0]==='rev-parse')return oldBlob+'\n';
  throw Error('UNEXPECTED_GIT');
 };
 return {calls,call:()=>checkGasAutoDeployEligibility({repository:repo,token,currentRunId,fetchImpl,gitExec})};
}
let mock=stub();
let result=await mock.call();
assert.deepEqual(result,{changed:false,reason:'DEPLOYED_SOURCE_MATCH'});
assert.equal(mock.calls.git.filter(x=>x[0]==='fetch').length,1);
assert.equal(mock.calls.urls.length,2);
assert.ok(!JSON.stringify(result).includes(token));
mock=stub({oldBlob:old});
result=await mock.call();
assert.deepEqual(result,{changed:true,reason:'DEPLOYED_SOURCE_DIFFERS'});

// More than 100 unrelated repository runs must not bury a production GAS
// release. Page two's real deployment remains the baseline.
const oneHundredNoOps=Array.from({length:100},(_,i)=>makeRun(1000-i));
mock=stub({pages:[oneHundredNoOps,[makeRun(42)]],jobsById:{42:[deployedJob]}});
assert.deepEqual(await mock.call(),{changed:false,reason:'DEPLOYED_SOURCE_MATCH'});
assert.ok(mock.calls.urls.some(u=>u.includes('gas-deploy.yml/runs?per_page=100&page=2')));
assert.equal(mock.calls.urls.filter(u=>u.includes('/actions/workflows/')).length,2);
assert.ok(mock.calls.git.some(x=>x[0]==='fetch'));
// An unresolved failure from page one still blocks a page-two baseline.
const pageFailure=[{...makeRun(1010),conclusion:'failure'},...oneHundredNoOps.slice(0,99)];
mock=stub({pages:[pageFailure,[makeRun(42)]],jobsById:{42:[deployedJob]}});
assert.deepEqual(await mock.call(),{changed:true,reason:'PROVENANCE_NEWER_DEPLOY_NOT_PROVEN'});
// If the real deploy is beyond the bounded history, fail closed.
const allNoOps=Array.from({length:5},(_,page)=>Array.from({length:100},(_,i)=>makeRun(5000-page*100-i)));
mock=stub({pages:allNoOps});
const pagedMissing=await mock.call();
assert.deepEqual(pagedMissing,{changed:true,reason:'PROVENANCE_NO_PROVEN_DEPLOYMENT'});
assert.equal(mock.calls.urls.filter(u=>u.includes('/actions/workflows/')).length,5);

// A newer validation-only successful run MUST NOT mask an older real deployment.
mock=stub({runs:[makeRun(51,old),makeRun(42)],jobsById:{51:[skippedJob],42:[deployedJob]}});
assert.deepEqual(await mock.call(),{changed:false,reason:'DEPLOYED_SOURCE_MATCH'});
assert.ok(mock.calls.urls.some(u=>u.includes('/runs/42/jobs')));
// A failed deployment on an earlier commit remains pending after a non-GAS commit.
mock=stub({runs:[makeRun(55,old),makeRun(42)],jobsById:{
 55:[{name:'deploy',conclusion:'failure',steps:[{name:'Deploy GAS',conclusion:'failure'}]}],
 42:[deployedJob]},oldBlob:old});
assert.deepEqual(await mock.call(),{changed:true,reason:'DEPLOYED_SOURCE_DIFFERS'});

// Manual releases can mutate the live project even when their source differs
// from the newest successful automatic run; unknown dry-run inputs fail closed.
mock=stub({runs:[{...makeRun(58),event:'workflow_dispatch',conclusion:'success'},makeRun(42)]});
assert.deepEqual(await mock.call(),{
 changed:true,reason:'PROVENANCE_NEWER_DEPLOY_NOT_PROVEN'});
assert.equal(mock.calls.git.length,0,'manual override must prevent false no-op');
mock=stub({runs:[{...makeRun(58),event:'workflow_dispatch',conclusion:'failure'},makeRun(42)]});
assert.equal((await mock.call()).changed,true,'even failed manual may have partially written');
mock=stub({runs:[makeRun(80),{...makeRun(58),event:'workflow_dispatch',conclusion:'success'}],
 jobsById:{80:[deployedJob]}});
assert.deepEqual(await mock.call(),{changed:false,reason:'DEPLOYED_SOURCE_MATCH'});


// A later failed/cancelled or still-running auto deployment may have PUT to
// production before verification/rollback failed. Never suppress recovery.
for(const conclusion of ['failure','cancelled',null]){
 mock=stub({runs:[{...makeRun(61),conclusion},makeRun(42)]});
 const result=await mock.call();
 assert.deepEqual(result,{changed:true,reason:'PROVENANCE_NEWER_DEPLOY_NOT_PROVEN'});
 assert.equal(mock.calls.git.length,0);
}
// Newer successful validation-only auto workflow cannot change deployment.
mock=stub({runs:[{...makeRun(61),conclusion:'success'},makeRun(42)],
 jobsById:{61:[skippedJob],42:[deployedJob]}});
assert.deepEqual(await mock.call(),{changed:false,reason:'DEPLOYED_SOURCE_MATCH'});


// A currently running workflow is in the listing but cannot be a prior
// mutating attempt; exclude exactly its verified run ID, not other pending.
mock=stub({runs:[{...makeRun(100),conclusion:null},makeRun(42)],currentRunId:100});
assert.deepEqual(await mock.call(),{changed:false,reason:'DEPLOYED_SOURCE_MATCH'});
mock=stub({runs:[{...makeRun(101),conclusion:null},{...makeRun(100),conclusion:null},makeRun(42)],currentRunId:100});
assert.deepEqual(await mock.call(),{changed:true,reason:'PROVENANCE_NEWER_DEPLOY_NOT_PROVEN'});
assert.deepEqual(await checkGasAutoDeployEligibility({repository:repo,token,currentRunId:''}),{
 changed:true,reason:'PROVENANCE_CURRENT_RUN_UNVERIFIED'});

for(const options of [
 {runs:[]}, {runs:[makeRun(51)],jobsById:{51:[skippedJob]}},
 {runs:[{...makeRun(42),head_repository:{full_name:'other/repo'}}]},
 {failApi:true}, {failGit:true}, {oldBlob:'NOT_SHA'},
 {jobsById:{42:[{name:'deploy',conclusion:'success',steps:[{name:'Deploy GAS',conclusion:'failure'}]}]}}
]){
 const x=stub(options),out=await x.call();
 assert.equal(out.changed,true,'insufficient proof must NOT disable deployment');
 assert.ok(!JSON.stringify(out).includes(token));
 assert.ok(!JSON.stringify(out).includes('PRIVATE_REMOTE_DATA'));
}
assert.deepEqual(await checkGasAutoDeployEligibility({repository:'other/repo;rm -rf /',token,currentRunId:100}),{
 changed:true,reason:'PROVENANCE_CONFIG_UNVERIFIED'});
console.log('GAS auto release provenance: confirmed deployed blob only, pending failed release preserved, no secrets PASS');
