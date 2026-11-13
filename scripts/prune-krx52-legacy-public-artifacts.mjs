// One-off, fail-closed removal of historic publicly downloadable KRX raw-OHLC
// archives after encrypted-source runs #43435348491 and #43436095621
// were both verified. No financial or source files are deleted.
import {pathToFileURL} from 'node:url';

export const REPO='cyyoung111-dev/portfolio';
export const ARCHIVE='krx-52week-archive';
export const FIRST_SEALED_RUN=43435348491;
export const RETAIN=Object.freeze([43435348491,43436095621]);
export const MAX_DELETE=24;
const EXPECTED_PATH='.github/workflows/krx-52week-history.yml';

export function selectLegacyArtifacts(artifacts){
 if(!Array.isArray(artifacts))throw Error('KRX52_PRUNE_LIST_UNVERIFIED');
 const matched=artifacts.filter(a=>a.name===ARCHIVE&&!a.expired);
 for(const id of RETAIN){
  if(matched.filter(a=>a.workflow_run?.id===id).length!==1)
   throw Error('KRX52_PRUNE_ENCRYPTED_RECOVERY_ARTIFACT_MISSING');
 }
 const targets=matched.filter(a=>Number.isSafeInteger(a.workflow_run?.id)&&
  a.workflow_run.id<FIRST_SEALED_RUN);
 if(targets.length===0)return [];
 if(targets.length>MAX_DELETE||new Set(targets.map(x=>x.id)).size!==targets.length||
  targets.some(a=>!Number.isSafeInteger(a.id)||a.id<=0||
   typeof a.created_at!=='string'||a.created_at>='2026-11-13T13:38:02Z'))
  throw Error('KRX52_PRUNE_SCOPE_UNVERIFIED');
 if(matched.some(a=>!RETAIN.includes(a.workflow_run?.id)&&
  a.workflow_run?.id<FIRST_SEALED_RUN&&!targets.includes(a)))
  throw Error('KRX52_PRUNE_UNKNOWN_ARTIFACT_UNVERIFIED');
 return targets.sort((a,b)=>a.workflow_run.id-b.workflow_run.id);
}
const safeRun=run=>run&&run.name==='KRX 252-session 52-week market breadth archive (source only)'&&
 run.path===EXPECTED_PATH&&run.head_branch==='main'&&
 run.head_repository?.full_name===REPO&&run.conclusion==='success'&&
 run.id<FIRST_SEALED_RUN;

export async function pruneLegacy({token,fetchImpl=fetch,deleteEnabled=false}={}){
 if(!token||token.length<20)throw Error('KRX52_PRUNE_AUTH_UNVERIFIED');
 const api=async(path,method='GET')=>{
  const res=await fetchImpl('https://api.github.com/'+path,{
   method,headers:{Authorization:'Bearer '+token,
   Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',
   'User-Agent':'portfolio-krx52-legacy-artifact-prune'}});
  if(!res.ok)throw Error('KRX52_PRUNE_API_'+method+'_'+res.status);
  if(method==='DELETE')return null;
  return res.json();
 };
 const all=[];
 for(let page=1;page<=10;page++){
  const data=await api('repos/'+REPO+'/actions/artifacts?name='+ARCHIVE+
   '&per_page=100&page='+page);
  if(!Array.isArray(data?.artifacts))throw Error('KRX52_PRUNE_LIST_UNVERIFIED');
  all.push(...data.artifacts);
  if(data.artifacts.length<100)break;
  if(page===10)throw Error('KRX52_PRUNE_PAGINATION_UNVERIFIED');
 }
 const legacy=selectLegacyArtifacts(all);
 // Verify both *already proven* sealed runs still have successful Actions
 // executions, before touching any old artifact. Never prune the new sealed
 // recovery checkpoints; especially do not sort by artifact IDs.
 for(const id of RETAIN){
  const run=await api('repos/'+REPO+'/actions/runs/'+id);
  if(run.conclusion!=='success'||run.name!==
   'KRX 252-session 52-week market breadth archive (source only)'||
   run.path!==EXPECTED_PATH||run.head_branch!=='main')
   throw Error('KRX52_PRUNE_ENCRYPTED_PROOF_UNVERIFIED');
 }
 for(const a of legacy){
  const run=await api('repos/'+REPO+'/actions/runs/'+a.workflow_run.id);
  if(!safeRun(run))throw Error('KRX52_PRUNE_ORIGIN_UNVERIFIED');
 }
 if(deleteEnabled){
  for(const a of legacy)await api('repos/'+REPO+'/actions/artifacts/'+a.id,'DELETE');
 }
 return {kind:'KRX52_LEGACY_PUBLIC_ARTIFACT_PRUNE',
  dryRun:!deleteEnabled,verifiedSealedRuns:RETAIN.length,
  legacyCandidateCount:legacy.length,
  deletedCount:deleteEnabled?legacy.length:0,
  remainingUnexamined:all.filter(a=>a.name===ARCHIVE&&!a.expired&&
   a.workflow_run?.id>=FIRST_SEALED_RUN&&!RETAIN.includes(a.workflow_run?.id)).length,
  financialWrites:0,gasWrites:0,telegramSends:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(JSON.stringify(await pruneLegacy({
  token:process.env.GITHUB_TOKEN,deleteEnabled:process.argv.includes('--execute')})))}
 catch(e){console.error(/^KRX52_PRUNE_[A-Z_0-9]+$/.test(e?.message||'')?
  e.message:'KRX52_PRUNE_UNVERIFIED');process.exitCode=1}
}
