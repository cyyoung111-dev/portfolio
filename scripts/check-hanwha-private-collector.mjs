import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {run} from './collect-hanwha-fund-nav.mjs';

const now=new Date('2026-11-06T00:15:00Z');
function fixture({busy=false,invalidAuth=false,conflict=false}={}){
 let total=0,mutations=0;
 const fetchImpl=async (_url,opts)=>{
   total++;
   if(!opts.body)return {ok:true,json:async()=>({list:[
     {wkdate:'20261103',price:'1975.18'},
     {wkdate:'20261104',price:'1944.84'},
     {wkdate:'20261105',price:'1951.24'},
     {wkdate:'20261106',price:'1999.00'}]})};
   const p=Object.fromEntries(opts.body);
   assert.ok(['getAutomationStatus','previewFundNavImport','getFundValuationStatus'].includes(p.action),
     'no mutation endpoint may be called');
   if(p.accessToken==='HANWHA_AUTH_PROBE')
     return {ok:true,json:async()=>invalidAuth?
       ({status:'ok'}):({status:'error',message:'인증 실패'})};
   if(p.action==='getAutomationStatus')return {ok:true,json:async()=>({
     status:'ok',gasVersion:'9.282',automation:{
       closeRun:{state:busy?'RUNNING':'ERROR',runDate:'2026-11-05'},
       tradeSnapshotWorkerLastResult:{status:'IDLE'},tradeSnapshotDeferredCount:0}})};
   if(p.action==='previewFundNavImport'){
     const input=JSON.parse(p.data);
     assert.equal(input.code,'F00001');
     assert.equal(input.provider,'HANWHA_2045_CRPE');
     assert.equal(input.classCode,'C-RPe');
     assert.equal(input.appendOnly,true);
     assert.ok(input.rows.every(r=>r.date<'2026-11-06'));
     return {ok:true,json:async()=>({
       status:'ok',code:'F00001',candidates:input.rows,
       updates:conflict?[{date:'2026-11-05'}]:[],
       errors:[],warnings:[],identical:[],duplicates:[],zeroUnits:[]})};
   }
   if(p.action==='getFundValuationStatus'){
     assert.equal(p.code,'F00001');
     assert.equal(p.to,'2026-11-05');
     return {ok:true,json:async()=>({status:'ok',fundResults:{F00001:{dates:[
       {code:'F00001',date:'2026-11-05',navState:'NAV_MISSING',
        unitsApplied:true,reconciled:true,valuationRequired:true,
        evaluationState:'WRITE_REQUIRED',snapshotState:'NOT_CREATED'}]}}})};
   }
   mutations++;throw Error('unexpected');
 };
 return {fetchImpl,get calls(){return total},get mutations(){return mutations}};
}
const args=f=>({url:'https://script.google.com/macros/s/TEST/exec',
 token:'TEST_VALUE',now,fetchImpl:f.fetchImpl});
{
 const f=fixture(),r=await run({...args(f),apply:false});
 assert.equal(r.mode,'DRY_RUN');
 assert.equal(r.candidates,3);
 assert.equal(r.writerInvoked,false);
 assert.deepEqual(r.missingNavDates,['2026-11-05']);
 assert.deepEqual(r.pendingDates,['2026-11-05']);
 assert.equal(f.mutations,0);
}
{
 const f=fixture();
 await assert.rejects(()=>run({...args(f),apply:true}),/HANWHA_LEASED_WRITER_UNAVAILABLE/);
 assert.equal(f.calls,0,'apply is blocked BEFORE token, source or GAS access');
}
for(const x of [{busy:true},{invalidAuth:true},{conflict:true}]){
 const f=fixture(x);
 await assert.rejects(()=>run({...args(f),apply:false}),/HANWHA_/);
 assert.equal(f.mutations,0);
}
const workflow=YAML.parse(fs.readFileSync('.github/workflows/kb-fund-nav-collect.yml','utf8'));
const job=workflow.jobs['hanwha-collect'];
assert.ok(job);assert.deepEqual(job.needs,['collect']);
assert.equal(job.environment,'portfolio-production-gas');
assert.match(job.if,/always\(\)/);
assert.ok(job.steps.some(s=>s.run==='node scripts/collect-hanwha-fund-nav.mjs'));
assert.doesNotMatch(JSON.stringify(job),/--apply|importFundNav|TELEGRAM_/);
assert.doesNotMatch(fs.readFileSync('scripts/collect-hanwha-fund-nav.mjs','utf8'),
 /request\('importFundNav'|request\('collectKbFundNav'/);
console.log('Hanwha NAV readonly preview and explicit apply refusal PASS');
