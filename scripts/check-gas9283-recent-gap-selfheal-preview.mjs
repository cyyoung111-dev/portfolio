import assert from 'node:assert/strict';
import vm from 'node:vm';
import {gasSourceBlobSha} from './deploy-gas.mjs';
import {composeGas9283RecentGapSelfHealPreview}
  from './compose-gas9283-recent-gap-selfheal-preview.mjs';
const {candidate,baseCandidate,manifest}=composeGas9283RecentGapSelfHealPreview();
const extract=(source,name)=>{
 const marker='function '+name+'(';
 const i=source.indexOf(marker),end=source.indexOf(String.fromCharCode(10)+'}',i);
 assert.ok(i>=0&&end>i&&source.indexOf(marker,i+marker.length)<0,name);
 return source.slice(i,end+2);
};
assert.equal(manifest.status,'SOURCE_PREVIEW_NOT_DEPLOYABLE');
assert.equal(manifest.productionGasChanged,false);
assert.equal(manifest.deploymentApproved,false);
assert.equal(gasSourceBlobSha(candidate),manifest.candidateBlob);
new vm.Script(candidate,{filename:'gas-v9283-gap-preview.gs'});
const added=extract(candidate,'_seedRecentMissingKrxSnapshotDays_');
const oldFn=extract(baseCandidate,'_runPendingKrxBackfillWithLease_');
const newFn=extract(candidate,'_runPendingKrxBackfillWithLease_');
const hook="        _seedRecentMissingKrxSnapshotDays_(ss, sharedProps, runDate);"+String.fromCharCode(10);
assert.equal(newFn.replace(hook,''),oldFn,'only one new hook inside existing backfill');
assert.equal(candidate.replace(newFn,oldFn).replace(String.fromCharCode(10)+added+String.fromCharCode(10),''),baseCandidate,
 'all other GAS functions must remain unchanged');
assert.match(newFn,/if \(!fromClose && !targetDate\)[\s\S]*_seedRecentMissingKrxSnapshotDays_/);
assert.equal(extract(candidate,'saveDailyPriceHistory'),
  extract(baseCandidate,'saveDailyPriceHistory'),'live Writer and price handling must remain unchanged');

function simulate({rows=['2026-10-29','2026-10-30','2026-11-02','2026-11-03','2026-11-05'],
 existingQueue=[],alreadyChecked=false,noHoldings=false,unknownNov4=false}={}){
 let scans=0,reading=0,queueWrites=0,spreadsheetWrites=0;
 const date='2026-11-05';
 const state=new Map([
  ['portfolio_close_pending_krx_dates',JSON.stringify(existingQueue)],
  ...(alreadyChecked?[['portfolio_recent_gap_scan_date_v1',date]]:[])
 ]);
 const props={
  getProperty:key=>state.get(key)??null,
  setProperty:(key,value)=>{
   state.set(key,String(value));
   if(key==='portfolio_close_pending_krx_dates')queueWrites++;
  },
  deleteProperty:key=>state.delete(key)
 };
 const sheet={
  getLastRow:()=>rows.length+1,
  getRange:(row,col,height,width)=>{
   scans++;reading+=height;
   assert.equal(col,1);assert.equal(width,1);
   return {getValues:()=>rows.slice(row-2,row-2+height).map(v=>[v]),
    setValues:()=>{spreadsheetWrites++;throw Error('NO_FINANCE_WRITES');}};
  }
 };
 const ss={getSheetByName:()=>sheet};
 const ctx=vm.createContext({
  Date,JSON,Number,String,
  CONFIG:{SHEET_SNAPSHOT:'스냅샷'},
  PORTFOLIO_CLOSE_PENDING_KRX_DATES_KEY:'portfolio_close_pending_krx_dates',
  _normalizeDate:value=>String(value||''),
  _fundDateOffset:(date,days)=>{
   const d=new Date(date+'T00:00:00Z');
   d.setUTCDate(d.getUTCDate()+days);
   return d.toISOString().slice(0,10);
  },
  _krxCalendarStatus_:date=>{
   if(unknownNov4&&date==='2026-11-04')return 'UNKNOWN';
   return [0,6].includes(new Date(date+'T00:00:00Z').getUTCDay())?'CLOSED':'OPEN';
  },
  _hasKrxHoldingsForCloseDate_:()=>!noHoldings,
  getCodeItems:()=>[{code:'005930',market:'KOSPI',currency:'KRW'}]
 });
 for(const name of ['_readPendingKrxCloseDates_','_enqueuePendingKrxCloseDate_',
   '_seedRecentMissingKrxSnapshotDays_'])
   vm.runInContext(extract(candidate,name),ctx);
 const first=ctx._seedRecentMissingKrxSnapshotDays_(ss,props,date);
 const second=ctx._seedRecentMissingKrxSnapshotDays_(ss,props,date);
 return {first:JSON.parse(JSON.stringify(first)),second:JSON.parse(JSON.stringify(second)),
  queue:JSON.parse(props.getProperty('portfolio_close_pending_krx_dates')||'[]'),
  scans,reading,queueWrites,spreadsheetWrites,marker:props.getProperty('portfolio_recent_gap_scan_date_v1')};
}
const missed=simulate();
assert.deepEqual(missed.queue,['2026-11-04']);
assert.equal(missed.first.queuedCount,1);
assert.equal(missed.queueWrites,1);
assert.equal(missed.spreadsheetWrites,0);
assert.equal(missed.second.reason,'PENDING_EXISTS');
assert.equal(missed.scans,2,'tail+full date-column scan for gap');
const valid=simulate({rows:['2026-10-29','2026-10-30','2026-11-02','2026-11-03','2026-11-04','2026-11-05']});
assert.deepEqual(valid.queue,[]);
assert.equal(valid.scans,1,'no expensive full reread when recent dates all present');
assert.equal(valid.marker,'2026-11-05');
const existing=simulate({existingQueue:['2026-11-04']});
assert.deepEqual(existing.queue,['2026-11-04']);
assert.equal(existing.scans,0,'existing backlog must have no extra scan');
const scanned=simulate({alreadyChecked:true});
assert.deepEqual(scanned.queue,[]);
assert.equal(scanned.scans,0,'already scanned today');
const held=simulate({noHoldings:true});
assert.deepEqual(held.queue,[]);
const unknown=simulate({unknownNov4:true});
assert.deepEqual(unknown.queue,[]);
const nonChronological=simulate({rows:[
 '2026-11-04','2026-10-29','2026-10-30','2026-11-02','2026-11-03',
 ...Array.from({length:1002},()=> '2026-11-05')
]});
assert.deepEqual(nonChronological.queue,[]);
assert.equal(nonChronological.scans,2,
 'missing tail date must be checked against the full column before enqueuing');
console.log('GAS9283_RECENT_GAP_SELFHEAL_PASS '+JSON.stringify({
 productionWrites:0,previewOnly:true,
 recoveredMissingDate:missed.queue[0],repeatedQueueWrites:missed.queueWrites-1,
 fastPathReads:valid.scans,anomalousTailReads:nonChronological.scans,
 candidateBlob:manifest.candidateBlob
}));
