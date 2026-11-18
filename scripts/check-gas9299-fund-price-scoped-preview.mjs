import assert from 'node:assert/strict';
import vm from 'node:vm';
import {composeGas9299FundPriceScopedPreview} from './compose-gas9299-fund-price-scoped-preview.mjs';
const {parent,candidate,manifest}=composeGas9299FundPriceScopedPreview();
new vm.Script(candidate);
const fn=s=>{const a=s.indexOf('function _refreshFundValuations(');return s.slice(a,s.indexOf('\n}',a)+2);};
const patched=fn(candidate);
const before=patched.indexOf("  _fundRecoveryDiagnosticStart(diagnostic, onlyCode, 'priceHistoryWrite'");
const after=patched.indexOf('  } finally {\n    if (writeLocked) writeLock.releaseLock();',before);
assert(before>0&&after>before);
const block=patched.slice(before,after);
assert(patched.indexOf('writeLock.waitLock(30000)')<before);
assert.match(block,/if \(scopedPriceWrite\)/);
assert.match(block,/_backupSheetBeforeWrite/);
assert.match(block,/_markSnapshotBackupStatus\(priceBackup, 'WRITE_FAILED'/);
const remove=s=>s.replace(fn(s),'').replaceAll('9.298','VERSION').replaceAll('9.299','VERSION');
assert.equal(remove(parent),remove(candidate),'other business functions must remain exact');
const d='2026-11-18', old='2026-11-17', now='2026-11-19T00:15:00.000Z';
function fixture({manual=false,fail=false,unchanged=false,append=false}={}){
 const rows=[
  [old,'005930','Stock',77000,'old','NH_CLOSE'],
  [d,'F00001','Fund 1',1000,'old','FUND_NAV_CARRY'],
  [d,'F00002','Fund 2',3000,'newer','MANUAL'],
  [d,'000660','Other',190000,'newer','NH_CLOSE'],
  [old,'F00001','Fund 1',900,'old','FUND_NAV']
 ];
 if(unchanged)rows[1]=[d,'F00001','Fund 1',2000,'newer','FUND_NAV'];
 if(append)rows.splice(1,1);
 const original=JSON.parse(JSON.stringify(rows)),writes=[],proofs=[],marks=[];
 let backups=0,touches=0;
 const sheet={getLastRow:()=>rows.length+1,getRange:(r,c,h,w)=>({
  getValues:()=>rows.slice(r-2,r-2+h).map(row=>row.slice(c-1,c-1+w)),
  setNumberFormat:f=>assert.equal(f,'@'),
  setValues:batch=>{assert.equal(c,1);assert.equal(w,6);writes.push({r,h});batch.forEach((row,i)=>rows[r-2+i]=row.slice());}
 })};
 const ctx=vm.createContext({
  diagnostic:null,onlyCode:null,maxSnapshotWrites:manual?undefined:1,ss:{getSheetByName:()=>sheet},CONFIG:{SHEET_PH:'price'},
  ph:sheet,prices:original.map(r=>r.slice()),priceKeys:{
   [d+'|F00001']:[d,'F00001','Fund 1',1,'stale','FUND_NAV_CARRY'],
   [d+'|F00002']:[d,'F00002','Fund 2',1,'stale','FUND_NAV_CARRY']
  },
  values:[
   {date:d,code:'F00001',name:'Fund 1',evalAmt:2000,carried:false,inputRequired:false},
   {date:d,code:'F00002',name:'Fund 2',evalAmt:4000,carried:false,inputRequired:false}
  ],fundResults:{F00001:{prices:0,pricesExisting:0},F00002:{prices:0,pricesExisting:0}},
  configs:[],now,navChanged:false,from:d,
  _fundRecoveryDiagnosticStart:()=>{},_fundRecoveryDiagnosticFinish:()=>{},
  _fundConfiguredCodeForPriceRow:row=>row[1].startsWith('F')?row[1]:'',
  _normalizeDate:x=>x,_preferFundRepresentativeRow:prev=>!prev,
  _normalizeCodeRows:rs=>rs.map(r=>r.slice()),_setCodeColumnText:()=>{},
  _backupSheetBeforeWrite:()=>{backups++;return 'backup';},
  _markSnapshotBackupStatus:(id,status)=>marks.push(status),_cleanupCurrentSystemBackup:()=>{},
  _verifyWrittenRange:(_s,r,c,b)=>{proofs.push({r,rows:b.length});if(fail)throw Error('READBACK_MISMATCH');assert.equal(JSON.stringify(rows.slice(r-2,r-2+b.length)),JSON.stringify(b));},
  _touchSnapshotIntegritySourceRevision:()=>{touches++;}
 });
 // Manual uses its original full snapshot data; make the fixture's keys refer to it.
 if(manual){ctx.priceKeys={[d+'|F00001']:ctx.prices[1],[d+'|F00002']:ctx.prices[2]};}
 const run=()=>vm.runInContext(block,ctx);
 return {run,rows,original,writes,proofs,marks,get backups(){return backups},get touches(){return touches}};
}
const f=fixture();f.run();
assert.deepEqual(f.writes,[{r:3,h:1}]);assert.deepEqual(f.proofs,[{r:3,rows:1}]);
assert.equal(f.rows[1][3],2000);assert.equal(f.rows[1][5],'FUND_NAV');
assert.deepEqual(f.rows[2],f.original[2]);assert.deepEqual(f.rows[3],f.original[3]);assert.deepEqual(f.rows[0],f.original[0]);assert.deepEqual(f.rows[4],f.original[4]);
assert.deepEqual(f.marks,['COMPLETED']);assert.equal(f.backups,1);assert.equal(f.touches,1);
const n=fixture({unchanged:true});n.run();assert.equal(n.writes.length,0);assert.equal(n.backups,0);assert.equal(n.touches,0);
const a=fixture({append:true});a.run();assert.deepEqual(a.writes,[{r:6,h:1}]);assert.deepEqual(a.proofs,[{r:6,rows:1}]);assert.equal(a.backups,0);
const bad=fixture({fail:true});assert.throws(bad.run,/READBACK_MISMATCH/);assert.deepEqual(bad.marks,['WRITE_FAILED']);assert.equal(bad.touches,0);
const m=fixture({manual:true});m.run();assert.deepEqual(m.writes,[{r:2,h:5}]);assert.deepEqual(m.proofs,[{r:2,rows:5}]);
assert.equal(manifest.productionDeploymentApproved,false);
console.log('GAS9299_FUND_PRICE_SCOPED_PREVIEW '+JSON.stringify({...manifest,offlineCases:5}));
