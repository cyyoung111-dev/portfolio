import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {run} from './collect-hanwha-fund-nav.mjs';

const now=new Date('2026-11-06T00:15:00Z');
function fixture({lostAck=false,stale=false,blocked=false,missingCommit=false}={}){
 const stored=new Map();
 let imports=0;
 const fetchImpl=async (_url,opts)=>{
  if(!opts.body)return {ok:true,json:async()=>({list:[
   {wkdate:'20261103',price:'1975.18'},
   {wkdate:'20261104',price:'1944.84'},
   {wkdate:'20261105',price:'1951.24'},
   {wkdate:'20261106',price:'1999.00'}]})};
  const p=Object.fromEntries(opts.body);
  if(p.accessToken==='HANWHA_AUTH_PROBE')
    return {ok:true,json:async()=>({status:'error',message:'인증 실패'})};
  if(p.action==='getAutomationStatus')return {ok:true,json:async()=>({
   status:'ok',gasVersion:'9.282',automation:{
    closeRun:{state:blocked?'RUNNING':'ERROR',runDate:'2026-11-05'},
    tradeSnapshotWorkerLastResult:{status:'IDLE'},tradeSnapshotDeferredCount:0}})};
  if(p.action==='previewFundNavImport'){
   const data=JSON.parse(p.data);
   assert.equal(data.code,'F00001');
   assert.equal(data.appendOnly,true);
   assert.ok(data.rows.every(r=>r.date<'2026-11-06'));
   return {ok:true,json:async()=>({status:'ok',code:'F00001',
    candidates:data.rows.filter(r=>!stored.has(r.date)),
    identical:data.rows.filter(r=>stored.has(r.date)).map(r=>({
      date:r.date,uploadedNav:r.nav,existingNav:stored.get(r.date)})),
    updates:stale?[{date:'2026-11-05'}]:[],errors:[],warnings:[],duplicates:[],zeroUnits:[]})};
  }
  if(p.action==='importFundNav'){
   imports++;
   assert.equal(imports,1);
   for(const row of JSON.parse(p.data).rows)
     if(!missingCommit)stored.set(row.date,row.nav);
   if(lostAck)throw Object.assign(new Error('socket'),{name:'TimeoutError'});
   return {ok:true,json:async()=>({status:'ok',saveState:'success',
     evaluation:{missingHoldings:[]}})};
  }
  if(p.action==='getFundValuationStatus')return {ok:true,json:async()=>({
   status:'ok',fundResults:{F00001:{dates:[{code:'F00001',date:'2026-11-05',
    navState:'EXISTING_CONFIRMED',unitsApplied:true,reconciled:true,
    valuationRequired:true,evaluationState:'EXISTING_VALID',
    snapshotState:'EXISTING_VALID'}]}}})};
  throw Error('unexpected action');
 };
 return {fetchImpl,get imports(){return imports}};
}
const args=f=>({url:'https://script.google.com/macros/s/TEST/exec',
 token:'TEST_VALUE',now,fetchImpl:f.fetchImpl});
{
 const f=fixture(),r=await run({...args(f),apply:false});
 assert.equal(r.mode,'DRY_RUN');assert.equal(r.imported,0);
 assert.equal(f.imports,0);
}
{
 const f=fixture(),r=await run({...args(f),apply:true});
 assert.equal(r.mode,'APPLY');assert.equal(r.imported,3);
 assert.equal(f.imports,1);
}
{
 const f=fixture({lostAck:true}),r=await run({...args(f),apply:true});
 assert.equal(r.importAckRecovered,true);assert.equal(f.imports,1);
}
for(const opt of [{stale:true},{blocked:true},{lostAck:true,missingCommit:true}]){
 const f=fixture(opt);
 await assert.rejects(()=>run({...args(f),apply:true}),/HANWHA_/);
 assert.ok(f.imports<=1);
}
const wf=YAML.parse(fs.readFileSync('.github/workflows/kb-fund-nav-collect.yml','utf8'));
const job=wf.jobs['hanwha-collect'];
assert.ok(job);assert.deepEqual(job.needs,['collect']);
assert.match(job.if,/always\(\)/);
assert.equal(job.environment,'portfolio-production-gas');
assert.ok(job.steps.some(x=>x.run==='node scripts/collect-hanwha-fund-nav.mjs --apply'));
console.log('Hanwha NAV guarded importer tests OK');
