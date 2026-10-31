import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
const source=process.argv.includes('--baseline')
  ? execFileSync('git',['show','origin/main:src/gas/apps_script.gs'],{encoding:'utf8'})
  : isolateGasBusinessLogic(fs.readFileSync('src/gas/apps_script.gs','utf8'));
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
ctx._recordTradeLedgerFingerprint_=()=> 'fixture-ledger-sha256';
let ledgerJournal=false;
ctx._tradeLedgerWriteUnverified_=()=>ledgerJournal;
ctx._markTradeLedgerWriteUnverified_=()=>{ledgerJournal=true;};
ctx._clearTradeLedgerWriteJournal_=()=>{ledgerJournal=false;};
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
  assert.equal(result.saveState,'partial');
  assert.equal(ledgerJournal,true,'verified writer failure must keep the incomplete ledger journal');
  ledgerJournal=false; // simulate human restoration from immutable backup for the next fixture
  assert.equal(backupStatus,'WRITE_FAILED','failed backup remains protected');
  assert.equal(cleanup,0);
  assert.equal(rebuilds,0,'readback failure cannot launch Snapshot recalculation');
  assert.equal(locked,false);
}
const values=[['2026-10-07','005930',100]];
const genericSheet={getRange:()=>({getValues:()=>[[new Date('2026-10-07T00:00:00Z'),'005930',100]]})};
assert.throws(()=>ctx._verifyWrittenRange(genericSheet,2,1,values),/검증 실패/,
  'shared strict verifier for other data is unchanged');
