import {spawnSync} from 'node:child_process';
import {validateNhNight} from './nh-night-reference.mjs';

const repo='cyyoung111-dev/portfolio';
export async function loadCapturedNight(date,{token,repository,fetchImpl=fetch,now=()=>new Date(),decode=decodeZip}={}){
  if(repository!==repo||!token||!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
  const api=`https://api.github.com/repos/${repo}/actions`,headers={authorization:`Bearer ${token}`,accept:'application/vnd.github+json'};
  try{
    const name=`nh-night-reference-${date}`;
    const list=await fetchImpl(`${api}/artifacts?name=${encodeURIComponent(name)}&per_page=100`,{headers,signal:AbortSignal.timeout(15000)});
    if(!list.ok)return null;
    const d=await list.json();
    if(d.total_count!==1||!Array.isArray(d.artifacts)||d.artifacts.length!==1)return null;
    const a=d.artifacts[0];
    if(a.name!==name||a.expired!==false||!Number.isSafeInteger(a.id)||!Number.isSafeInteger(a.workflow_run?.id)||!Number.isFinite(a.size_in_bytes)||a.size_in_bytes>100000)return null;
    const response=await fetchImpl(`${api}/runs/${a.workflow_run.id}`,{headers,signal:AbortSignal.timeout(15000)});
    if(!response.ok)return null;
    const run=await response.json();
    const start=Date.parse(`${date}T06:45:00+09:00`), end=Date.parse(`${date}T07:35:00+09:00`), created=Date.parse(run.created_at);
    if(run.id!==a.workflow_run.id||run.name!=='NH night reference capture'||run.path!=='.github/workflows/nh-night-capture.yml'||run.event!=='schedule'||run.head_branch!=='main'||run.head_repository?.full_name!==repo||run.status!=='completed'||run.conclusion!=='success'||run.run_attempt!==1||!(created>=start&&created<end))return null;
    const download=await fetchImpl(`${api}/artifacts/${a.id}/zip`,{headers,redirect:'follow',signal:AbortSignal.timeout(15000)});
    if(!download.ok)return null;
    const buf=Buffer.from(await download.arrayBuffer());
    if(buf.length>100000)return null;
    const v=await decode(buf);
    if(v?.source!=='NH'||v.kind!=='REFERENCE'||v.tradingDate!==date||v.officialClose!==false||v.sourceUpdatedAt!==`${date}T06:00:00+09:00`)return null;
    const received=Date.parse(v.receivedAt);
    if(!(received>=start&&received<end&&received<=now().getTime()))return null;
    return validateNhNight({date,clock:'06:00:00',value:v.value,contract:v.contract,contractMonth:v.contractMonth},date,v.receivedAt);
  }catch{return null;}
}
function decodeZip(buf){
  const script="import io,sys,zipfile\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\na=z.infolist()\nassert len(a)==1 and a[0].filename=='reference.json' and a[0].file_size<=8192\nsys.stdout.buffer.write(z.read(a[0]))";
  const p=spawnSync('python3',['-c',script],{input:buf,timeout:5000,maxBuffer:10000,env:{PATH:process.env.PATH||'/usr/bin:/bin'}});
  if(p.status!==0)throw Error('INVALID_ARTIFACT');
  return JSON.parse(p.stdout.toString('utf8'));
}
