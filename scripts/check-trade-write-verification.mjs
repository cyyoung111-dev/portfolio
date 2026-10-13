import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
const source=process.argv.includes('--baseline')
  ? execFileSync('git',['show','origin/main:src/gas/apps_script.gs'],{encoding:'utf8'})
  : fs.readFileSync('src/gas/apps_script.gs','utf8');
const ctx=vm.createContext({console,Date,JSON,Number,String,Math,isFinite,isNaN});
vm.runInContext(source,ctx);
ctx.Utilities={formatDate:(date,timezone)=>{
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const value=type=>parts.find(p=>p.type===type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}};
ctx.CONFIG={TIMEZONE:'Asia/Seoul',SHEET_TRADES:'거래이력'};
ctx.SpreadsheetApp={flush:()=>{}};
ctx.Logger={log:()=>{}};
let locked=false,backupStatus='',rebuilds=0,cleanup=0,stored=[],mutation=null;
const lock={waitLock:()=>{assert.equal(locked,false);locked=true;},releaseLock:()=>{locked=false;}};
ctx.LockService={getScriptLock:()=>lock};
const ss={getSpreadsheetTimeZone:()=> 'America/Los_Angeles',getSheetByName:()=>sheet};
const sheet={getParent:()=>ss,getLastRow:()=>2,getLastColumn:()=>11,getMaxRows:()=>100,
  clearContents:()=>{stored=[];},getRange:(row,column,n,m)=>{
    const range={setNumberFormat:()=>range,setBackground:()=>range,setFontColor:()=>range,setFontWeight:()=>range,
      setValues:values=>{if(row===2)stored=values.map(r=>[...r]);return range;},
      getValues:()=>{
        const rows=stored.length?stored.map(r=>[...r]):[['2021-05-11','buy','계좌','테스트','005930',1,100,'주식','','','']];
        if(stored.length){rows[0][0]=new Date('2021-05-11T07:00:00Z');if(mutation)mutation(rows);}
        return rows;
      }};
    return range;
  }};
ctx.getss=()=>ss;
// The real trade writer now validates every coded trade against the locked
// server master before touching the ledger. Mock that authoritative source.
ctx.getCodeItems=()=>[{code:'005930',name:'테스트',type:'주식'}];
ctx._backupSheetBeforeWrite=()=>({name:'fixture-backup'});
ctx._markSnapshotBackupStatus=(record,status)=>{backupStatus=status;};
ctx._cleanupCurrentSystemBackup=()=>{cleanup++;return {};};
ctx._readPendingTradeSnapshotRebuild=()=>null;
ctx._clearPendingTradeSnapshotRebuild=()=>{};
ctx._earliestChangedTradeDate=()=>'';
ctx._latestChangedTradeDate=()=>'';
ctx._touchSnapshotIntegritySourceRevision=()=>{};
ctx._rebuildSnapshotsForTradeChanges=()=>{rebuilds++;return {failed:0};};
ctx.jsonOk=value=>({status:'ok',...value});
ctx.jsonError=(message,value)=>({status:'error',message,...value});
const trade={date:'2021-05-11',tradeType:'buy',acct:'계좌',name:'테스트',code:'005930',qty:1,price:100};
const run=()=>ctx.handleSyncTrades(JSON.stringify([trade]),'',false);
assert.equal(run().status,'ok','normal DATE readback must not falsely fail trade persistence');
assert.equal(backupStatus,'COMPLETED');
assert.equal(cleanup,1);
assert.equal(locked,false);
assert.equal(stored[0][4],'005930','code leading zeros retained');
for(const [column,value] of [[0,new Date('2021-05-12T07:00:00Z')],[4,'5930'],[5,2],[6,'100'],[8,'altered memo']]) {
  mutation=rows=>{rows[0][column]=value;};
  cleanup=0;rebuilds=0;
  const result=run();
  assert.equal(result.status,'error',`corrupt column ${column+1} must fail closed`);
  assert.equal(result.saveState,'failed');
  assert.equal(backupStatus,'WRITE_FAILED','failed backup remains protected');
  assert.equal(cleanup,0);
  assert.equal(rebuilds,0,'readback failure cannot launch Snapshot recalculation');
  assert.equal(locked,false);
}
const values=[['2026-10-07','005930',100]];
const genericSheet={getRange:()=>({getValues:()=>[[new Date('2026-10-07T00:00:00Z'),'005930',100]]})};
assert.throws(()=>ctx._verifyWrittenRange(genericSheet,2,1,values),/검증 실패/,
  'shared strict verifier for other data is unchanged');
console.log('✅ 거래 DATE readback·시트 시간대·잘못된 날짜/코드/수량 차단·백업/잠금 보호 통과');
