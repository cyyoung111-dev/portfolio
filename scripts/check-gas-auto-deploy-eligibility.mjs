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
function stub({runs=[makeRun(42)],jobsById={42:[deployedJob]},oldBlob=current,
 headBlob=current,failApi=false,failGit=false}={}){
 const calls={urls:[],git:[]};
 const fetchImpl=async (url,opts)=>{
  calls.urls.push(url);
  assert.equal(opts.headers.authorization,'Bearer '+token);
  if(failApi) return {ok:false,status:403};
  const match=url.match(/\/runs\/(\d+)\/jobs\?/);
  return {ok:true,json:async()=>match?{jobs:jobsById[Number(match[1])]||[]}:{workflow_runs:runs}};
 };
 const gitExec=(_binary,args)=>{
  calls.git.push(args);
  if(failGit)throw Error('PRIVATE_REMOTE_DATA');
  if(args[0]==='fetch')return '';
  if(args[0]==='rev-parse'&&args[1].startsWith('HEAD:'))return headBlob+'\n';
  if(args[0]==='rev-parse')return oldBlob+'\n';
  throw Error('UNEXPECTED_GIT');
 };
 return {calls,call:()=>checkGasAutoDeployEligibility({repository:repo,token,fetchImpl,gitExec})};
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
// A newer validation-only successful run MUST NOT mask an older real deployment.
mock=stub({runs:[makeRun(51,old),makeRun(42)],jobsById:{51:[skippedJob],42:[deployedJob]}});
assert.deepEqual(await mock.call(),{changed:false,reason:'DEPLOYED_SOURCE_MATCH'});
assert.ok(mock.calls.urls.some(u=>u.includes('/runs/42/jobs')));
// A failed deployment on an earlier commit remains pending after a non-GAS commit.
mock=stub({runs:[makeRun(55,old),makeRun(42)],jobsById:{
 55:[{name:'deploy',conclusion:'failure',steps:[{name:'Deploy GAS',conclusion:'failure'}]}],
 42:[deployedJob]},oldBlob:old});
assert.deepEqual(await mock.call(),{changed:true,reason:'DEPLOYED_SOURCE_DIFFERS'});
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
assert.deepEqual(await checkGasAutoDeployEligibility({repository:'other/repo;rm -rf /',token}),{
 changed:true,reason:'PROVENANCE_CONFIG_UNVERIFIED'});
console.log('GAS auto release provenance: confirmed deployed blob only, pending failed release preserved, no secrets PASS');
