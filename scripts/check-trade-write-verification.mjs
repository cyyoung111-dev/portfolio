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


// Actual GAS handler regression: a successful code row flush followed by a
// failed Settings save must remain recoverable through same-master CAS.
{
  const gas=vm.createContext({console,Date,JSON,Number,String,Math,isFinite,isNaN});
  vm.runInContext(source,gas);
  const row=['1','A','주식','기타','','KR'];
  let currentSettings={EDITABLE_PRICES:[{name:'A',code:'1',assetType:'주식',targetWeight:37,notes:'보존할 사용자 지정값'}]};
  let settingsFails=true,writeAttempts=0,lockHeld=false,flushCount=0;
  const codeSheet={
    getLastRow:()=>2,getLastColumn:()=>6,
    getRange:(r,c,n,m)=>({
      getValues:()=>[row.slice(c-1,c-1+(m||1))],
      setValues:values=>{for(let j=0;j<values.length;j++)row[c-1+j]=values[j][0];},
    })
  };
  const workbook={getSheetByName:()=>codeSheet};
  Object.assign(gas,{
    CONFIG:{SHEET_CODES:'codes'},
    getss:()=>workbook,
    LockService:{getScriptLock:()=>({
      waitLock:()=>{assert.equal(lockHeld,false);lockHeld=true;},
      releaseLock:()=>{lockHeld=false;}
    })},
    SpreadsheetApp:{flush:()=>{flushCount++;}},
    _portfolioCodeMasterSourceIdentity_:()=> 'sheet-1',
    getCodeItems:()=>[{code:row[0],name:row[1],type:row[2],sector:row[3],currency:row[4]||'KRW',market:row[5]}],
    _portfolioNormalizeCodeMasterSnapshot_:items=>JSON.stringify(items.map(x=>[
      String(x.code),String(x.name),String(x.type||'주식'),String(x.sector||'기타'),
      String(x.currency||'KRW'),String(x.market||'KR')
    ])),
    _parseArrayParam:p=>JSON.parse(p),
    _cleanCode:c=>String(c||'').trim(),
    _setCodeColumnText:()=>{},
    _touchSnapshotIntegritySourceRevision:()=>{},
    _readSettingsMap:()=>JSON.parse(JSON.stringify(currentSettings)),
    _writeSettingsMap:m=>{writeAttempts++;if(settingsFails)return false;currentSettings=m;return true;},
    _repairKnownCodeColumns:()=>[],
    jsonError:(message,props)=>({status:'error',message,...props}),
    jsonOk:props=>({status:'ok',...props}),
  });
  const incoming={B:{code:'2',type:'주식',sector:'기타',currency:'KRW',market:'KR'}};
  const original=[{code:'1',name:'A',type:'주식',sector:'기타',currency:'KRW',market:'KR'}];
  const first=gas.handleSyncCodes(JSON.stringify(incoming),'sheet-1',JSON.stringify(original),
    JSON.stringify([{previousName:'A',previousCode:'1',name:'B',code:'2'}]));
  assert.equal(first.status,'error');
  assert.equal(first.errorCode,'CODE_SYNC_SETTINGS_FAILED');
  assert.equal(row[0],'2');
  assert.equal(row[1],'B');
  assert.equal(currentSettings.EDITABLE_PRICES[0].name,'A');
  assert.ok(flushCount>0,'code master actually committed before Settings failure');
  assert.equal(lockHeld,false);
  settingsFails=false;
  const current=gas.getCodeItems();
  const sourceChanges=[{previousName:'A',previousCode:'1',name:'B',code:'2'}];
  const unverifiable=gas.handleSyncCodes(JSON.stringify(incoming),'sheet-1',
    JSON.stringify(current),'[]','1',JSON.stringify([
      {previousName:'다른종목',previousCode:'999',name:'B',code:'2'}]));
  assert.equal(unverifiable.errorCode,'CODE_REBASE_SETTINGS_AMBIGUOUS',
    'unproven metadata source must never destroy saved settings');
  assert.equal(currentSettings.EDITABLE_PRICES[0].targetWeight,37);
  assert.equal(writeAttempts,1,'invalid provenance must stop before Settings write');
  const staleMetadata={B:{code:'2',type:'주식',sector:'이전 값',currency:'KRW',market:'KR'}};
  const staleAttempt=gas.handleSyncCodes(JSON.stringify(staleMetadata),'sheet-1',
    JSON.stringify(current),'[]','1',JSON.stringify(sourceChanges));
  assert.equal(staleAttempt.errorCode,'CODE_REBASE_NOT_READONLY',
    'rebase must never modify actual code master metadata');
  assert.equal(row[3],'기타');
  assert.equal(writeAttempts,1,'stale metadata must fail before Settings write');
  const repaired=gas.handleSyncCodes(JSON.stringify(incoming),'sheet-1',
    JSON.stringify(current),'[]','1',JSON.stringify(sourceChanges));
  assert.equal(repaired.status,'ok');
  assert.equal(row[0],'2');
  assert.equal(row[1],'B');
  assert.equal(currentSettings.EDITABLE_PRICES.length,1);
  assert.equal(currentSettings.EDITABLE_PRICES[0].name,'B');
  assert.equal(currentSettings.EDITABLE_PRICES[0].code,'2');
  assert.equal(currentSettings.EDITABLE_PRICES[0].targetWeight,37,
    'Settings repair preserves full-pair original custom allocation');
  assert.equal(currentSettings.EDITABLE_PRICES[0].notes,'보존할 사용자 지정값');
  const repeat=gas.handleSyncCodes(JSON.stringify(incoming),'sheet-1',
    JSON.stringify(current),'[]','1',JSON.stringify(sourceChanges));
  assert.equal(repeat.status,'ok','verified recovery must be idempotent');
  assert.equal(currentSettings.EDITABLE_PRICES[0].targetWeight,37);
  // One failed write, one successful repair and one idempotent retry.
  assert.equal(writeAttempts,3,'repair and idempotent retry persist Settings without changing code rows');
  assert.equal(lockHeld,false);
  console.log('✅ GAS 코드 부분 커밋→Settings 실패→동일 워크북 CAS 복구 통과');
}
