import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {buildAiFinancialEvidence} from './briefing-financial-evidence.mjs';
import {loadAiFinancialEvidenceArtifact,decodeFinancialEvidenceZip}
 from './load-ai-financial-evidence-artifact.mjs';

const repo='cyyoung111-dev/portfolio',day='2026-11-09',us='2026-11-06';
const sha='a'.repeat(40);
const morning=new Date('2026-11-08T22:42:00Z');
const close=new Date('2026-11-09T08:02:00Z');
const good=buildAiFinancialEvidence({asOfKst:day,usSessionDate:us,
 ttm:{statuses:[{symbol:'MSFT',status:'VERIFIED_TTM'}],
 reports:[{symbol:'MSFT',periodEnd:'2026-09-30',quarterFiledAt:'2026-10-24',
 quarterAccession:'mock-q',annualAccession:'mock-k',
 method:'FY_PLUS_CURRENT_YTD_MINUS_PRIOR_YTD',
 fields:{operatingCashFlow:1000,capex:300},calculated:{freeCashFlow:700}}]},
 fyValues:{statuses:[{symbol:'MSFT',status:'VERIFIED_FY_BPS_PBR'}],
 snapshots:[{symbol:'MSFT',source:'SEC_10K_US_GAAP',asOf:'2026-06-30',
 reportedAt:'2026-07-31',priceDate:us,priceSource:'YAHOO_DAILY_REFERENCE',
 bpsUsd:50,splitAdjustedBpsUsd:50,splitSharesPerOldShare:1,
 priceUsd:500,pbrTimes:10}]},dart:{}});
assert.equal(good.coverage.ttm,1);
const payload={schemaVersion:1,date:day,capturedAt:'2026-11-08T21:23:00Z',
 source:'SEC_DART_PUBLIC_READ_ONLY',repository:repo,evidence:good};
const list={total_count:1,artifacts:[{id:71,name:'ai-financial-evidence-'+day,
 expired:false,size_in_bytes:1000,
 workflow_run:{id:81,head_branch:'main',head_sha:sha}}]};
const run={id:81,name:'AI financial evidence prefetch (read-only)',
 path:'.github/workflows/ai-financial-evidence-prefetch.yml',
 event:'schedule',head_branch:'main',head_sha:sha,
 head_repository:{full_name:repo},repository:{full_name:repo},
 status:'completed',conclusion:'success',run_attempt:1,
 created_at:'2026-11-08T21:20:00Z',
 run_started_at:'2026-11-08T21:21:00Z',
 updated_at:'2026-11-08T21:28:00Z'};
const clone=x=>structuredClone(x);
const okJson=x=>({ok:true,json:async()=>x});
const okZip=b=>({ok:true,arrayBuffer:async()=>b});
const mock=(l=clone(list),r=clone(run),body=payload)=>async (url,opts)=>{
 assert.equal(opts.headers.authorization,'Bearer mock-gh-token');
 assert.ok(opts.signal);
 if(url.includes('/actions/artifacts?'))return okJson(l);
 if(url.endsWith('/actions/runs/81'))return okJson(r);
 if(url.endsWith('/actions/artifacts/71/zip'))return okZip(Buffer.from('fake zip'));
 throw Error('Unapproved endpoint');
};
const load=(fetchImpl=mock(),options={})=>loadAiFinancialEvidenceArtifact(day,{
 token:'mock-gh-token',repository:repo,now:()=>morning,
 fetchImpl,decode:async()=>payload,...options});
assert.deepEqual(await load(),good,'one successful main schedule with exact source should load');
assert.deepEqual(await load(mock(),{now:()=>close}),good,'17:00 may reuse same session artifact');
assert.equal(await load(mock(),{repository:'attacker/repo'}),null);
assert.equal(await load(mock(),{token:''}),null);
assert.equal(await load(mock(),{now:()=>new Date('2026-11-08T21:20:00Z')}),null);
assert.equal(await load(mock(),{now:()=>new Date('2026-11-09T09:01:00Z')}),null);
assert.equal(await load(mock(),{decode:async()=>({...payload,date:'2026-11-06'})}),null);
assert.equal(await load(mock(),{decode:async()=>({...payload,evidence:{
 ...good,items:good.items.map((x,i)=>i===0?{...x,ttm:{...x.ttm,fcfUsd:999}}:x)
}})}),null,'altered FCF must reject');
assert.equal(await load(mock(),{decode:async()=>{throw Error('bad zip');}}),null);
assert.equal(await load(async()=>{throw Error('offline');}),null);
assert.equal(await load(async()=>({ok:false})),null);
assert.equal(await load(mock({...list,total_count:2})),null);
assert.equal(await load(mock({...list,artifacts:[...list.artifacts,list.artifacts[0]]})),null);
assert.equal(await load(mock({...list,artifacts:[{...list.artifacts[0],expired:true}]})),null);
assert.equal(await load(mock({...list,artifacts:[{...list.artifacts[0],size_in_bytes:100001}]})),null);
assert.equal(await load(mock({...list,artifacts:[{...list.artifacts[0],
 workflow_run:{...list.artifacts[0].workflow_run,head_sha:'b'.repeat(40)}}]})),null);
