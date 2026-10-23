import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

const REPOSITORY='cyyoung111-dev/portfolio';
export function selectGasRelease({eventName,event,ref,repository,sha,enabled}){
  if(repository!==REPOSITORY||ref!=='refs/heads/main')throw Error('GAS_RELEASE_UNTRUSTED_REF');
  if(eventName==='workflow_dispatch'){
    if(!/^[a-f0-9]{40}$/.test(sha))throw Error('GAS_RELEASE_SHA_INVALID');
    return {sha,automatic:false};
  }
  const run=event?.workflow_run;
  if(eventName!=='workflow_run'||enabled!=='true'||run?.conclusion!=='success'
    ||run.event!=='push'||run.head_branch!=='main'
    ||run.head_repository?.full_name!==REPOSITORY||run.name!=='quality-check'
    ||run.path!=='.github/workflows/quality-check.yml'
    ||!/^[a-f0-9]{40}$/.test(run.head_sha||''))throw Error('GAS_RELEASE_NOT_ELIGIBLE');
  return {sha:run.head_sha,automatic:true};
}
export async function assertCurrentMainRelease({sha,repository=REPOSITORY,token,
  fetchImpl=fetch}){
  if(repository!==REPOSITORY||!/^[a-f0-9]{40}$/.test(sha||''))throw Error('GAS_RELEASE_SHA_INVALID');
  let response;
  try{response=await fetchImpl('https://api.github.com/repos/'+REPOSITORY+'/git/ref/heads/main',{
    headers:{accept:'application/vnd.github+json',...(token?{authorization:'Bearer '+token}:{})},
    redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error('GAS_RELEASE_MAIN_UNAVAILABLE');}
  if(!response.ok)throw Error('GAS_RELEASE_MAIN_UNAVAILABLE');
  let data;try{data=await response.json();}catch{throw Error('GAS_RELEASE_MAIN_UNAVAILABLE');}
  if(data?.object?.sha!==sha)throw Error('GAS_RELEASE_STALE_COMMIT');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const release=selectGasRelease({eventName:process.env.GITHUB_EVENT_NAME,
      event:JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')),
      ref:process.env.GITHUB_REF,repository:process.env.GITHUB_REPOSITORY,
      sha:process.env.GITHUB_SHA,enabled:process.env.GAS_AUTO_DEPLOY_ENABLED});
    await assertCurrentMainRelease({sha:release.sha,repository:process.env.GITHUB_REPOSITORY,
      token:process.env.GITHUB_TOKEN});
    fs.appendFileSync(process.env.GITHUB_OUTPUT,'sha='+release.sha+'\n');
  }catch(e){console.error(/^GAS_RELEASE_[A-Z_]+$/.test(e.message)?e.message:'GAS_RELEASE_GATE_FAILED');process.exitCode=1;}
}
