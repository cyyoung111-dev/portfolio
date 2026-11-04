import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('scripts/staged/issue860-trigger-maintenance.gs','utf8');
const production=fs.readFileSync('src/gas/apps_script.gs','utf8');
const release=production.match(/var ISSUE507_GATE_RELEASE_ID='([^']+)'/)[1];
const handlers=[
 'runPortfolioHistoricalBackfill2240','runPortfolioMorningKrxBackfill0845',
 'runDailyPortfolioClose1900','runPendingTradeSnapshotRebuild',
 'runPortfolioCloseBackfill2210','handleSnapshotIntegritySheetChange',
 'syncMortgageFromSchedule','handleSnapshotIntegritySheetEdit',
 'runPortfolioHistoricalBackfill0010','runPortfolioCloseWatchdog2030','runCodeNormalize1550'
];
const clone=x=>JSON.parse(JSON.stringify(x));
// Fixture values are deliberately not a production schedule/restore manifest.
const manifest={schema:1,operationId:'fixture-operation',uiEvidence:'fixture-ui-only',triggers:handlers.map((handler,i)=>{
 const sheet=handler.includes('Integrity');
 return {id:'old-'+i,handler,originalDeployment:i%2?'336':'HEAD',
  event:sheet?(handler.endsWith('Edit')?'ON_EDIT':'ON_CHANGE'):'CLOCK',
  source:sheet?'SPREADSHEETS':'CLOCK',sourceId:sheet?'TEST_SHEET_IDENTIFIER_12345678':null,
  schedule:sheet?null:{timezone:'Asia/Seoul',...(handler==='runPendingTradeSnapshotRebuild'
   ?{kind:'HOURLY',hours:1}:{kind:'DAILY',hour:i,minute:i===0?null:10})}};
})};
function fixture(code=source){
 let rows=clone(manifest.triggers),serial=0,locked=false;
 const properties=new Map(),calls=[],fault={};
 const p={getProperty:k=>properties.get(k)??null,setProperty(k,v){
  calls.push(['save',k]);if(fault.save)throw Error('save');properties.set(k,v);
  if(fault.afterSave){fault.afterSave=false;throw Error('save-response-lost');}
 }};
 const trigger=r=>({getUniqueId:()=>r.id,getHandlerFunction:()=>r.handler,
  getEventType:()=>r.event,getTriggerSource:()=>r.source,getTriggerSourceId:()=>r.sourceId});
 const context=vm.createContext({PropertiesService:{getScriptProperties:()=>p},
  LockService:{getScriptLock:()=>({waitLock(){assert.equal(locked,false);locked=true;},releaseLock(){locked=false;}})},
  ScriptApp:{getProjectTriggers:()=>rows.map(trigger),deleteTrigger(t){
   assert.ok(locked);calls.push(['delete',t.getUniqueId()]);
   if(fault.deleteAt===calls.filter(c=>c[0]==='delete').length)throw Error('delete');
   rows=rows.filter(r=>r.id!==t.getUniqueId());
  },newTrigger(handler){
   assert.ok(locked);const values={handler};
   const b={create(){
    calls.push(['create',clone(values)]);
    if(fault.createBefore){fault.createBefore=false;throw Error('create-uncertain');}
    const row={id:'new-'+(++serial),handler,event:values.event,source:values.source,sourceId:values.sourceId??null};
    if(!fault.noCreate)rows.push(row);
    if(fault.createAfter){fault.createAfter=false;throw Error('create-response-lost');}
    return trigger(row);
   }};
   for(const k of ['forSpreadsheet','onEdit','onChange','timeBased','inTimezone','everyHours','everyDays','atHour','nearMinute'])
    b[k]=v=>{
     values[k]=v??true;
     if(k==='forSpreadsheet'){values.source='SPREADSHEETS';values.sourceId=v;}
     if(k==='onEdit')values.event='ON_EDIT';if(k==='onChange')values.event='ON_CHANGE';
     if(k==='timeBased'){values.event='CLOCK';values.source='CLOCK';}
     return b;
    };
   return b;
  }}});
 vm.runInContext(code,context);
 // Use the actual candidate's state validator, not a copy in the fixture.
 vm.runInContext("var ISSUE507_GATE_RELEASE_ID="+JSON.stringify(release)+';\n'+
  production.slice(production.indexOf('function _issue507GateRead_('),production.indexOf('function _issue507GateSave_(')),context);
 return {context,calls,fault,properties,get rows(){return rows;},set rows(v){rows=v;},
  prepare:()=>context.issue860PrepareTriggerPause_(clone(manifest)),
  pause:(id=manifest.operationId)=>context.issue860PausePreparedTriggers_(id),
  restore:()=>context.issue860RestorePreparedTriggers_(manifest.operationId),
  gate:extra=>properties.set('issue507_writer_gate_v1',JSON.stringify({releaseId:release,mode:'DRAINING',active:{},
   completed:[],finished:0,barrierAt:Date.now(),...extra})),
  journal:()=>JSON.parse(properties.get('issue860_trigger_maintenance_v1'))};
}
let f=fixture();assert.equal(f.prepare().phase,'PREPARED');assert.equal(f.calls.some(c=>c[0]==='delete'),false);
assert.throws(()=>f.pause('wrong-id'),/OPERATION/);assert.equal(f.rows.length,11);
assert.equal(f.pause().phase,'PAUSED');assert.equal(f.rows.length,0);assert.equal(f.pause().phase,'PAUSED');
assert.throws(()=>f.restore(),/GATE/);assert.equal(f.calls.filter(c=>c[0]==='create').length,0);
for(const extra of [{mode:'OPEN'},{releaseId:'wrong'},{active:{legacy:{}}}]){
 f.gate(extra);assert.throws(()=>f.restore(),/GATE/);
}
f.gate();assert.equal(f.restore().phase,'RESTORED');assert.equal(f.rows.length,11);
assert.equal(f.restore().phase,'RESTORED');assert.equal(f.calls.filter(c=>c[0]==='create').length,11);
assert.equal(JSON.parse(f.properties.get('issue507_writer_gate_v1')).mode,'DRAINING');
for(const spec of manifest.triggers){
 const c=f.calls.find(c=>c[0]==='create'&&c[1].handler===spec.handler)[1];
 if(spec.event==='CLOCK'){
  assert.equal(c.inTimezone,'Asia/Seoul');
  if(spec.schedule.kind==='HOURLY')assert.equal(c.everyHours,1);
  else {assert.equal(c.everyDays,1);assert.equal(c.atHour,spec.schedule.hour);
   assert.equal(c.nearMinute,spec.schedule.minute===null?undefined:spec.schedule.minute);}
 }else {assert.equal(c.forSpreadsheet,spec.sourceId);assert.equal(c[spec.event==='ON_EDIT'?'onEdit':'onChange'],true);}
}
// Journal failure before delete preserves every original trigger.
f=fixture();f.prepare();f.fault.save=true;assert.throws(()=>f.pause(),/save/);assert.equal(f.rows.length,11);
// Partial deletion and restart continue from saved original IDs, never broaden.
f=fixture();f.prepare();f.fault.deleteAt=4;assert.throws(()=>f.pause(),/delete/);
assert.equal(f.rows.length,8);assert.equal(f.journal().phase,'PAUSING');f.fault.deleteAt=0;
assert.equal(f.pause().phase,'PAUSED');assert.equal(f.rows.length,0);
// Changed inventory / duplicate / unknown handler fail BEFORE any delete.
for(const mutate of [rows=>rows.push({...rows[0],id:'foreign'}),rows=>rows[0].handler='unrelated',rows=>rows.pop()]){
 f=fixture();f.prepare();mutate(f.rows);assert.throws(()=>f.pause(),/INVENTORY_CHANGED/);
 assert.equal(f.calls.some(c=>c[0]==='delete'),false);
}
// Create committed but response lost: adopt exact one pending candidate, not duplicate.
f=fixture();f.prepare();f.pause();f.gate();f.fault.createAfter=true;
assert.throws(()=>f.restore(),/response-lost/);assert.equal(f.rows.length,1);
assert.equal(f.restore().phase,'RESTORED');assert.equal(f.calls.filter(c=>c[0]==='create').length,11);
// No terminal proof after uncertain creation: remain blocked even if list is empty.
f=fixture();f.prepare();f.pause();f.gate();f.fault.createBefore=true;
assert.throws(()=>f.restore(),/uncertain/);assert.throws(()=>f.restore(),/CREATE_OUTCOME_UNVERIFIED/);
assert.equal(f.calls.filter(c=>c[0]==='create').length,1);
// Lost journal acknowledgement is recovered from durable pending intent.
f=fixture();f.prepare();f.pause();f.gate();f.fault.afterSave=true;
assert.throws(()=>f.restore(),/save-response-lost/);assert.equal(f.restore().phase,'RESTORED');
// Unexpected or missing recreated triggers cannot be certified or silently replaced.
f=fixture();f.prepare();f.pause();f.gate();f.restore();f.rows.pop();
assert.throws(()=>f.restore(),/INVENTORY_CHANGED/);
f=fixture();f.prepare();f.pause();f.gate();f.fault.createAfter=true;assert.throws(()=>f.restore());
f.rows.push({...f.rows[0],id:'duplicate'});assert.throws(()=>f.restore(),/AMBIGUOUS/);
assert.equal(f.calls.filter(c=>c[0]==='create').length,1);
for(const mutate of [m=>m.triggers.pop(),m=>m.triggers[0].schedule.hour=24,
 m=>m.triggers[0].originalDeployment='other',m=>m.triggers[1].id=m.triggers[0].id,
 m=>m.triggers[5].sourceId='',m=>m.uiEvidence='']){
 f=fixture();const m=clone(manifest);mutate(m);
 assert.throws(()=>f.context.issue860PrepareTriggerPause_(m),/MANIFEST/);assert.equal(f.calls.length,0);
}
// Staging is deliberate: no production inclusion, HTTP/menu route or deployment bypass.
assert.ok(!production.includes('issue860PausePreparedTriggers_'));
assert.match(fs.readFileSync('scripts/deploy-gas.mjs','utf8'),/GAS_FIRST_GATE_CUTOVER_UNVERIFIED/);
for(const denied of ['SpreadsheetApp','UrlFetchApp','fetch(', 'eval(', 'deleteAllProperties'])assert.ok(!source.includes(denied));
// Independent mutation oracles: removing either guard must break the invariant.
const withoutSave=source.replace("j.phase='PAUSING';_issue860Save_(p,j);", "j.phase='PAUSING';");
assert.notEqual(withoutSave,source);
f=fixture(withoutSave);f.prepare();f.fault.save=true;assert.throws(()=>f.pause());
assert.notEqual(f.rows.length,11,'mutation must expose deletes before durable intent');
const withoutPending=source.replace("if(j.pending!==null)_issue860Fail_('CREATE_OUTCOME_UNVERIFIED');",'');
assert.notEqual(withoutPending,source);
f=fixture(withoutPending);f.prepare();f.pause();f.gate();f.fault.createBefore=true;
assert.throws(()=>f.restore());f.restore();
assert.notEqual(f.calls.filter(c=>c[0]==='create').length,1,'mutation must expose retry without terminal proof');
console.log('Issue860 staged trigger pause/restore: journal, partial failure, lost response, isolation gates and schedule factories PASS');