for(const changed of [
 {event:'workflow_dispatch'},{head_branch:'feature'},{run_attempt:2},
 {conclusion:'failure'},{status:'in_progress'},{name:'unrelated workflow'},
 {path:'.github/workflows/unrelated.yml'},
 {head_repository:{full_name:'other/repo'}},
 {repository:{full_name:'other/repo'}},{head_sha:'b'.repeat(40)},
 {created_at:'2026-11-08T20:00:00Z'},
 {run_started_at:'2026-11-08T23:00:00Z'},
 {updated_at:'2026-11-09T23:00:00Z'}]){
 assert.equal(await load(mock(list,{...run,...changed})),null,
  'untrusted run: '+Object.keys(changed)[0]);
}
assert.equal(await loadAiFinancialEvidenceArtifact('2026-11-08',{
 token:'mock-gh-token',repository:repo,now:()=>morning,fetchImpl:mock(),
 decode:async()=>payload}),null,'weekends cannot load');
assert.equal(await loadAiFinancialEvidenceArtifact('2026-11-00',{
 token:'mock-gh-token',repository:repo,now:()=>morning,fetchImpl:mock()}),null);
// Exercise the production ZIP parser and prevent archive entry substitution.
function zip(members){
 const py=`import io,sys,zipfile,json
out=io.BytesIO()
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
 for key,value in json.loads(sys.argv[1]).items(): z.writestr(key,value)
sys.stdout.buffer.write(out.getvalue())`;
 const p=spawnSync('python3',['-I','-c',py,JSON.stringify(members)],{
  encoding:null,timeout:5000,maxBuffer:150000});
 assert.equal(p.status,0,String(p.stderr));
 return p.stdout;
}
assert.deepEqual(decodeFinancialEvidenceZip(zip({'financial-evidence.json':JSON.stringify(payload)})),
 payload,'real ZIP must decode');
const loadedZip=await load(mock(),{decode:async()=>decodeFinancialEvidenceZip(
 zip({'financial-evidence.json':JSON.stringify(payload)}))});
assert.equal(loadedZip?.kind,'AI_FINANCIAL_EVIDENCE_READ_ONLY');
for(const members of [
 {'../financial-evidence.json':JSON.stringify(payload)},
 {'wrong.json':JSON.stringify(payload)},
 {'financial-evidence.json':JSON.stringify(payload),'extra.json':'{}'},
 {'financial-evidence.json':'x'.repeat(46000)}]){
 assert.throws(()=>decodeFinancialEvidenceZip(zip(members)),'unsafe ZIP entry rejected');
}
assert.throws(()=>decodeFinancialEvidenceZip(Buffer.from('not-a-zip')));
// An independently verified 07:21 sentinel may recover a delayed GitHub
// 06:20 schedule without impersonating its archival evidence.
const sentinelPayload={...payload,captureMode:'SENTINEL_PUSH',
 capturedAt:'2026-11-08T22:29:00Z'};
const sentinelList={total_count:1,artifacts:[{
 id:72,name:'ai-financial-evidence-sentinel-'+day,expired:false,
 size_in_bytes:1000,workflow_run:{id:82,head_branch:'main',head_sha:sha}
}]};
const sentinelRun={...run,id:82,event:'push',
 created_at:'2026-11-08T22:21:00Z',
 run_started_at:'2026-11-08T22:22:00Z',
 updated_at:'2026-11-08T22:30:00Z'};
const sentinelFetch=(theRun=sentinelRun,theList=sentinelList)=>async (url,opts)=>{
 assert.equal(opts.headers.authorization,'Bearer mock-gh-token');
 if(url.includes('/actions/artifacts?name=ai-financial-evidence-sentinel-'))
  return okJson(theList);
 if(url.includes('/actions/artifacts?'))
  return okJson({total_count:0,artifacts:[]});
 if(url.endsWith('/actions/runs/82'))return okJson(theRun);
 if(url.endsWith('/actions/artifacts/72/zip'))return okZip(Buffer.from('fake zip'));
 throw Error('Unapproved sentinel endpoint');
};
const fallbackLoad=(fetchImpl=sentinelFetch(),p=sentinelPayload)=>load(fetchImpl,{
 decode:async()=>p});