// P1 regression: execute the real web trade writer. Simulate an interruption
// at the costly Snapshot stage and ensure the durable pending marker was
// already written *before* the trade sheet was touched. Success clears last.
{
  let events=[];
  mutation=null;
  sheet.clearContents=()=>{events.push('LEDGER_WRITE');stored=[];};
  ctx._earliestChangedTradeDate=()=> '2021-05-11';
  ctx._latestConfirmedSnapshotDate=()=> '2021-05-11';
  ctx._setPendingTradeSnapshotRebuild=date=>{events.push('PENDING:'+date);return {from:date};};
  ctx._clearPendingTradeSnapshotRebuild=()=>{events.push('CLEAR');};
  ctx._recordTradeLedgerFingerprint_=()=>{events.push('FINGERPRINT');return 'safe-sha';};
  ctx.rebuildDailySnapshots=()=>{events.push('REBUILD');throw Error('SIMULATED_GAS_TIMEOUT');};
  const interrupted=run();
  assert.equal(interrupted.saveState,'partial');
  assert.ok(events.indexOf('PENDING:2021-05-11') < events.indexOf('LEDGER_WRITE'),
    'pending must be durable before any source mutation');
  assert.ok(!events.includes('CLEAR'),'partial result must not clear pending');
  assert.ok(!events.includes('FINGERPRINT'),'partial result must not advance source fingerprint');
  events=[];
  ctx.rebuildDailySnapshots=()=>{events.push('REBUILD');return {errors:[],skipped:0};};
  const completed=run();
  assert.equal(completed.saveState,'success');
  const idx=x=>events.indexOf(x);
  assert.ok(idx('PENDING:2021-05-11') < idx('LEDGER_WRITE')
    && idx('LEDGER_WRITE') < idx('REBUILD')
    && idx('REBUILD') < idx('FINGERPRINT')
    && idx('FINGERPRINT') < idx('CLEAR'),
    'successful replay must commit fingerprint and clear pending after Snapshot rebuild');
  assert.equal(locked,false,'lock released after interruption and success');
  assert.equal(ledgerJournal,false,'completed source write clears the unverified journal');
  // Simulate a GAS termination inside the trade-sheet write itself, before
  // readback validation. A pending timestamp alone is not sufficient.
  events=[];
  sheet.clearContents=()=>{events.push('LEDGER_WRITE');throw Error('SIMULATED_INCOMPLETE_LEDGER_WRITE');};
  const unfinished=run();
  assert.equal(unfinished.saveState,'partial');
  assert.equal(ledgerJournal,true,'source write journal survives an incomplete write');
  const retry=run();
  assert.equal(retry.errorCode,'TRADE_LEDGER_WRITE_UNVERIFIED');
  assert.equal(events.filter(x=>x==='LEDGER_WRITE').length,1,
    'unverified ledger rejects retry before touching the source or Snapshot');
  ledgerJournal=false; // explicit verified recovery from the retained trade backup
  sheet.clearContents=()=>{stored=[];};
  assert.equal(run().saveState,'success','verified ledger restore allows retry');
  assert.equal(ledgerJournal,false);

}

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
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})},
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
    _writeCodeSyncEditablesOnly_:(ss,previous,desired)=>{
      writeAttempts++;
      assert.ok(Array.isArray(previous),'Settings CAS expects array');
      if(settingsFails)throw new Error('INJECTED_SETTINGS_CELL_WRITE_FAILED');
      currentSettings.EDITABLE_PRICES=desired.map(item=>({...item}));
      return true;
    },
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
  currentSettings.EDITABLE_PRICES.push({name:'B',code:'999',targetWeight:99});
  const ambiguous=gas.handleSyncCodes(JSON.stringify(incoming),'sheet-1',
    JSON.stringify(current),'[]','1',JSON.stringify(sourceChanges));
  assert.equal(ambiguous.errorCode,'CODE_REBASE_SETTINGS_AMBIGUOUS',
    'same-name competing Settings metadata must never be silently inherited');
  assert.equal(writeAttempts,1,'ambiguous identity must block write');
  currentSettings.EDITABLE_PRICES.pop();
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
  assert.equal(repeat.status,'ok',`verified recovery must be idempotent: ${JSON.stringify(repeat)}`);
  assert.equal(currentSettings.EDITABLE_PRICES[0].targetWeight,37);
  // One failed write, one successful repair and one idempotent retry.
  assert.equal(writeAttempts,3,'repair and idempotent retry persist Settings without changing code rows');
  assert.equal(lockHeld,false);

  // Normal (non-recovery) A/1 -> B/2 must never delete A's custom metadata
  // when a stale/competing target B entry already exists in Settings.
  row.splice(0,6,'1','A','주식','기타','','KR');
  currentSettings={EDITABLE_PRICES:[
    {name:'A',code:'1',assetType:'주식',targetWeight:37,notes:'원본 사용자 메타데이터'},
    {name:'B',code:'2',assetType:'주식',targetWeight:99,notes:'경쟁 대상'}]};
  const beforeFlush=flushCount,beforeWrites=writeAttempts;
  const fullReplacement=JSON.stringify(sourceChanges);
  const conflicting=gas.handleSyncCodes(JSON.stringify(incoming),'sheet-1',
    JSON.stringify(original),fullReplacement);
  assert.equal(conflicting.errorCode,'CODE_SYNC_REPLACEMENT_SETTINGS_CONFLICT');
  assert.equal(row[0],'1','regular replacement conflict must abort before code row mutation');
  assert.equal(row[1],'A');
  assert.equal(flushCount,beforeFlush,'conflict must abort before flush');
  assert.equal(writeAttempts,beforeWrites,'conflict must not write Settings');
  assert.equal(currentSettings.EDITABLE_PRICES[0].targetWeight,37);
  currentSettings.EDITABLE_PRICES.pop();
  const safeRegular=gas.handleSyncCodes(JSON.stringify(incoming),'sheet-1',
    JSON.stringify(original),fullReplacement);
  assert.equal(safeRegular.status,'ok','non-conflicting normal replacement remains live');
  assert.equal(row[0],'2');
  assert.equal(row[1],'B');
  assert.equal(currentSettings.EDITABLE_PRICES.length,1);
  assert.equal(currentSettings.EDITABLE_PRICES[0].targetWeight,37,
    'normal full-pair replacement preserves A/1 metadata into B/2');
  assert.equal(lockHeld,false);
  console.log('✅ GAS 부분 커밋 Settings 복구 및 일반 교체 원본 메타데이터·충돌 차단 통과');
}


