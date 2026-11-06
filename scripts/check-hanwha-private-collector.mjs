import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {run} from './collect-hanwha-fund-nav.mjs';

const now=new Date('2026-11-06T00:15:00Z');
const sourceRows=[
 {date:'2026-11-03',nav:1975.18},
 {date:'2026-11-04',nav:1944.84},
 {date:'2026-11-05',nav:1951.24}
];
function fixture({busy=false,invalidAuth=false,conflict=false,
 lostImportAck=false,lostRefreshAck=false,uncommittedImportTimeout=false,
 wrongClass=false}={}){
 let calls=0,mutations=0;
 const navStored=new Map(),refreshed=new Set(),actions=[];
 const fetchImpl=async (_url,opts)=>{
   calls++;
   if(!opts.body)return {ok:true,json:async()=>({list:[
     ...sourceRows.map(x=>({wkdate:x.date.replaceAll('-',''),price:String(x.nav)})),
     {wkdate:'20261106',price:'1999.00'}]})};
   const p=Object.fromEntries(opts.body);
   actions.push(p.action);
   assert.ok(['getAutomationStatus','previewFundNavImport','getFundValuationStatus',
     'collectHanwhaFundNav'].includes(p.action),'unapproved GAS action');
   if(p.accessToken==='HANWHA_AUTH_PROBE')
     return {ok:true,json:async()=>invalidAuth?
       ({status:'ok'}):({status:'error',message:'인증 실패'})};
   if(p.action==='getAutomationStatus')return {ok:true,json:async()=>({
     status:'ok',gasVersion:'9.284',automation:{
       closeRun:{state:busy?'RUNNING':'ERROR',runDate:'2026-11-05'},
       tradeSnapshotWorkerLastResult:{status:'IDLE'},tradeSnapshotDeferredCount:0}})};
   if(p.action==='previewFundNavImport'){
     const input=JSON.parse(p.data);
     assert.equal(input.code,'F00001');
     assert.equal(input.provider,'HANWHA_2045_CRPE');
     assert.equal(input.classCode,'C-RPe');
     assert.equal(input.ackWarnings,false);
     assert.equal(input.appendOnly,true);
     assert.ok(input.rows.every(row=>row.date<'2026-11-06'));
     const candidates=[],identical=[];
     for(const row of input.rows){
       if(navStored.get(row.date)===row.nav)identical.push({
         date:row.date,existingNav:row.nav,uploadedNav:row.nav});
       else candidates.push(row);
     }
     return {ok:true,json:async()=>({
       status:'ok',code:'F00001',candidates,identical,
       updates:conflict?[{date:'2026-11-05'}]:[],
       errors:[],warnings:[],duplicates:[],zeroUnits:[]})};
   }
   if(p.action==='getFundValuationStatus'){
     assert.equal(p.code,'F00001');
     assert.equal(p.to,'2026-11-05');
     const dates=sourceRows.map(row=>({
       code:'F00001',date:row.date,
       navState:navStored.has(row.date)?'EXISTING_CONFIRMED':'NAV_MISSING',
       unitsApplied:true,reconciled:true,valuationRequired:true,
       evaluationState:refreshed.has(row.date)?'EXISTING_VALID':'WRITE_REQUIRED',
       snapshotState:refreshed.has(row.date)?'EXISTING_VALID':'NOT_CREATED'}));
     return {ok:true,json:async()=>({
       status:'ok',fundResults:{F00001:{dates}}})};
   }
   const data=JSON.parse(p.data||'{}');
   if(p.mode==='import'){
     assert.equal(data.code,'F00001');
     assert.equal(data.provider,'HANWHA_2045_CRPE');
     assert.equal(data.classCode,'C-RPe');
     assert.equal(data.appendOnly,true);
     assert.equal(data.ackWarnings,false);
     assert.ok(data.rows.length>0&&data.rows.length<=8);
     assert.ok(data.rows.every(x=>sourceRows.some(y=>y.date===x.date&&y.nav===x.nav)));
     mutations++;
     if(!uncommittedImportTimeout)for(const x of data.rows)navStored.set(x.date,x.nav);
     if(lostImportAck||uncommittedImportTimeout)throw Object.assign(Error('transient'),{name:'TimeoutError'});
     return {ok:true,json:async()=>({status:'ok',saveState:'success'})};
   }
   if(p.mode==='refresh'){
     assert.equal(p.date<= '2026-11-05',true);
     assert.ok(navStored.has(p.date),'no missing NAV allowed before refresh');
     mutations++;
     refreshed.add(p.date);
     if(lostRefreshAck)throw Object.assign(Error('transient'),{name:'TimeoutError'});
     return {ok:true,json:async()=>({status:'ok'})};
   }
   throw Error('UNAPPROVED_MUTATION');
 };
 return {fetchImpl,actions,get calls(){return calls},get mutations(){return mutations},
  navStored,refreshed};
}
const args=f=>({url:'https://script.google.com/macros/s/TEST/exec',
 token:'TEST_VALUE',now,fetchImpl:f.fetchImpl});
{
 const f=fixture(),r=await run({...args(f),apply:false});
 assert.equal(r.mode,'DRY_RUN');
 assert.equal(r.candidates,3);
 assert.equal(r.writerInvoked,false);
 assert.deepEqual(r.missingNavDates,sourceRows.map(x=>x.date));
 assert.deepEqual(r.pendingDates,sourceRows.map(x=>x.date));
 assert.equal(f.mutations,0);
 assert.equal(f.actions.filter(x=>x==='collectHanwhaFundNav').length,0);
}
for(const options of [{},{lostImportAck:true},{lostRefreshAck:true}]){
 const f=fixture(options),r=await run({...args(f),apply:true});
 assert.equal(r.mode,'APPLY');
 assert.equal(r.code,'F00001');
 assert.equal(r.candidates,3);
 assert.equal(r.imported,3);
 assert.equal(r.derivedRepaired,3);
 assert.equal(r.finalPending,0);
 assert.equal(r.writerInvoked,true);
 assert.equal(r.importAckRecovered,options.lostImportAck===true);
 assert.equal(f.navStored.size,3);
 assert.equal(f.refreshed.size,3);
 assert.equal(f.mutations,4);
 assert.deepEqual(f.actions.filter(x=>x==='collectHanwhaFundNav').length,4);
}
{
 const f=fixture({uncommittedImportTimeout:true});
 await assert.rejects(()=>run({...args(f),apply:true}),/HANWHA_IMPORT_READBACK_UNVERIFIED/);
 assert.equal(f.mutations,1);
 assert.equal(f.navStored.size,0);
 assert.equal(f.refreshed.size,0);
}
for(const options of [{busy:true},{invalidAuth:true},{conflict:true}]){
 const f=fixture(options);
 await assert.rejects(()=>run({...args(f),apply:true}),/HANWHA_/);
 assert.equal(f.mutations,0);
}
const workflow=YAML.parse(fs.readFileSync('.github/workflows/kb-fund-nav-collect.yml','utf8'));
const job=workflow.jobs['hanwha-collect'];
assert.ok(job);
assert.deepEqual(job.needs,['collect']);
assert.equal(job.environment,'portfolio-production-gas');
assert.match(job.if,/always\(\)/);
assert.ok(job.steps.some(s=>s.run==='node scripts/collect-hanwha-fund-nav.mjs --apply'));
assert.doesNotMatch(JSON.stringify(job),/importFundNav|TELEGRAM_/);
const privateSource=fs.readFileSync('scripts/collect-hanwha-fund-nav.mjs','utf8');
assert.match(privateSource,/request\('collectHanwhaFundNav'/);
assert.doesNotMatch(privateSource,/request\('importFundNav'|request\('collectKbFundNav'/);
console.log('Hanwha v9.284 shared-lease import: preview/ACK recovery/dated refresh/zero-write denial PASS');
