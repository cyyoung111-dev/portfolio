import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
const production=isolateGasBusinessLogic(fs.readFileSync('src/gas/apps_script.gs','utf8'));
const moduleSource=fs.readFileSync('ops/issue507/f00001-snapshot-repair.gs','utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
export function setup(options={}) {
 const date='2026-10-30';
 const expected=Array.from({length:39},(_,i)=>[date,i<3?'F0000'+(i+1):'TEST'+i,'fixture',1,100,100,150,150,50,50,'TEST','']);
 expected[0][10]='FUND_NAV';expected[1][10]='FUND_NAV_CARRY@2026-10-29';
 const stored=clone(expected);Object.assign(stored[0],{6:140,7:140,8:40,9:40,10:'FUND_NAV_CARRY@2026-10-29'});
 stored[1][10]='FUND_NAV_CARRY_INPUT_REQUIRED';
 let data=[Array(12).fill('header'),...stored,['2026-10-29','OTHER_DATE',...Array(10).fill('untouched')]];
 const initial=clone(data),props=new Map(),writes=[],backups=[];let held=false,source='source',reads=0;
 function sheetFor(get,set,isBackup=false){return {
  getLastRow:()=>get().length,getLastColumn:()=>get()[0].length,
  getRange:(r,c,n=1,m=1)=>({getFormulas:()=>Array.from({length:n},()=>Array(m).fill(options.formulas?'=1':'')),getValues:()=>{if(!isBackup && ++reads===options.driftRead) data[5][2]='drift';return clone(get().slice(r-1,r-1+n).map(row=>row.slice(c-1,c-1+m)));},
   setValues:values=>{assert.equal(held,true);assert.equal(backups.length,1);assert.deepEqual([r,c,n,m],[2,7,1,5]);writes.push([r,c,n,m]);
    const next=clone(get());values.forEach((row,i)=>row.forEach((v,j)=>next[r-1+i][c-1+j]=v));set(next);
    if(options.partial) data[1][7]=140;
   }}),
  copyTo:()=>{assert.equal(held,true);let b=clone(get());if(options.badBackup)b[1][2]='bad';const copy=sheetFor(()=>b,x=>b=x,true);backups.push(b);return copy;},setName(){return this;}
 };}
 props.set('issue507_f00001_quiescence_v1',JSON.stringify({httpIngressBlocked:true,menuAndTriggersBlocked:true,inFlightExecutionsDrained:true,externalWritersBlocked:true,observedAt:Date.now()}));
 const sheet=sheetFor(()=>data,x=>data=x);
 const ss={getSheetByName:()=>sheet};
 const ctx=vm.createContext({console,Date,Number,Logger:{log(){}},LockService:{getScriptLock:()=>({tryLock:()=>{if(options.lockBusy)return false;held=true;return true;},releaseLock:()=>{held=false;}})},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,deleteProperty:k=>props.delete(k)})},
  SpreadsheetApp:{flush(){}},Utilities:{getUuid:()=> 'synthetic',DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,x)=>Array.from(crypto.createHash('sha256').update(x).digest())}});
 vm.runInContext(production,ctx);vm.runInContext(moduleSource,ctx);
 ctx._issue507AssertDrain_=()=>({activeCount:0}); // real gate is exercised by runtime integration tests
 ctx.getss=()=>ss;ctx._buildSnapshotRowsFromTradeAndPriceHistory=()=>clone(expected);
 ctx._readRawSnapshotRowsByDate=()=>clone(data.slice(1).filter(r=>r[0]===date));
 ctx.getCodeItems=()=>[];ctx._getFundEvaluationAtDate=()=>({sourceDate:'2026-10-29'});
 ctx.diagnosePriceHistoryIntegrity=()=>({rows:expected.map(r=>({code:r[1],status:options.badPrice?'SUSPICIOUS':'VALID'}))});
 ctx._buildSnapshotRangeReadContext=()=>({valuesByName:{[ctx.CONFIG.SHEET_SNAPSHOT]:clone(data),source}});
 ctx._tradeLedgerWriteUnverified_=()=>!!options.ledgerBusy;
 ctx._getFundValuationStatus=(_,from,to,code)=>({code,dates:[{code,date,unitsApplied:true,publicationExpected:true,evaluationState:'EXISTING_VALID',
   navState:code==='F00001'?'EXISTING_CONFIRMED':'NAV_MISSING',snapshotState:code==='F00001'?'WRITE_REQUIRED':'EXISTING_VALID'}]});
 let revisions=0;ctx._touchSnapshotIntegritySourceRevision=()=>revisions++;
 return {ctx,props,writes,backups,expected,stored,initial,get data(){return data;},get held(){return held;},get revisions(){return revisions;},
  run:apply=>ctx.issue507F00001SnapshotRepair_(apply),approve(){const p=this.run(false);props.set('issue507_f00001_approval_v1',p.approvalBinding);props.set('issue507_f00001_external_writers_excluded_v1',p.approvalBinding);return p;}};
}
const h=setup();assert.equal(h.approve().rows,39);assert.equal(h.writes.length,0);assert.equal(h.backups.length,0);
const result=h.run(true);assert.equal(result.changed,1);assert.equal(h.revisions,1);assert.equal(h.held,false);
assert.deepEqual(h.data[1],h.expected[0]);assert.deepEqual(h.data.slice(2),h.initial.slice(2));assert.deepEqual(h.backups[0],h.initial);
assert.equal(h.data[2][10],'FUND_NAV_CARRY_INPUT_REQUIRED');assert.equal(h.props.has('issue507_f00001_approval_v1'),false);
assert.throws(()=>h.run(true));assert.equal(h.writes.length,1);
for(const options of [{lockBusy:true},{ledgerBusy:true},{badPrice:true},{formulas:true}]){const x=setup(options);assert.throws(()=>x.run(false));assert.equal(x.writes.length,0);assert.equal(x.held,false);}
for(const field of ['httpIngressBlocked','menuAndTriggersBlocked','inFlightExecutionsDrained','externalWritersBlocked','observedAt']) {
 const x=setup();const q=JSON.parse(x.props.get('issue507_f00001_quiescence_v1'));q[field]=field==='observedAt'?Date.now()-300001:false;x.props.set('issue507_f00001_quiescence_v1',JSON.stringify(q));assert.throws(()=>x.run(false),/APP_QUIESCENCE_REQUIRED/);assert.equal(x.backups.length,0);assert.equal(x.writes.length,0);
}
const noDrain=setup();noDrain.props.delete('issue507_f00001_quiescence_v1');assert.throws(()=>noDrain.run(false),/APP_QUIESCENCE_REQUIRED/);
const denied=setup();assert.throws(()=>denied.run(true),/APPROVAL_REQUIRED/);assert.equal(denied.backups.length,0);
for(const [key,value] of [['portfolio_close_stage','PRICE'],['portfolio_close_stage','FUND'],[setup().ctx.PORTFOLIO_FUND_LEASE_KEY,JSON.stringify({until:Date.now()+60000})],['portfolio_close_backfill_lease_v1','invalid'],['trade_snapshot_rebuild_pending_v1','pending']]) {
 const x=setup();x.props.set(key,value);assert.throws(()=>x.run(false));assert.equal(x.writes.length,0);
}
for(const mutate of [x=>x.data.splice(3,1),x=>x.data.push(clone(x.data[1])),x=>x.data[3][7]++,x=>x.data[3][4]++,x=>x.data[2][10]='FUND_NAV_CARRY_INPUT_REQUIRED@2026-10-28',x=>x.data[1][3]++]) {
 const x=setup();mutate(x);assert.throws(()=>x.run(false));assert.equal(x.writes.length,0);
}
const external=setup();external.approve();external.props.delete('issue507_f00001_external_writers_excluded_v1');assert.throws(()=>external.run(true),/EXTERNAL_WRITER_EXCLUSION_REQUIRED/);assert.equal(external.backups.length,0);
const stale=setup();stale.approve();stale.data[4][2]='changed';assert.throws(()=>stale.run(true));assert.equal(stale.writes.length,0);
const backup=setup({badBackup:true});backup.approve();assert.throws(()=>backup.run(true),/BACKUP_READBACK_FAILED/);assert.equal(backup.writes.length,0);assert.equal(backup.backups.length,1);
const partial=setup({partial:true});partial.approve();assert.throws(()=>partial.run(true),/WRITE_READBACK_FAILED/);assert.equal(partial.revisions,0);assert.equal(partial.backups.length,1);assert.equal(partial.props.has('issue507_f00001_approval_v1'),false);assert.equal(partial.held,false);
// Mutation oracle: removing the row-column guard must allow the otherwise denied
// unrelated cost-unit change, demonstrating the full-row proof is exercised.
const mutant=setup();vm.runInContext(moduleSource.replace("if(e[col]!==s[col]) throw new Error('OTHER_ROW_OR_COLUMN_CHANGED');",''),mutant.ctx);
mutant.data[3][4]++;assert.doesNotThrow(()=>mutant.run(false));
console.log('PASS F00001 staged repair: production diagnosis, 39-row scope, approval, exclusion, backup/readback, failure retention and mutation oracle');
