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
assert.equal((await load(mock(list,run,payload),{decode:async()=>decodeFinancialEvidenceZip(
 zip({'financial-evidence.json':JSON.stringify(payload)})}))).kind,
 'AI_FINANCIAL_EVIDENCE_READ_ONLY');
for(const members of [
 {'../financial-evidence.json':JSON.stringify(payload)},
 {'wrong.json':JSON.stringify(payload)},
 {'financial-evidence.json':JSON.stringify(payload),'extra.json':'{}'},
 {'financial-evidence.json':'x'.repeat(46000)}]){
 assert.throws(()=>decodeFinancialEvidenceZip(zip(members)),'unsafe ZIP entry rejected');
}
assert.throws(()=>decodeFinancialEvidenceZip(Buffer.from('not-a-zip')));
console.log('AI_FINANCIAL_EVIDENCE_LOADER_PASS provenance/duplicate/date/source/zip/FCF/failclosed');
