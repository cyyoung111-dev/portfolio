// Determine whether a trusted main GAS source still needs publication.
// "Unchanged since HEAD^" is NOT evidence: an earlier GAS deployment may have failed.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const SHA=/^[a-f0-9]{40}$/;
const PATH='src/gas/apps_script.gs';
const API='https://api.github.com';
async function readJson(url,token,fetchImpl){
 const response=await fetchImpl(url,{headers:{accept:'application/vnd.github+json',
   authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28'},
   signal:AbortSignal.timeout(15000)});
 if(!response?.ok)throw Error('PROVENANCE_API_UNVERIFIED');
 return response.json();
}
export async function checkGasAutoDeployEligibility({repository,token,currentRunId,fetchImpl=fetch,gitExec=execFileSync}={}){
 const unverified=reason=>({changed:true,reason});
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repository||''))
   ||typeof token!=='string'||!token.trim())return unverified('PROVENANCE_CONFIG_UNVERIFIED');
 if(!Number.isSafeInteger(Number(currentRunId))||Number(currentRunId)<=0)
  return unverified('PROVENANCE_CURRENT_RUN_UNVERIFIED');
 try{
  // Repo-wide last 100 runs are overwhelmed by unrelated workflows. Query
  // this exact GAS workflow with bounded pagination so a proven real deploy
  // is not lost behind hundreds of no-op or unrelated completed runs.
  const runs=[];
  for(let page=1;page<=5;page++){
   const pageResult=await readJson(API+'/repos/'+repository+
    '/actions/workflows/gas-deploy.yml/runs?per_page=100&page='+page,
    token,fetchImpl);
   if(!Array.isArray(pageResult?.workflow_runs)||pageResult.workflow_runs.length>100)
     return unverified('PROVENANCE_RUNS_UNVERIFIED');
   runs.push(...pageResult.workflow_runs);
   if(pageResult.workflow_runs.length<100)break;
  }
  // Sort explicitly: never trust API ordering when selecting deployed baseline.
  runs.sort((a,b)=>Number(b?.id||0)-Number(a?.id||0));
  for(const run of runs){
   if(run?.name!=='gas-deploy'||run.event!=='workflow_run'||run.conclusion!=='success'
      ||run.head_branch!=='main'||run.head_repository?.full_name!==repository
      ||!Number.isSafeInteger(run.id)||!SHA.test(String(run.head_sha||'')))continue;
   const jobs=await readJson(API+'/repos/'+repository+'/actions/runs/'+run.id+'/jobs?per_page=100',token,fetchImpl);
   if(!Array.isArray(jobs.jobs))return unverified('PROVENANCE_JOBS_UNVERIFIED');
   const deployed=jobs.jobs.some(job=>job?.name==='deploy'&&job.conclusion==='success'
      &&Array.isArray(job.steps)&&job.steps.some(step=>step.name==='Deploy GAS'&&step.conclusion==='success'));
   if(!deployed)continue; // Validation-only success or skipped production is not a release.
   // Dispatch inputs are not available on the run-list API. A newer manual
   // attempt may have deployed a different source or changed HEAD; do not
   // confuse its dry-run with a confirmed release. Force the normal path.
   if(runs.some(other=>other?.name==='gas-deploy'
      &&Number.isSafeInteger(other.id)&&Number(other.id)!==Number(currentRunId)
      &&Number(other.id)>Number(run.id)
      &&(other.event==='workflow_dispatch'
        ||(other.event==='workflow_run'&&other.conclusion!=='success'))))
      return unverified('PROVENANCE_NEWER_DEPLOY_NOT_PROVEN');
   const sha=String(run.head_sha);
   // The run is now fully proven; any Git/GitHub read failure MUST permit deployment.
   gitExec('git',['fetch','--no-tags','--depth=1','origin',sha],{stdio:'ignore',timeout:20000});
   const oldBlob=String(gitExec('git',['rev-parse',sha+':'+PATH],{encoding:'utf8',timeout:10000})).trim();
   const headBlob=String(gitExec('git',['rev-parse','HEAD:'+PATH],{encoding:'utf8',timeout:10000})).trim();
   if(!SHA.test(oldBlob)||!SHA.test(headBlob))return unverified('PROVENANCE_BLOB_UNVERIFIED');
   return {changed:oldBlob!==headBlob,reason:oldBlob===headBlob?'DEPLOYED_SOURCE_MATCH':'DEPLOYED_SOURCE_DIFFERS'};
  }
  return unverified('PROVENANCE_NO_PROVEN_DEPLOYMENT');
 }catch(_){
  return unverified('PROVENANCE_CHECK_UNVERIFIED');
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const result=await checkGasAutoDeployEligibility({
  repository:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN,
  currentRunId:process.env.GITHUB_RUN_ID});
 if(process.env.GITHUB_OUTPUT)
  fs.appendFileSync(process.env.GITHUB_OUTPUT,'changed='+String(result.changed)+'\n');
 console.log(JSON.stringify(result)); // Only 2 fixed fields; no URLs, tokens, file source or SHA.
}
