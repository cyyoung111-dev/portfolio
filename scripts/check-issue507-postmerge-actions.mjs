import assert from 'node:assert/strict';
import {MERGE_SHA,auditIssue507PostmergeActions} from './audit-issue507-postmerge-actions.mjs';

const repo='cyyoung111-dev/portfolio';
const now=Date.parse('2026-10-31T04:00:00Z');
const times=['2026-10-31T01:00:00Z','2026-10-31T01:30:00Z'];
const run=(id,headSha,event='workflow_run',conclusion='success')=>({
 id,head_sha:headSha,event,conclusion,status:'completed',run_attempt:1,created_at:'2026-10-31T01:45:00Z',
});
const quality=MERGE_SHA.map((sha,i)=>run(101+i,sha,'push'));
const gas=[run(201,MERGE_SHA[0]),run(202,MERGE_SHA[1])];
const skipped={name:'deploy',status:'completed',conclusion:'skipped',run_attempt:1,steps:[]};
const succeeded={name:'deploy',status:'completed',conclusion:'success',run_attempt:1,steps:[
 {name:'Deploy GAS',conclusion:'success'}]};
function mock({qualityRuns=quality,gasRuns=gas,
 jobs={201:[skipped],202:[skipped]},missingJob=false,apiError=false}={}){
 const requests=[];
 const fetchImpl=async(url,opts)=>{
  requests.push({url,method:opts.method,redirect:opts.redirect,authorization:opts.headers.authorization});
  assert.equal(opts.method,'GET');
  assert.equal(opts.redirect,'error');
  assert.equal(opts.headers.authorization,'Bearer SYNTHETIC_TEST_TOKEN');
  if(apiError)return {ok:false,status:403};
  const parsed=new URL(url),path=parsed.pathname;
  let value;
  const commit=MERGE_SHA.findIndex(x=>path.endsWith('/commits/'+x));
  if(commit>=0)value={sha:MERGE_SHA[commit],commit:{committer:{date:times[commit]}}};
  else if(path.endsWith('/workflows/quality-check.yml/runs'))
    value={workflow_runs:qualityRuns};
  else if(path.endsWith('/workflows/gas-deploy.yml/runs'))
    value={workflow_runs:gasRuns};
  else if(/\/runs\/\d+\/jobs$/.test(path)){
    const id=Number(path.match(/\/runs\/(\d+)\/jobs$/)[1]);
    value={jobs:jobs[id]??(missingJob?[]:[skipped])};
  }else throw Error('UNEXPECTED_URL:'+url);
  if(/\/(?:runs|jobs)$/.test(path) &&
    (parsed.searchParams.get('page')!=='1'||parsed.searchParams.get('per_page')!=='100'))
    throw Error('UNEXPECTED_PAGINATION');
  if(path.endsWith('/jobs') && parsed.searchParams.get('filter')!=='all')
    throw Error('LATEST_ATTEMPT_ONLY_UNSAFE');
  return {ok:true,json:async()=>value};
 };
 return {requests,run:()=>auditIssue507PostmergeActions({
   repository:repo,token:'SYNTHETIC_TEST_TOKEN',fetchImpl,now,
 })};
}
let h=mock(),report=await h.run();
assert.equal(report.status,'NO_GAS_DEPLOY_JOB_EXECUTED_IN_SCOPED_ACTIONS');
assert.equal(report.gasRuns.length,2);
assert.deepEqual(report.gasRuns.map(x=>x.classification),['DEPLOY_SKIPPED','DEPLOY_SKIPPED']);
assert.ok(report.qualityListingComplete&&report.gasListingComplete);
assert.equal(report.githubApiReadCalls,6);
assert.equal(report.directGASorFinancialSourceRead,false);
assert.equal(report.productionVersionVerified,false);
assert.equal(report.financeMutationPerformed,false);
assert.equal(report.deploymentTriggered,false);
assert.ok(h.requests.every(x=>x.method==='GET'));
assert.ok(!JSON.stringify(report).includes('SYNTHETIC_TEST_TOKEN'));

// A green GAS workflow is NOT proof of no deployment; any successful actual
// deploy step remains mutation-unverified until independent GAS readback.
h=mock({jobs:{201:[succeeded],202:[skipped]}});
report=await h.run();
assert.equal(report.status,'DEPLOY_STEP_SUCCESS_REQUIRES_SOURCE_READBACK');
assert.equal(report.gasRuns[0].classification,'DEPLOY_STEP_SUCCEEDED_MUTATION_UNVERIFIED');
// A second skipped run attempt CANNOT hide the first attempt's deploy step.
h=mock({gasRuns:[{...gas[0],run_attempt:2},gas[1]],
 jobs:{201:[succeeded,{...skipped,run_attempt:2}],202:[skipped]}});
report=await h.run();
assert.equal(report.status,'DEPLOY_STEP_SUCCESS_REQUIRES_SOURCE_READBACK');
assert.equal(report.gasRuns[0].deploymentAttempts.length,2);
assert.deepEqual(report.gasRuns[0].deploymentAttempts.map(x=>x.attempt),[1,2]);
// If GitHub API omits the first attempt, do not declare no deployment.
h=mock({gasRuns:[{...gas[0],run_attempt:2},gas[1]],
 jobs:{201:[{...skipped,run_attempt:2}],202:[skipped]}});
report=await h.run();
assert.equal(report.status,'DEPLOY_ATTEMPT_OR_GAP_UNVERIFIED');
// PR validation runs cannot masquerade as production deployment attempts.
h=mock({gasRuns:[...gas,run(301,MERGE_SHA[1],'pull_request',null)],
 jobs:{201:[skipped],202:[skipped]}});
report=await h.run();
assert.equal(report.status,'NO_GAS_DEPLOY_JOB_EXECUTED_IN_SCOPED_ACTIONS');
assert.equal(report.excludedPrRuns,1);

// Missing jobs or missing merge quality run must not make a false negative.
h=mock({jobs:{201:[],202:[skipped]}});
report=await h.run();assert.equal(report.status,'DEPLOY_ATTEMPT_OR_GAP_UNVERIFIED');
h=mock({qualityRuns:quality.slice(0,1)});
report=await h.run();assert.equal(report.status,'UNVERIFIED');

// Failed deployment, cancelled or running is still an unknown mutation.
for(const conclusion of ['failure','cancelled',null]){
 h=mock({jobs:{201:[{name:'deploy',conclusion,run_attempt:1,steps:[]}],202:[skipped]}});
 report=await h.run();
 assert.equal(report.status,'DEPLOY_ATTEMPT_OR_GAP_UNVERIFIED');
}
h=mock({apiError:true});
await assert.rejects(()=>h.run(),/ISSUE507_AUDIT_READ_UNVERIFIED/);
await assert.rejects(()=>auditIssue507PostmergeActions({
 repository:'wrong/repository',token:'x',fetchImpl:async()=>{throw Error('unsafe');},now
}),/ISSUE507_AUDIT_PARAMETERS_UNVERIFIED/);
await assert.rejects(()=>auditIssue507PostmergeActions({
 repository:repo,token:'SYNTHETIC_TEST_TOKEN',fetchImpl:async()=>({ok:true,json:async()=>({})}),now
}),/ISSUE507_AUDIT_MERGE_TIMESTAMP_UNVERIFIED/);
console.log(JSON.stringify({test:'ISSUE507_POSTMERGE_AUDIT',
 cases:['both skipped','deploy step success','missing job','missing merge push','failed/cancelled/pending','API failure','invalid repo','unknown timestamps'],
 liveDeploy:false,financialWrites:0,state:'PASS'}));
