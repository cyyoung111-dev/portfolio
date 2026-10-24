import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {selfTest,run} from './run-issue507-maintenance.mjs';
import {selfTest as ledgerProofSelfTest} from './issue507-ledger-worker-readonly.mjs';
import {execFileSync} from 'node:child_process';
const source=fs.readFileSync('src/gas/apps_script.gs','utf8');
function setup(options={}) {
  const dates=['2025-12-31','2026-01-01','2026-01-02'];
  const props=new Map([['access_token','TEST'],['trade_snapshot_rebuild_deferred_v1',JSON.stringify({dates,cursor:''})],['trade_snapshot_rebuild_pending_v1','UNCHANGED']]);
  const old=[['date','code','name','price','at','source'],['2025-12-30','000001','EXISTING',10,'','MANUAL']];
  if(options.zeroExisting)old.push(['2025-12-30','000002','EXISTING_ZERO',0,'KEPT','ORIGINAL']);
  const ph={rows:structuredClone(old),getLastRow(){return this.rows.length;},getLastColumn:()=>6,getRange(r,c,h,w){return {getValues:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>this.rows[r-1+i]?.[c-1+j]??'')),getFormulas:()=>Array.from({length:h},()=>Array(w).fill('')),setValues:values=>{writes++;values.forEach((v,i)=>{this.rows[r-1+i]??=[];v.forEach((x,j)=>this.rows[r-1+i][c-1+j]=x);});}};},copyTo(){copies++;const clone=structuredClone(this.rows);return {setName(){return {getRange:()=>({getValues:()=>options.badBackup?[]:clone})};}};}};
  const ss={getSheetByName:n=>n==='가격이력'?ph:null};let copies=0,released=0,reads=0,fetches=0,writes=0;
  const context=vm.createContext({Date,console,Logger:{log(){}},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})},LockService:{getScriptLock:()=>({tryLock:()=>!options.busy,releaseLock:()=>released++})},SpreadsheetApp:{flush(){}},Utilities:{formatDate:()=> '20261024_120000'}});
  vm.runInContext(options.omitExistingGuard?source.replace(" || existingKeys[used+'|'+item.code]",''):source,context);
  const actualWriter=context.batchUpsertPriceHistory;
  Object.assign(context,{jsonOk:x=>({status:'ok',...x}),jsonError:message=>({status:'error',message}),getss:()=>ss,
    _tradeLedgerWriteUnverified_:()=>!!options.unverified,
    _buildSnapshotRangeReadContext:()=>({ss,read:++reads,valuesByName:{'가격이력':ph.rows}}),
    _issue507StrictReadSourceDigest_:x=>options.drift?String(x.read):'SAME',
    _peekSnapshotIntegritySourceRevisionReadonly_:()=> 'SAME',
    _buildSnapshotRangeIndexes:()=>({holdingsByRequestedDate:{'2025-12-31':{
      A:{code:'000001'},B:{code:'000002'},C:{code:'000003'},F:{code:'F00001'},...(options.foreign?{U:{code:'US_CODE'}}:{})}},
      positivePriceSeriesByCode:{'000001':[{date:'2025-12-30',price:10}]},
      codeItems:[...['000001','000002','000003'].map(code=>({code,name:'PRIVATE_NAME',currency:'KRW'})),...(options.foreign?[{code:'US_CODE',name:'PRIVATE_US',currency:'USD'}]:[])]}),
    diagnoseSnapshotIntegrity:(_s,d)=>({date:d,status:d==='2025-12-31'?'SOURCE_INCOMPLETE':options.conflict?'CONFLICT':'VALID',expectedRowCount:33,sourceDataErrors:options.hiddenError?['PRIVATE']:[],duplicateKeys:options.duplicate?['X']:[],conflictKeys:[]}),
    fetchPricesKrx:(items,date)=>{fetches++;assert.equal(date,'2025-12-30');assert.deepEqual(Array.from(items,x=>x.code),['000002','000003']);return {
      '000002':{price:20,usedDate:options.future?'2026-01-02':'2025-12-30',source:options.untrusted?'CURRENT':'KRX'},
      '000003':{price:30,usedDate:'2026-01-01',source:'KRX'}};},
    batchUpsertPriceHistory:(_ss,date,items)=>{writes++;for(const x of items)ph.rows.push([date,x.code,x.name,x.price,'',x.source]);}
  });
  if(options.productionWriter) {context.batchUpsertPriceHistory=actualWriter;context._setCodeColumnText=()=>{};context._touchSnapshotIntegritySourceRevision=()=>{};}
  return {context,run:(mode='reconcile',apply='1')=>context.handleIssue507Maintenance(mode,apply),props,ph,old,
    stats:()=>({copies,released,reads,fetches,writes})};
}
let f=setup();let r=f.run();assert.equal(r.removed,2);assert.equal(r.remaining,1);assert.equal(JSON.parse(f.props.get('trade_snapshot_rebuild_deferred_v1')).dates[0],'2025-12-31');assert.ok(f.props.has('issue507_deferred_reconcile_backup_v1'));assert.equal(f.props.get('trade_snapshot_rebuild_pending_v1'),'UNCHANGED');assert.deepEqual(f.ph.rows,f.old);assert.equal(f.run().removed,0);assert.equal(f.stats().released,2);
for(const options of [{busy:true},{unverified:true},{drift:true},{conflict:true},{hiddenError:true},{duplicate:true}]) {f=setup(options);const before=f.props.get('trade_snapshot_rebuild_deferred_v1');r=f.run();assert.equal(f.props.get('trade_snapshot_rebuild_deferred_v1'),before);assert.deepEqual(f.ph.rows,f.old);assert.equal(f.stats().writes,0);}
f=setup();r=f.run('reconcile','0');assert.equal(r.removed,0);assert.equal(r.verifiedValid,2);assert.ok(!f.props.has('issue507_deferred_reconcile_backup_v1'));
f=setup();r=f.run('yearendPrices');assert.equal(r.added,1);assert.equal(f.stats().copies,1);assert.equal(f.ph.rows.length,3);assert.deepEqual(f.ph.rows.slice(0,2),f.old);assert.equal(JSON.parse(f.props.get('trade_snapshot_rebuild_deferred_v1')).dates.length,3);assert.ok(!JSON.stringify(r).includes('PRIVATE_NAME'));
for(const options of [{future:true},{untrusted:true},{drift:true},{badBackup:true}]) {f=setup(options);r=f.run('yearendPrices');assert.deepEqual(f.ph.rows,f.old);assert.equal(f.stats().writes,0);}
f=setup();r=f.run('yearendPrices','0');assert.equal(r.available,1);assert.equal(r.added,0);assert.equal(f.stats().copies,0);assert.deepEqual(f.ph.rows,f.old);
f=setup();r=f.run('invalid');assert.equal(r.status,'error');assert.equal(f.stats().reads,0);
f=setup({foreign:true,productionWriter:true});r=f.run('yearendPrices');assert.equal(r.added,1);assert.equal(f.stats().fetches,1);assert.deepEqual(f.ph.rows.slice(0,2),f.old);
f=setup({zeroExisting:true,productionWriter:true});r=f.run('yearendPrices');assert.equal(r.available,0);assert.equal(f.stats().writes,0);assert.deepEqual(f.ph.rows,f.old);
f=setup({zeroExisting:true,productionWriter:true,omitExistingGuard:true});r=f.run('yearendPrices');assert.equal(r.status,'error');assert.notDeepEqual(f.ph.rows,f.old,'regression oracle must expose the real upsert mutation without the new preflight');
assert.match(source,/if \(params.action === 'issue507Maintenance'\) return jsonError\('POST_ONLY'\)/);
const wf=fs.readFileSync('.github/workflows/issue-507-approved-maintenance.yml','utf8');
assert.ok(wf.includes("github.event.workflow_run.event == 'workflow_run'"),'automatic GAS deployments arrive as workflow_run, not push');
assert.ok(wf.includes("github.ref == 'refs/heads/main'"));
assert.ok(wf.includes('APPROVED_PARENT: 04acdc28181d170f2f2800b22d165db914d6d884'));
assert.ok(wf.includes('git rev-parse HEAD^')); 