// Production GAS delete handler must NEVER remove custom Settings before a
// deleteRow failure, and must compensate code row + Settings on write errors.
{
  const gas=vm.createContext({console,Date,JSON,Number,String,Math,isFinite,isNaN});
  vm.runInContext(source,gas);
  let row=['1','A','주식','기타','','KR'];
  const unrelatedSettings={
    LOAN:{balance:357000000,rate:4.4},
    REAL_ESTATE:[{address:'원본 부동산',value:123}],
    DIVDATA:{'기존배당':{annual:42}},
    fundDirect:{'코드없는펀드':{type:'펀드',targetWeight:9}},
    APP_THEME:'dark'
  };
  const unrelatedSnapshot=JSON.stringify(unrelatedSettings);
  const assertUnrelated=()=>{
    for(const [key,value] of Object.entries(unrelatedSettings))
      assert.deepEqual(settings[key],value,'deletion must not modify Settings key '+key);
    assert.equal(JSON.stringify(Object.fromEntries(
      Object.keys(unrelatedSettings).map(key=>[key,settings[key]]))),unrelatedSnapshot);
  };
  let settings={EDITABLE_PRICES:[{name:'A',code:'1',assetType:'주식',targetWeight:37,notes:'영구 보존'}],
    ...structuredClone(unrelatedSettings)};
  let failDelete=false,failSettings=false,settingsWrites=0,locked=false,inserted=0,removed=0;
  let crashAfterCodeFlush=false,revision=0;
  const properties={};
  const propService={
    getProperty:key=>properties[key]||null,
    setProperty:(key,val)=>{properties[key]=String(val)},
    deleteProperty:key=>{delete properties[key]}
  };
  const marker=()=>properties.PF_PENDING_CODE_DELETE_TXN_V1;
  const sheet={
    getLastRow:()=>row?2:1,getLastColumn:()=>6,
    getRange:(r,c,n,m)=>({
      getValues:()=>[row?row.slice(c-1,c-1+(m||1)):[]],
      setValues:vals=>{if(!row)row=['','','','','',''];for(let i=0;i<vals[0].length;i++)row[c-1+i]=vals[0][i];}
    }),
    deleteRow:idx=>{assert.equal(idx,2);if(failDelete)throw new Error('quota: deleteRow');removed++;row=null;},
    insertRowBefore:idx=>{assert.equal(idx,2);inserted++;row=['','','','','',''];}
  };

  // Exact Settings sheet cell emulator: deletion must NEVER invoke the
  // destructive all-key _writeSettingsMap/clearContent pipeline.
  let globalSettingsWriterCalls=0;
  const settingsSheet={
    getLastRow:()=>Object.keys(settings).length+1,
    getRange:(r,c,n,m)=>({
      getValues:()=>c===1 ? Object.keys(settings).map(k=>[k]) : [],
      getValue:()=>JSON.stringify(settings[Object.keys(settings)[r-2]]),
      setValue:v=>{
        settingsWrites++;
        if(failSettings){failSettings=false;throw new Error('Settings single-cell failure');}
        const key=Object.keys(settings)[r-2];
        settings[key]=JSON.parse(v);
      },
      clearContent:()=>{throw Error('Settings bulk clear is forbidden');}
    })
  };
  const ss={getSheetByName:n=>n==='codes'?sheet:n==='settings'?settingsSheet:null};
  Object.assign(gas,{
    CONFIG:{SHEET_CODES:'codes',SHEET_SETTINGS:'settings'},getss:()=>ss,
    LockService:{getScriptLock:()=>({
      waitLock:()=>{assert.equal(locked,false);locked=true;},
      releaseLock:()=>{assert.equal(locked,true);locked=false;}
    })},
    SpreadsheetApp:{flush:()=>{if(crashAfterCodeFlush && !row){
      crashAfterCodeFlush=false;throw new Error('simulated hard stop after flushed delete');
    }}},
    PropertiesService:{getScriptProperties:()=>propService},
    _getApiKeyStatus:()=>({}),_removeSecretsFromSettings:()=>{},
    _cleanCode:c=>String(c||'').trim(),
    _portfolioCodeMasterSourceIdentity_:()=> 'sheet-1',
    _portfolioNormalizeCodeMasterSnapshot_:items=>JSON.stringify(items.map(x=>[
      x.code,x.name,x.type,x.sector,x.currency,x.market])),
    getCodeItems:()=>row?[{code:row[0],name:row[1],type:row[2],sector:row[3],
      currency:row[4]||'KRW',market:row[5]}]:[],
    handleGetTrades:()=>({getContent:()=>JSON.stringify({status:'ok',trades:[]})}),
    handleGetHoldings:()=>({getContent:()=>JSON.stringify({status:'ok',holdings:[]})}),
    _readSettingsMap:()=>JSON.parse(JSON.stringify(settings)),
    _writeSettingsMap:()=>{globalSettingsWriterCalls++;throw Error('destructive global Settings rewrite forbidden');},
    _touchSnapshotIntegritySourceRevision:()=>{revision++;},
    jsonError:(message,props)=>({status:'error',message,...props}),
    jsonOk:props=>({status:'ok',...props}),
  });
  const expected=[{code:'1',name:'A',type:'주식',sector:'기타',currency:'KRW',market:'KR'}];
  const del=()=>gas.handleDeleteUnreferencedCode(JSON.stringify({
    name:'A',code:'1',expectedSourceId:'sheet-1',expectedCodes:expected
  }));
  failDelete=true;
  const failedDeletion=del();
  assert.equal(failedDeletion.errorCode,'CODE_DELETE_FAILED');
  assert.equal(settingsWrites,0,'deleteRow error must precede ANY Settings mutation');
  assert.equal(settings.EDITABLE_PRICES[0].targetWeight,37);
  assert.equal(row[0],'1');
  assert.equal(locked,false);
  assert.ok(marker(),'failed delete retains a durable recovery marker');
  const rollbackBootstrap=gas.handleGetBootstrap();
  assert.equal(rollbackBootstrap.status,'ok','boot resolves interrupted pre-commit deletion');
  assert.equal(marker(),undefined);
  assert.equal(rollbackBootstrap.settings.EDITABLE_PRICES[0].targetWeight,37);
  failDelete=false;
  failSettings=true;
  const compensated=del();
  assert.equal(compensated.errorCode,'CODE_DELETE_SETTINGS_FAILED');
  assert.equal(settings.EDITABLE_PRICES.length,1);
  assert.equal(settings.EDITABLE_PRICES[0].targetWeight,37);
  assert.equal(settings.EDITABLE_PRICES[0].notes,'영구 보존');
  assert.equal(row[0],'1','failed Settings write restores original code row');
  assert.equal(row[1],'A');
  assert.equal(removed,1);
  assert.equal(inserted,1);
  assert.equal(revision,0,'failed deletion must not advance source revision');
  assert.equal(locked,false);
  const deleted=del();
  assert.equal(deleted.status,'ok');
  assert.equal(row,null);
  assert.equal(settings.EDITABLE_PRICES.length,0);
  assert.equal(revision,1);
  assert.equal(locked,false);
  assert.equal(marker(),undefined,'successful delete clears durable marker');
  assertUnrelated();
  assert.equal(globalSettingsWriterCalls,0,'no delete or recovery can bulk-rewrite Settings');

  // The GAS runtime can be forcibly terminated after deleteRow + flush:
  // catch/finally are not guaranteed in production. Restart must complete
  // deletion from persisted provenance before exposing stale Settings A.
  row=['1','A','주식','기타','','KR'];
  settings={EDITABLE_PRICES:[{name:'A',code:'1',assetType:'주식',
    targetWeight:37,notes:'중단 직전 사용자 설정'}],...structuredClone(unrelatedSettings)};
  crashAfterCodeFlush=true;
  const crashed=del();
  assert.equal(crashed.status,'error');
  assert.equal(row,null,'code sheet commit precedes Settings write');
  assert.equal(settings.EDITABLE_PRICES[0].targetWeight,37,'old Settings still present');
  assert.ok(marker(),'transaction persists across forced termination');
  assert.equal(locked,false);
  // If continuation also fails, do not expose stale bootstrap.
  failSettings=true;
  const blocked=gas.handleGetBootstrap();
  assert.equal(blocked.status,'error');
  assert.ok(marker(),'failed server-side continuation must remain retryable');
  assert.equal(settings.EDITABLE_PRICES[0].targetWeight,37);
  const recovered=gas.handleGetBootstrap();
  assert.equal(recovered.status,'ok','next clean boot settles the deletion');
  assert.equal(recovered.codes.length,0);
  assert.equal(recovered.settings.EDITABLE_PRICES.length,0,
    'deleted code cannot be resurrected from old Settings after reload');
  assert.equal(marker(),undefined,'verified recovery retires durable marker');
  assertUnrelated();
  assert.equal(locked,false);

  // A hard stop immediately AFTER the marker is saved but BEFORE deletion
  // must roll back, retaining original custom Settings.
  row=['1','A','주식','기타','','KR'];
  settings={EDITABLE_PRICES:[{name:'A',code:'1',assetType:'주식',targetWeight:59}],
    ...structuredClone(unrelatedSettings)};
  failDelete=true;
  assert.equal(del().status,'error');
  assert.ok(marker());
  // Simulate an interrupted Settings rewrite that retained A identity but
  // dropped targetWeight. Recovery must restore the ENTIRE original record.
  settings.EDITABLE_PRICES=[{name:'A',code:'1',assetType:'주식'}];
  const uncommitted=gas.handleGetBootstrap();
  assert.equal(uncommitted.status,'ok');
  assert.equal(uncommitted.codes[0].code,'1');
  assert.equal(uncommitted.settings.EDITABLE_PRICES[0].targetWeight,59);
  assertUnrelated();
  assert.equal(marker(),undefined);
  assert.equal(globalSettingsWriterCalls,0,'recovery may never clear unrelated Settings keys');
  assert.equal(locked,false);
  console.log('✅ GAS 삭제 생산 VM: 정상/행 실패/Settings 실패/강제 종료 후 영속 부채 복구·원본 보존 통과');
}
