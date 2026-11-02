import {spawnSync} from 'node:child_process';
import {sanitizePreclose} from './telegram-close-precompute.mjs';

const REPO='cyyoung111-dev/portfolio',PARTS=['nh','domestic','secondary','stocks','macros','markets'];
const DATE=/^\d{4}-\d{2}-\d{2}$/;
function decodeZip(buf){
 const script="import io,sys,zipfile\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\na=z.infolist()\nassert len(a)==1 and a[0].filename=='prepared.json' and not a[0].is_dir() and a[0].file_size<=45000\nsys.stdout.buffer.write(z.read(a[0]))";
 const p=spawnSync('python3',['-c',script],{input:buf,timeout:5000,
  maxBuffer:50000,env:{PATH:process.env.PATH||'/usr/bin:/bin'}});
 if(p.status!==0)throw Error('PRECLOSE_ZIP_INVALID');
 return JSON.parse(p.stdout.toString('utf8'));
}
export function verifyPreparedClose(date,payload,now=new Date()){
 if(!DATE.test(String(date||''))||payload?.schemaVersion!==1||payload.date!==date
  ||!PARTS.every(key=>Array.isArray(payload[key]))
  ||!Number.isFinite(now.getTime()))return null;
 const created=Date.parse(payload.capturedAt);
 const lower=Date.parse(date+'T16:45:00+09:00');
 const upper=Date.parse(date+'T17:00:00+09:00');
 if(!(created>=lower&&created<upper&&created<=now.getTime()))return null;
 const rows=sanitizePreclose(date,payload);
 if(!rows||!PARTS.every(key=>rows[key].length===payload[key].length))return null;
 return rows;
}
// Untrusted GitHub Artifact must match a completed first-attempt main/schedule
// workflow and an exact in-window capture timestamp. Invalid => live fallback.
export async function loadPreparedClose(date,{token,repository,fetchImpl=fetch,
 now=()=>new Date(),decode=decodeZip}={}){
 if(repository!==REPO||!token||!DATE.test(String(date||'')))return null;
 const api='https://api.github.com/repos/'+REPO+'/actions';
 const headers={authorization:'Bearer '+token,accept:'application/vnd.github+json'};
 try{
  const name='telegram-close-prepared-'+date;
  const list=await fetchImpl(api+'/artifacts?name='+encodeURIComponent(name)+'&per_page=100',
   {headers,signal:AbortSignal.timeout(7000),redirect:'error'});
  if(!list.ok)return null;
  const d=await list.json();
  if(d?.total_count!==1||!Array.isArray(d.artifacts)||d.artifacts.length!==1)return null;
  const a=d.artifacts[0];
  if(a.name!==name||a.expired!==false||!Number.isSafeInteger(a.id)
   ||!Number.isSafeInteger(a.workflow_run?.id)||!Number.isSafeInteger(a.size_in_bytes)
   ||a.size_in_bytes<=0||a.size_in_bytes>85000)return null;
  const response=await fetchImpl(api+'/runs/'+a.workflow_run.id,
   {headers,signal:AbortSignal.timeout(7000),redirect:'error'});
  if(!response.ok)return null;
  const run=await response.json();
  const started=Date.parse(run.created_at),
   lower=Date.parse(date+'T16:45:00+09:00'),
   upper=Date.parse(date+'T17:00:00+09:00');
  if(run.id!==a.workflow_run.id||run.name!=='Telegram closing data precompute'
   ||run.path!=='.github/workflows/telegram-close-precompute.yml'
   ||run.event!=='schedule'||run.head_branch!=='main'
   ||run.head_repository?.full_name!==REPO
   ||run.status!=='completed'||run.conclusion!=='success'
   ||run.run_attempt!==1||!(started>=lower&&started<upper))return null;
  const download=await fetchImpl(api+'/artifacts/'+a.id+'/zip',
   {headers,signal:AbortSignal.timeout(7000),redirect:'follow'});
  if(!download.ok)return null;
  const buf=Buffer.from(await download.arrayBuffer());
  if(buf.length>85000)return null;
  return verifyPreparedClose(date,await decode(buf),now());
 }catch{return null;}
}