// End-to-end protocol test: client -> real doPost parser -> real request
// authentication -> real maintenance -> persisted queue -> real status route.
f=setup({productionWriter:true});
f.context._getAutomationStatusData=()=>({tradeSnapshotDeferredCount:JSON.parse(f.props.get('trade_snapshot_rebuild_deferred_v1')||'{"dates":[]}').dates.length});
const realFetch=async(_url,options)=>({ok:true,json:async()=>f.context.doPost({postData:{contents:String(options.body)}})});
const integration=await run({url:'https://script.google.com/macros/s/TEST/exec',token:'TEST',apply:true,fetchImpl:realFetch});
assert.equal(integration.summaries[0].removed,2);assert.equal(integration.summaries[1].added,1);assert.equal(integration.deferredCount,1);
assert.deepEqual(f.ph.rows.slice(0,2),f.old);
f=setup();f.context._getAutomationStatusData=()=>({tradeSnapshotDeferredCount:3});
await assert.rejects(()=>run({url:'https://script.google.com/macros/s/TEST/exec',token:'TEST',apply:true,fetchImpl:async(u,o)=>{const bad=new URLSearchParams(o.body);const token=bad.get('accessToken');bad.delete('accessToken');bad.set('token',token);return realFetch(u,{...o,body:bad});}}),/MAINTENANCE_VERSION/,'old token field must fail the real authentication route before writes');
assert.equal(f.stats().writes,0);assert.equal(JSON.parse(f.props.get('trade_snapshot_rebuild_deferred_v1')).dates.length,3);
await selfTest();
await ledgerProofSelfTest();
execFileSync(process.execPath,['scripts/issue507-deferred-source-audit-readonly.mjs','--self-test'],{stdio:'inherit'});
console.log('✅ #507 실제 유지보수 함수: 큐 검증·불일치/경합 보존·백업·미래 가격 거부·append-only');