assert.deepEqual(await fallbackLoad(),good,
 'independent main sentinel artifact must load if schedule did not run');
assert.equal(await fallbackLoad(sentinelFetch({...sentinelRun,event:'schedule'})),null,
 'sentinel artifact cannot claim scheduled provenance');
assert.equal(await fallbackLoad(sentinelFetch({...sentinelRun,
 created_at:'2026-11-08T22:40:00Z'})),null,
 'late GitHub queued sentinel is rejected');
assert.equal(await fallbackLoad(sentinelFetch(sentinelRun,
 {...sentinelList,total_count:2})),null,'duplicate sentinel artifacts rejected');
assert.equal(await fallbackLoad(sentinelFetch(),{...sentinelPayload,
 captureMode:undefined}),null,'scheduled payload cannot masquerade as sentinel');
assert.equal(await fallbackLoad(sentinelFetch(),{...sentinelPayload,
 capturedAt:'2026-11-08T22:39:00Z'}),null,'late capture rejected');

// Observed late schedule 09:59 KST on 11/09: it is not valid for the
// 07:40 morning briefing, but should not waste verified public evidence
// when a 17:00 close still has time to use a close-only artifact.
const latePayload={...payload,captureMode:'LATE_SCHEDULE_CLOSE_ONLY',
 capturedAt:'2026-11-09T01:03:00Z'};
const lateList={total_count:1,artifacts:[{
 id:73,name:'ai-financial-evidence-close-'+day,expired:false,
 size_in_bytes:1000,workflow_run:{id:83,head_branch:'main',head_sha:sha}
}]};
const lateRun={...run,id:83,event:'schedule',
 created_at:'2026-11-09T00:59:49Z',
 run_started_at:'2026-11-09T01:00:00Z',
 updated_at:'2026-11-09T01:04:00Z'};
const lateCalls=[];
const lateFetch=(theRun=lateRun,theList=lateList)=>async (url,opts)=>{
 assert.equal(opts.headers.authorization,'Bearer mock-gh-token');
 lateCalls.push(url);
 if(url.includes('/artifacts?name=ai-financial-evidence-close-'))
  return okJson(theList);
 if(url.includes('/artifacts?'))return okJson({total_count:0,artifacts:[]});
 if(url.endsWith('/actions/runs/83'))return okJson(theRun);
 if(url.endsWith('/actions/artifacts/73/zip'))return okZip(Buffer.from('fake zip'));
 throw Error('Unexpected close-only read');
};
assert.deepEqual(await load(lateFetch(),{
 now:()=>close,decode:async()=>latePayload
}),good,'17:02 may use a 09:59 delayed schedule with exact-day provenance');
lateCalls.length=0;
assert.equal(await load(lateFetch(),{
 now:()=>morning,decode:async()=>latePayload
}),null,'morning must never accept late SEC/DART data');
assert(!lateCalls.some(url=>url.includes('ai-financial-evidence-close-')),
 '07:40 loader must not even query the close-only artifact');
assert.equal(await load(lateFetch({...lateRun,event:'push'}),{
 now:()=>close,decode:async()=>latePayload
}),null,'push cannot impersonate a delayed scheduled close capture');
assert.equal(await load(lateFetch({...lateRun,
 created_at:'2026-11-08T22:20:00Z'}),{
 now:()=>close,decode:async()=>latePayload
}),null,'07:20 scheduled artifact cannot masquerade as late close');
assert.equal(await load(lateFetch(lateRun,{...lateList,total_count:2}),{
 now:()=>close,decode:async()=>latePayload
}),null,'ambiguous close-only artifacts are rejected');
for(const bad of [
 {...latePayload,captureMode:undefined},
 {...latePayload,captureMode:'SENTINEL_PUSH'},
 {...latePayload,capturedAt:'2026-11-08T21:20:00Z'},
 {...latePayload,capturedAt:'2026-11-09T07:45:00Z'},
 {...latePayload,date:'2026-11-06'}
]){
 assert.equal(await load(lateFetch(),{
  now:()=>close,decode:async()=>bad
 }),null,'a close-only artifact must have exact source, date and capture mode');
}
console.log('AI_FINANCIAL_EVIDENCE_LOADER_PASS scheduled/sentinel/close-only/provenance/duplicate/date/source/zip/FCF/failclosed');
