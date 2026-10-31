// Issue #507: read-only GitHub Actions provenance for PR #787/#788 merges.
// No GAS, Sheets, market-data, Telegram or GitHub mutation endpoints are used.
import {pathToFileURL} from 'node:url';

export const MERGE_SHA=Object.freeze([
 'c2298b9ad69b806cffd8eb4ba0115ac10098858a',
 '7a46531e6a27927389f576b78243d0c44ebedcc4',
]);
const REPO='cyyoung111-dev/portfolio';
const API='https://api.github.com';
const hash=/^[0-9a-f]{40}$/;
const iso=x=>typeof x==='string'&&!Number.isNaN(Date.parse(x))?Date.parse(x):NaN;

export async function auditIssue507PostmergeActions({
 repository=REPO,mergeShas=MERGE_SHA,token,fetchImpl=fetch,now=Date.now(),
 maxPages=10
}={}){
 if(repository!==REPO || !Array.isArray(mergeShas) || mergeShas.length!==2 ||
   mergeShas.some(x=>!hash.test(x)) || !token || !Number.isFinite(now) ||
   !Number.isInteger(maxPages)||maxPages<1||maxPages>10)
   throw Error('ISSUE507_AUDIT_PARAMETERS_UNVERIFIED');
 let calls=0;
 async function get(path){
   if(!/^\/repos\/cyyoung111-dev\/portfolio\/(?:commits\/[a-f0-9]{40}|actions\/(?:workflows\/(?:gas-deploy|quality-check)\.yml\/runs\?[a-z0-9_&=]+|runs\/[0-9]+\/jobs\?[a-z0-9_&=]+))$/.test(path))
     throw Error('ISSUE507_AUDIT_UNSAFE_PATH');
   calls++;
   let response;
   try{response=await fetchImpl(API+path,{
      method:'GET',redirect:'error',
      headers:{accept:'application/vnd.github+json',
       authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28'},
      signal:AbortSignal.timeout(20000),
   });}catch{throw Error('ISSUE507_AUDIT_READ_UNVERIFIED');}
   if(!response?.ok)throw Error('ISSUE507_AUDIT_READ_UNVERIFIED');
   try{return await response.json();}catch{throw Error('ISSUE507_AUDIT_RESPONSE_UNVERIFIED');}
 }
 const anchors=[];
 for(const sha of mergeShas){
  const obj=await get('/repos/'+repository+'/commits/'+sha);
  const time=iso(obj?.commit?.committer?.date);
  if(obj?.sha!==sha||!Number.isFinite(time)||time>now)
    throw Error('ISSUE507_AUDIT_MERGE_TIMESTAMP_UNVERIFIED');
  anchors.push({sha,commitTime:new Date(time).toISOString()});
 }
 const start=Math.min(...anchors.map(x=>iso(x.commitTime)))-600000;
 if(now-start>14*86400000)throw Error('ISSUE507_AUDIT_WINDOW_TOO_OLD');
 async function listRuns(workflow){
  const out=[];let complete=false,seen=new Set();
  for(let page=1;page<=maxPages;page++){
   const result=await get('/repos/'+repository+'/actions/workflows/'+workflow+'.yml/runs?per_page=100&page='+page);
   if(!Array.isArray(result?.workflow_runs)||result.workflow_runs.length>100)
     throw Error('ISSUE507_AUDIT_RUN_LIST_UNVERIFIED');
   for(const item of result.workflow_runs){
    if(!Number.isSafeInteger(item?.id)||seen.has(item.id)||!Number.isFinite(iso(item.created_at)))
      throw Error('ISSUE507_AUDIT_RUN_METADATA_UNVERIFIED');
    seen.add(item.id);
    if(iso(item.created_at)>=start){
      out.push(item);
    }
   }
   if(result.workflow_runs.length<100 || result.workflow_runs.some(x=>iso(x.created_at)<start)){
     complete=true;break;
   }
  }
  return {runs:out,complete};
 }
 async function readJobs(id){
  const jobs=[];let complete=false;
  for(let page=1;page<=5;page++){
   const result=await get('/repos/'+repository+'/actions/runs/'+id+'/jobs?per_page=100&page='+page);
   if(!Array.isArray(result?.jobs)||result.jobs.length>100)
      throw Error('ISSUE507_AUDIT_JOBS_UNVERIFIED');
   jobs.push(...result.jobs);
   if(result.jobs.length<100){complete=true;break;}
  }
  return {jobs,complete};
 }
 const [quality,gas]=await Promise.all([listRuns('quality-check'),listRuns('gas-deploy')]);
 const qualityPush=anchors.map(a=>({
  sha:a.sha,
  runs:quality.runs.filter(x=>x.head_sha===a.sha&&x.event==='push')
    .map(x=>({id:x.id,status:x.status,conclusion:x.conclusion,createdAt:x.created_at}))
 }));
 const gasRuns=[];
 for(const run of gas.runs){
  const result=await readJobs(run.id);
  const deploy=result.jobs.filter(x=>x.name==='deploy');
  if(deploy.length>1)throw Error('ISSUE507_AUDIT_DEPLOY_JOB_DUPLICATED');
  const job=deploy[0];
  const deployStep=job?.steps?.find(x=>x.name==='Deploy GAS');
  let classification='NO_DEPLOY_JOB';
  if(!result.complete || !job)classification='UNVERIFIED';
  else if(job.conclusion==='skipped')classification='DEPLOY_SKIPPED';
  else if(job.conclusion==='success' && deployStep?.conclusion==='success')
    classification='DEPLOY_STEP_SUCCEEDED_MUTATION_UNVERIFIED';
  else classification='DEPLOY_ATTEMPT_UNVERIFIED';
  gasRuns.push({runId:run.id,headSha:run.head_sha,event:run.event,
    status:run.status,conclusion:run.conclusion,createdAt:run.created_at,
    deployJob:job?.conclusion??null,deployStep:deployStep?.conclusion??null,
    classification,jobHistoryComplete:result.complete});
 }
 const possible=gasRuns.filter(x=>x.classification!=='DEPLOY_SKIPPED');
 const provenanceComplete=quality.complete&&gas.complete&&
   gasRuns.every(x=>x.jobHistoryComplete&&x.status==='completed');
 let status='UNVERIFIED';
 if(provenanceComplete&&qualityPush.every(x=>x.runs.length>0)&&!possible.length)
   status='NO_GAS_DEPLOY_JOB_EXECUTED_IN_SCOPED_ACTIONS';
 else if(possible.some(x=>x.classification==='DEPLOY_STEP_SUCCEEDED_MUTATION_UNVERIFIED'))
   status='DEPLOY_STEP_SUCCESS_REQUIRES_SOURCE_READBACK';
 else if(possible.length)status='DEPLOY_ATTEMPT_OR_GAP_UNVERIFIED';
 const output={
  audit:'ISSUE507_POSTMERGE_GITHUB_ACTIONS',
  status,windowFrom:new Date(start).toISOString(),windowTo:new Date(now).toISOString(),
  mergeCommits:qualityPush,qualityListingComplete:quality.complete,
  gasListingComplete:gas.complete,gasRuns,
  provenanceComplete,
  githubApiReadCalls:calls,
  directGASorFinancialSourceRead:false,
  productionVersionVerified:false,
  financeMutationPerformed:false,
  deploymentTriggered:false,
 };
 return output;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const report=await auditIssue507PostmergeActions({
  repository:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN
 });
 console.log(JSON.stringify(report));
 // A report with unknown deployment state is useful evidence but must not
 // declare success. Failure makes the operator investigate the run.
 if(report.status!=='NO_GAS_DEPLOY_JOB_EXECUTED_IN_SCOPED_ACTIONS')
   process.exitCode=1;
}
