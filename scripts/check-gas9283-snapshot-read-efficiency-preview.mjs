import assert from 'node:assert/strict';
import vm from 'node:vm';
import {gasSourceBlobSha} from './deploy-gas.mjs';
import {composeGas9283SnapshotReadEfficiencyPreview} from './compose-gas9283-snapshot-read-efficiency-preview.mjs';
const {candidate,baseCandidate,manifest}=composeGas9283SnapshotReadEfficiencyPreview();
function extract(source,name){
 const token='function '+name+'(';
 const begin=source.indexOf(token),end=source.indexOf(String.fromCharCode(10)+'}',begin);
 assert.ok(begin>=0&&end>begin&&source.indexOf(token,begin+token.length)<0);
 return source.slice(begin,end+2);
}
const name='saveDailyPriceHistory';
assert.equal(gasSourceBlobSha(candidate),manifest.candidateBlob);
assert.equal(gasSourceBlobSha(baseCandidate),manifest.baseBlob);
assert.equal(candidate.replace(extract(candidate,name),extract(baseCandidate,name)),baseCandidate);
assert.equal(manifest.approved,false);
assert.equal(manifest.deployed,false);
new vm.Script(candidate,{filename:'synthetic-gas9283.gs'});
const DATE='2026-11-05';
const items=Array.from({length:37},(_,i)=>({code:String(900000+i),type:'ETF',market:'KR',currency:'KRW',name:'test '+i}));
function execute(source,mode='rewrite'){
 const counters={oldRead:0,plan:0,build:0,write:0,price:0,check:0,flush:0,lock:0,release:0};
 const data=new Map();
 const props={getProperty:k=>data.get(k)||null,setProperty:(k,v)=>data.set(k,String(v)),deleteProperty:k=>data.delete(k)};
 const prices=Object.fromEntries(items.map(x=>[x.code,{price:100,usedDate:DATE,marketDate:DATE,source:'NH_REGULAR_CLOSE'}]));
 const ctx=vm.createContext({
  Date,JSON,Number,String,isFinite,
  CONFIG:{TIMEZONE:'Asia/Seoul'},
  _snapshotBackupOperationId:'',
  Logger:{log(){}},
  Utilities:{formatDate:()=>DATE+' 20:37:37',getUuid:()=> 'synthetic'},
  LockService:{getScriptLock:()=>({waitLock:()=>{counters.lock++;},releaseLock:()=>{counters.release++;}})},
  PropertiesService:{getScriptProperties:()=>props},
  SpreadsheetApp:{flush:()=>{counters.flush++;}},
  today:()=>DATE,getss:()=>({}),_normalizeDate:v=>String(v||''),
  getCodeItems:()=>items,_getDailyHeldCodeItems:()=>items,
  _isKrxDailyCloseTarget_:()=>true,_assertSupportedDailyCloseMarkets_:()=>{},
  _seedMissingKrxCloseDates_:()=>{},_krxCalendarStatus_:()=> 'OPEN',
  fetchDomesticRegularCloses:()=>prices,_verifyForeignDailyCloseCoverage_:()=>{},
  _latestConfirmedForeignCloseDate_:()=>'',_assessDailyKrxStockClose:()=>({required:true,date:DATE,confirmed:37,expected:37}),
  _selectPortfolioCloseSnapshotDate_:()=>DATE,
  batchUpsertPriceHistory:(_ss,d,rows)=>{
   assert.equal(d,DATE);assert.equal(rows.length,37);counters.price++;
  },
  _buildSnapshotRowsFromTradeAndPriceHistory:()=>{counters.build++;return Array.from({length:39},(_,i)=>[DATE,String(i)]);},
  _readSnapshotRowsByDate:()=>{counters.oldRead++;return [];},
  _snapshotRewritePlan:(_ss,d,rows)=>{
   assert.equal(d,DATE);assert.equal(rows.length,39);counters.plan++;
   if(mode==='conflict')return {unsafe:[{classification:'MANUAL_PROTECTED',reason:'synthetic'}],needsRewrite:false};
   return {unsafe:[],needsRewrite:mode==='rewrite'};
  },
  writeSnapshotRows:(_ss,d,rows)=>{assert.equal(d,DATE);assert.equal(rows.length,39);counters.write++;},
  diagnoseSnapshotIntegrity:()=>{counters.check++;return {status:'VALID'};},
  _settleSnapshotBackupOperation:()=>{},_completePendingKrxCloseDate_:()=>{},
  _hasKrxHoldingsForCloseDate_:()=>true,_enqueuePendingKrxCloseDate_:()=>true
 });
 vm.runInContext(extract(source,name),ctx);
 let result,error=null;
 try{result=ctx.saveDailyPriceHistory(undefined,{deferQueueCompletion:true});}
 catch(e){error=String(e.message||e);}
 return {result,error,counters,successDate:props.getProperty('snapshot_last_success_date')};
}
for(const mode of ['rewrite','no-rewrite','conflict']){
 const old=execute(baseCandidate,mode),next=execute(candidate,mode);
 assert.equal(old.counters.oldRead,1,'pinned path performs the redundant read');
 assert.equal(next.counters.oldRead,0,'candidate removes only the unused read');
 for(const key of ['plan','build','write','price','check','flush','lock','release'])
   assert.equal(next.counters[key],old.counters[key],mode+' business side effect '+key);
 assert.equal(next.error,old.error);
 assert.equal(next.successDate,old.successDate);
 if(mode==='rewrite'){
   assert.equal(next.result.ok,true);
   assert.equal(next.result.rows,39);
   assert.equal(next.counters.price,1);assert.equal(next.counters.write,1);
   assert.equal(next.counters.check,1);
 }else if(mode==='no-rewrite'){
   assert.equal(next.result.ok,true);assert.equal(next.counters.write,0);
 }else {
   assert.match(next.error,/Snapshot 보호 충돌/);
   assert.equal(next.counters.write,0);
   assert.equal(next.successDate,null);
 }
}
console.log('GAS9283_SNAPSHOT_UNUSED_READ_REMOVAL_OK '+JSON.stringify({
 sourceOnly:true,syntheticCases:3,savedReadCallsPerClose:1,
 candidateBlob:manifest.candidateBlob,financeWrites:0,productionDeployed:false
}));
