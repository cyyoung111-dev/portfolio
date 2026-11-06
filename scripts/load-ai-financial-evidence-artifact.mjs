// Read-only GitHub artifact loader for the 06:20 SEC/DART public issuer snapshot.
// No live SEC/DART requests, portfolio access, GAS writes, or Telegram sends.
// A missing, ambiguous, stale or untrusted archive is simply unavailable.
import {spawnSync} from 'node:child_process';
import {krxSessionStatus} from './krx-session-calendar.mjs';
import {verifyFinancialPrefetchArtifact,FINANCIAL_PREFETCH_REPO,
 FINANCIAL_PREFETCH_WORKFLOW,FINANCIAL_PREFETCH_PATH,
 FINANCIAL_PREFETCH_FILE} from './prefetch-ai-financial-evidence-readonly.mjs';

const API='https://api.github.com/repos/'+FINANCIAL_PREFETCH_REPO+'/actions';
const MAX_ZIP=100000,MAX_JSON=45000;
const TIMEOUT_MS=2200;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const sha=x=>typeof x==='string'&&/^[0-9a-f]{40}$/.test(x);
const inWindow=(value,date)=> {
 const ms=Date.parse(value);
 return Number.isFinite(ms)
  &&ms>=Date.parse(date+'T06:15:00+09:00')
  &&ms<Date.parse(date+'T07:25:00+09:00');
};

// Check the zip entry independently of JSON validation; zip-slip, symlinks,
// multi-file archives, oversized JSON and corrupted CRCs never reach the formatter.
export function decodeFinancialEvidenceZip(buf){
 if(!Buffer.isBuffer(buf)||buf.length===0||buf.length>MAX_ZIP)
  throw Error('FINANCIAL_ARTIFACT_ZIP_INVALID');
 const script=`import io,json,sys,zipfile,stat
b=sys.stdin.buffer.read()
with zipfile.ZipFile(io.BytesIO(b)) as z:
 i=z.infolist()
 assert len(i)==1 and i[0].filename=='financial-evidence.json'
 assert i[0].file_size<=45000 and i[0].file_size>0
 assert not i[0].is_dir() and not stat.S_ISLNK(i[0].external_attr>>16)
 assert z.testzip() is None
 v=z.read(i[0])
 assert len(v)<=45000
 sys.stdout.buffer.write(v)`;
 const p=spawnSync('python3',['-I','-c',script],{input:buf,
  timeout:5000,maxBuffer:MAX_JSON+1024,
  env:{PATH:process.env.PATH||'/usr/bin:/bin'}});
 if(p.error||p.status!==0||!p.stdout||p.stdout.length>MAX_JSON)
  throw Error('FINANCIAL_ARTIFACT_ZIP_INVALID');
 return JSON.parse(p.stdout.toString('utf8'));
}

async function githubGet(url,{token,fetchImpl,decode='json'}){
 const response=await fetchImpl(url,{
  headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json'},
  redirect:decode==='zip'?'follow':'error',signal:AbortSignal.timeout(TIMEOUT_MS)});
 if(!response?.ok)return null;
 if(decode==='json')return response.json();
 const bytes=Buffer.from(await response.arrayBuffer());
 return bytes.length>0&&bytes.length<=MAX_ZIP?bytes:null;
}

export async function loadAiFinancialEvidenceArtifact(date,{
 token,repository,now=()=>new Date(),fetchImpl=fetch,
 decode=decodeFinancialEvidenceZip
}={}){
 if(repository!==FINANCIAL_PREFETCH_REPO||typeof token!=='string'||!token
  ||typeof fetchImpl!=='function'||typeof decode!=='function'
  ||!DAY.test(date)||Number.isNaN(Date.parse(date+'T00:00:00Z'))
  ||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date
  ||krxSessionStatus(date)!=='OPEN')return null;
 try{
  const at=now();
  if(!(at instanceof Date)||!Number.isFinite(at.getTime())
   ||at.getTime()<Date.parse(date+'T07:25:00+09:00')
   ||at.getTime()>=Date.parse(date+'T18:01:00+09:00'))return null;
  const artifactName='ai-financial-evidence-'+date;
  const list=await githubGet(API+'/artifacts?name='+encodeURIComponent(artifactName)+'&per_page=100',
   {token,fetchImpl});
  if(list?.total_count!==1||!Array.isArray(list.artifacts)
   ||list.artifacts.length!==1)return null;
  const artifact=list.artifacts[0],runId=artifact?.workflow_run?.id;
  if(artifact?.name!==artifactName||artifact.expired!==false
   ||!Number.isSafeInteger(artifact.id)||artifact.id<=0
   ||!Number.isSafeInteger(runId)||runId<=0
   ||!Number.isInteger(artifact.size_in_bytes)
   ||artifact.size_in_bytes<=0||artifact.size_in_bytes>MAX_ZIP
   ||artifact.workflow_run.head_branch!=='main'
   ||!sha(artifact.workflow_run.head_sha))return null;
  const run=await githubGet(API+'/runs/'+runId,{token,fetchImpl});
  if(!run||run.id!==runId||run.name!==FINANCIAL_PREFETCH_WORKFLOW
   ||run.path!==FINANCIAL_PREFETCH_PATH||run.event!=='schedule'
   ||run.head_branch!=='main'
   ||run.head_repository?.full_name!==FINANCIAL_PREFETCH_REPO
   ||run.repository?.full_name!==FINANCIAL_PREFETCH_REPO
   ||run.status!=='completed'||run.conclusion!=='success'
   ||run.run_attempt!==1||run.head_sha!==artifact.workflow_run.head_sha
   ||!inWindow(run.created_at,date)||!inWindow(run.run_started_at||run.created_at,date)
   ||!Number.isFinite(Date.parse(run.updated_at))
   ||Date.parse(run.updated_at)>now().getTime())return null;
  const archive=await githubGet(API+'/artifacts/'+artifact.id+'/zip',
   {token,fetchImpl,decode:'zip'});
  if(!archive)return null;
  const payload=await decode(archive);
  if(!payload||typeof payload!=='object'||Array.isArray(payload)
   ||JSON.stringify(payload).length>MAX_JSON)return null;
  // The verifier rejects stale/cross-session, invented financial fields,
  // domestic PBR without same-session NH prices and altered FCF arithmetic.
  return verifyFinancialPrefetchArtifact(date,payload,{now:now()});
 }catch{
  return null; // Never fail a punctual market briefing over optional evidence.
 }
}
