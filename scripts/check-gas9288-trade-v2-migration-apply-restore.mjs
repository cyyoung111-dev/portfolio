#!/usr/bin/env node
// Execute REAL GAS migration/apply/restore routines against 338 in-memory rows.
// Never calls Google Sheets/GAS or mutates actual financial source records.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {composeGas9288TradeV2From9287Preview}
  from './compose-gas9288-trade-v2-from-9287-preview.mjs';

const {candidate,manifest}=composeGas9288TradeV2From9287Preview();
assert.equal(manifest.candidateVersion,'9.288');
assert.equal(manifest.approvedForGasDeploy,false);
assert.equal(manifest.migrationApplyRequiresApproval,true);
const fn=name=>{
 const at=candidate.indexOf('function '+name+'(');
 const end=candidate.indexOf('\n}',at);
 assert(at>=0&&end>at,name+' missing from real 9.288 candidate');
 return candidate.slice(at,end+2);
};
const actualFunctions=['_cleanCode','_portfolioTradeFxMetadata_',
 '_tradeV2CanonicalRow_','_tradeV2Revision_','_tradeV2MigrationPlan_',
 '_tradeV2MigrationManual_','runTradeV2MigrationPreflight',
 'runTradeV2MigrationApply','runTradeV2MigrationRestore'];
const sha=value=>createHash('sha256').update(typeof value==='string'
 ?value:JSON.stringify(value)).digest('hex');
const copy=x=>JSON.parse(JSON.stringify(x));
const headers=['날짜','매수/매도','계좌','종목명','종목코드',
 '수량','단가','자산유형','메모','비율','단주정산'];
const sample=Array.from({length:338},(_,i)=>[
 '2026-10-'+String(1+i%28).padStart(2,'0'),i%7===0?'매도':'매수',
 i%2===0?'ISA':'일반','TEST_'+(i%9),
 String(5930+i%9).padStart(6,'0'),i+1,12000+i,
 '주식','', '', ''
]);
const value=x=>x===undefined||x===null?'':x;
function setup(){
 const originals=[headers.slice(),...sample.map(x=>x.slice())],
       sheets=[],propsMap={SS_ID:'book-verified-338',
        issue507_writer_gate_v1:JSON.stringify({mode:'OPEN',active:{}})};
 let mutations=0,backups=0,lockBusy=false,failAfterTwo=false,flushCount=0;
 const context={};
 const ss={getId:()=> 'book-verified-338',
   getSheets:()=>sheets.slice(),
   getSheetByName:name=>sheets.find(x=>x.getName()===name)||null};
 let sheetId=1200;
 function makeSheet(name,seed){
  let data=copy(seed),id=sheetId++;
  const sheet={
   getName:()=>name,setName:newName=>{name=String(newName);return sheet;},
   getSheetId:()=>id,getParent:()=>ss,
   getMaxRows:()=>1000,getMaxColumns:()=>26,
   getLastRow:()=>{
    for(let i=data.length-1;i>=0;i--)if(data[i].some(x=>value(x)!==''))return i+1;
    return 0;
   },
   getLastColumn:()=>{
    let last=0;
    for(const row of data)for(let j=0;j<row.length;j++)
      if(value(row[j])!=='')last=Math.max(last,j+1);
    return last;
   },
   getRange:(r,c,n,w)=>{
    const range={
     getValues:()=>Array.from({length:n},(_,i)=>
      Array.from({length:w},(_,j)=>value(data[r-1+i]?.[c-1+j]))),
     getFormulas:()=>Array.from({length:n},()=>Array.from({length:w},()=>'')),
     setValues:rows=>{
      assert.equal(rows.length,n);assert(rows.every(x=>x.length===w));
      mutations++;
      for(let i=0;i<rows.length;i++){
       if(!data[r-1+i])data[r-1+i]=[];
       for(let j=0;j<w;j++)data[r-1+i][c-1+j]=rows[i][j];
       if(failAfterTwo&&r===2&&c===12&&i===1){
        failAfterTwo=false;throw Error('INJECTED_GAS_TIMEOUT_AFTER_TWO_IDS');
       }
      }
      return range;
     },
     clearContent:()=>{
      mutations++;
      for(let i=0;i<n;i++)for(let j=0;j<w;j++){
       if(!data[r-1+i])data[r-1+i]=[];
       data[r-1+i][c-1+j]='';
      }
      return range;
     }
    };return range;
   },
   copyTo:()=>{
    backups++;
    const b=makeSheet('Copy of '+name,data);
    return b;
   },
   _dump:()=>copy(data),
   _put:(r,c,v)=>{if(!data[r-1])data[r-1]=[];data[r-1][c-1]=v;}
  };
  sheets.push(sheet);return sheet;
 }
 const original=makeSheet('거래이력',originals);
 const props={
   getProperty:key=>propsMap[key]??null,
   setProperty:(key,val)=>{propsMap[key]=String(val);},
   deleteProperty:key=>{delete propsMap[key];}
 };
 const ctx=vm.createContext({
  JSON,Array,Date,Number,String,Object,Math,isFinite,console,
  _issue507GateInside_:true,
  CONFIG:{SHEET_TRADES:'거래이력',TIMEZONE:'Asia/Seoul'},
  ISSUE507_GATE_API_VERSION:'9.288',
  TRADE_LEDGER_FINGERPRINT_KEY:'ledger_fingerprint',
  TRADE_V2_ID_RE:/^(tr|srv)_[A-Za-z0-9_-]{6,128}$/,
  Utilities:{formatDate:()=> '2026-11-10'},
  LockService:{getScriptLock:()=>({
   tryLock:()=>!lockBusy,
   releaseLock:()=>{}
  })},
  PropertiesService:{getScriptProperties:()=>props},
  SpreadsheetApp:{flush:()=>{flushCount++;}},
  getss:()=>ss,
  _normalizeDate:raw=>String(raw||'').slice(0,10),
  _portfolioSyncDigest_:raw=>sha(raw),
  _sheetContentSignature:sh=>sha([
   sh.getRange(1,1,sh.getLastRow(),sh.getLastColumn()).getValues(),
   sh.getRange(1,1,sh.getLastRow(),sh.getLastColumn()).getFormulas()
  ]),
  _tradeLedgerContentFingerprint_:s=>sha(s.getSheetByName('거래이력')
    .getRange(2,1,338,11).getValues()),
  _tradeLedgerWriteUnverified_:()=>false,
  _readPendingTradeSnapshotRebuild:()=>null,
  _fundSheetCapacity:()=>({remainingCells:500000})
 });
 vm.runInContext(actualFunctions.map(fn).join('\n'),ctx);
 const approve=(mode,preview,operationId='mig_1234567890abcd')=>{
  props.setProperty('trade_v2_migration_approval_v1',JSON.stringify({
   approvedFor:mode,releaseVersion:'9.288',
   userApproved:true,writerIsolationConfirmed:true,
   approvedDate:'2026-11-10',operationId,
   spreadsheetId:preview.spreadsheetId,sheetId:preview.sheetId,
   expectedRows:preview.sourceRows,expectedSourceDigest:preview.sourceDigest,
   expectedSourceSignature:preview.sourceSignature,
   expectedTargetRevision:preview.targetRevision
  }));
 };
 return {ctx,ss,original,originals,props,propsMap,approve,
  get counts(){return {mutations,backups,flushCount};},
  fault:()=>{failAfterTwo=true},
  lock:(v)=>{lockBusy=v}
 };
}
let scenarios=0;
const run=(label,fn)=>{fn();scenarios++;console.log('PASS '+label);};
const env=setup();
const pre=env.ctx.runTradeV2MigrationPreflight();
run('338 row initial preflight',()=>{
 assert.equal(pre.status,'ok');assert.equal(pre.sourceRows,338);
 assert.equal(pre.schemaWidth,11);assert.equal(pre.assignedIds,338);
 assert.equal(pre.journalStatus,'NONE');
 assert.equal(env.counts.mutations,0);assert.equal(env.counts.backups,0);
});
run('explicit approval fails closed',()=>{
 const denial=env.ctx.runTradeV2MigrationApply();
 assert.equal(denial.status,'error');
 assert.equal(denial.errorCode,'TRADE_V2_MIGRATION_APPROVAL_REQUIRED');
 assert.equal(env.counts.mutations,0);
});
run('exact source, locked, approved migration and readback',()=>{
 env.approve('APPLY',pre);
 const applied=env.ctx.runTradeV2MigrationApply();
 assert.equal(applied.status,'ok',JSON.stringify(applied));
 assert.equal(applied.state,'APPLIED');assert.equal(applied.assignedIds,338);
 assert.equal(env.original.getLastColumn(),14);
 const full=env.original.getRange(2,1,338,14).getValues();
 assert.deepEqual(full.map(x=>x.slice(0,11)),sample);
 const ids=full.map(x=>x[13]);
 assert.equal(new Set(ids).size,338);
 assert(ids.every(x=>/^srv_[0-9a-f]{32}$/.test(x)));
 assert(full.every(x=>x[11]===''&&x[12]===''));
 assert.equal(env.counts.backups,1);
 const j=JSON.parse(env.props.getProperty('trade_v2_migration_journal_v1'));
 assert.equal(j.status,'APPLIED');
 assert(env.ss.getSheetByName(j.backupName));
 assert.equal(env.ss.getSheetByName(j.backupName).getLastColumn(),11);
});
run('same operation replay is a verified no-op',()=>{
 const old=env.counts;
 const replay=env.ctx.runTradeV2MigrationApply();
 assert.equal(replay.status,'ok');
 assert.equal(replay.alreadyDone,true);
 assert.equal(env.counts.mutations,old.mutations);
 assert.equal(env.counts.backups,old.backups);
});
run('separately approved restore preserves A:K and backup',()=>{
 env.approve('RESTORE',pre);
 const recovered=env.ctx.runTradeV2MigrationRestore();
 assert.equal(recovered.status,'ok',JSON.stringify(recovered));
 assert.equal(recovered.state,'RESTORED');
 assert.equal(env.original.getLastColumn(),11);
 assert.deepEqual(env.original.getRange(2,1,338,11).getValues(),sample);
 assert.equal(env.counts.backups,1);
 assert.equal(env.ctx.runTradeV2MigrationRestore().alreadyDone,true);
});
run('reapply new operation only after prior restoration',()=>{
 const p=env.ctx.runTradeV2MigrationPreflight();
 env.approve('APPLY',p,'mig_NEW_1234567890abc');
 const applied=env.ctx.runTradeV2MigrationApply();
 assert.equal(applied.status,'ok');
 assert.equal(env.counts.backups,2);
});
const failure=setup(),initial=failure.ctx.runTradeV2MigrationPreflight();
run('hard timeout after two IDs leaves durable WRITING and backup',()=>{
 failure.approve('APPLY',initial);
 failure.fault();
 const r=failure.ctx.runTradeV2MigrationApply();
 assert.equal(r.status,'error');
 assert.match(r.errorCode,/INJECTED_GAS_TIMEOUT_AFTER_TWO_IDS/);
 assert.equal(failure.original.getLastColumn(),14);
 assert.equal(JSON.parse(failure.props.getProperty('trade_v2_migration_journal_v1')).status,'WRITING');
 assert.equal(failure.counts.backups,1);
});
run('partial schema restore allowed only with independent approval',()=>{
 failure.approve('RESTORE',initial);
 const r=failure.ctx.runTradeV2MigrationRestore();
 assert.equal(r.status,'ok',JSON.stringify(r));
 assert.equal(failure.original.getLastColumn(),11);
 assert.deepEqual(failure.original.getRange(2,1,338,11).getValues(),sample);
});
const drift=setup(),beforeDrift=drift.ctx.runTradeV2MigrationPreflight();
run('A:K external edit is not silently overwritten during recovery',()=>{
 drift.approve('APPLY',beforeDrift);drift.fault();
 assert.equal(drift.ctx.runTradeV2MigrationApply().status,'error');
 drift.original._put(2,6,999);
 drift.approve('RESTORE',beforeDrift);
 const denied=drift.ctx.runTradeV2MigrationRestore();
 assert.equal(denied.errorCode,'TRADE_V2_MIGRATION_AK_DRIFT');
 assert.equal(drift.original.getRange(2,6,1,1).getValues()[0][0],999);
 drift.original._put(2,6,sample[0][5]);
 assert.equal(drift.ctx.runTradeV2MigrationRestore().status,'ok');
});
const outside=setup(),beforeOutside=outside.ctx.runTradeV2MigrationPreflight();
run('foreign ID modification prevents recovery of ambiguous L:N',()=>{
 outside.approve('APPLY',beforeOutside);outside.fault();
 assert.equal(outside.ctx.runTradeV2MigrationApply().status,'error');
 outside.original._put(2,14,'tr_external_edit1');
 outside.approve('RESTORE',beforeOutside);
 const denied=outside.ctx.runTradeV2MigrationRestore();
 assert.equal(denied.errorCode,'TRADE_V2_MIGRATION_EXTERNAL_LN_CHANGE');
 outside.original._put(2,14,'srv_'+sha(JSON.stringify([
  'trade-v2-migration',0,
  // Exact hash uses canonical row generated from candidate.
  outside.ctx._tradeV2CanonicalRow_([...sample[0],'','',''])
 ])).slice(0,32));
 // An operator would restore the unexpected L:N value based on backup
 // audit; fixture clears it to prove the staged recovery may resume.
 outside.original._put(2,14,'');
 assert.equal(outside.ctx.runTradeV2MigrationRestore().status,'ok');
});
const wrongBinding=setup();
run('preflight refuses active sheet inconsistent with configured GAS SS_ID',()=>{
 wrongBinding.props.setProperty('SS_ID','different-book');
 const denied=wrongBinding.ctx.runTradeV2MigrationPreflight();
 assert.equal(denied.errorCode,'TRADE_V2_MIGRATION_SSID_CONFIG_MISMATCH');
 assert.equal(wrongBinding.counts.backups,0);
 assert.equal(wrongBinding.counts.mutations,0);
});
const badIsolation=setup(),pIsolation=badIsolation.ctx.runTradeV2MigrationPreflight();
run('writer isolation attestation cannot be omitted',()=>{
 badIsolation.approve('APPLY',pIsolation);
 const obj=JSON.parse(badIsolation.props.getProperty('trade_v2_migration_approval_v1'));
 obj.writerIsolationConfirmed=false;
 badIsolation.props.setProperty('trade_v2_migration_approval_v1',JSON.stringify(obj));
 assert.equal(badIsolation.ctx.runTradeV2MigrationApply().errorCode,
  'TRADE_V2_MIGRATION_APPROVAL_REQUIRED');
 assert.equal(badIsolation.counts.backups,0);
});
const backupTamper=setup(),pTamper=backupTamper.ctx.runTradeV2MigrationPreflight();
run('backup corruption blocks restore and never deletes source',()=>{
 backupTamper.approve('APPLY',pTamper);backupTamper.fault();
 assert.equal(backupTamper.ctx.runTradeV2MigrationApply().status,'error');
 const j=JSON.parse(backupTamper.props.getProperty('trade_v2_migration_journal_v1'));
 const backup=backupTamper.ss.getSheetByName(j.backupName);
 backup._put(2,6,8888);
 backupTamper.approve('RESTORE',pTamper);
 assert.equal(backupTamper.ctx.runTradeV2MigrationRestore().errorCode,
  'TRADE_V2_MIGRATION_BACKUP_UNVERIFIED');
 assert.equal(backupTamper.original.getRange(2,6,1,1).getValues()[0][0],sample[0][5]);
 backup._put(2,6,sample[0][5]);
 assert.equal(backupTamper.ctx.runTradeV2MigrationRestore().status,'ok');
});
const stale=setup(),pStale=stale.ctx.runTradeV2MigrationPreflight();
run('stale source edit blocks APPLY before backup or mutation',()=>{
 stale.approve('APPLY',pStale);
 stale.original._put(2,6,999);
 const ret=stale.ctx.runTradeV2MigrationApply();
 assert.equal(ret.errorCode,'TRADE_V2_MIGRATION_SOURCE_OR_PLAN_DRIFT');
 assert.equal(stale.counts.mutations,0);
 assert.equal(stale.counts.backups,0);
});
const busy=setup(),pBusy=busy.ctx.runTradeV2MigrationPreflight();
run('concurrent ScriptLock denies mutation',()=>{
 busy.approve('APPLY',pBusy);busy.lock(true);
 assert.equal(busy.ctx.runTradeV2MigrationApply().errorCode,
  'TRADE_V2_MIGRATION_LOCK_BUSY');
 assert.equal(busy.counts.mutations,0);
});
console.log('GAS9288_TRADE_V2_MIGRATION_RECOVERY_PASS '+JSON.stringify({
 scenarios,tradeRows:338,sourceRowsPreserved:true,
 uniqueIds:338,backupNeverDeleted:true,
 timeoutRestored:true,staleWritesBlocked:true,
 realFinanceWrites:0,gasDeployments:0,telegramSends:0
}));

// Reuse the production-equivalent in-memory Sheet/ScriptLock fixture for
// #734's separately guarded DRAINING-mode cutover tests.
export {setup};
