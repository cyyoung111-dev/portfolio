// Issue #734. Operator-only, non-deployed code for a one-time stale-Gate
// recovery. This file is NOT composed into src/gas/apps_script.gs or GAS v9.288.
// Install only in the SAME Apps Script project after reviewing the runbook.
// Never falsify issue507_writer_end_v1_* receipts; preserve raw evidence.
var ISSUE734_RECOVERY_EXPECTED_TIMED_OUT_ = [
  ['runPortfolioCloseWatchdog2030',1793878621446],
  ['runPortfolioHistoricalBackfill2240',1793887899970],
  ['runDeferredFundAfterPortfolioCloseFailure',1793962991701],
  ['runPortfolioCloseWatchdog2030',1793965021119],
  ['runDeferredFundAfterPortfolioCloseFailure',1794048066387],
  ['runDeferredFundAfterPortfolioCloseFailure',1794048668004],
  ['runDeferredFundAfterPortfolioCloseFailure',1794049281583],
  ['runPortfolioCloseWatchdog2030',1794051422193],
  ['runDeferredFundAfterPortfolioCloseFailure',1794138087299],
  ['runDailyPortfolioClose1900',1794220392853],
  ['runDeferredFundAfterPortfolioCloseFailure',1794224980455],
  ['_tradeV2MigrationManual_',1794273416321],
  ['_tradeV2MigrationManual_',1794273527135],
  ['_tradeV2MigrationManual_',1794275129121]
];
function _issue734RecoverSha_(raw) {
  var digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    raw,Utilities.Charset.UTF_8);
  return digest.map(function(b){return ((b+256)%256).toString(16).padStart(2,'0');}).join('');
}
function _issue734RecoverInspect_(props) {
  if(ISSUE507_GATE_API_VERSION!=='9.288')
    throw Error('ISSUE734_RECOVERY_VERSION_MISMATCH');
  var gateKey='issue507_writer_gate_v1',raw=props.getProperty(gateKey);
  if(!raw)throw Error('ISSUE734_RECOVERY_GATE_MISSING');
  var g=_issue507GateRead_(props);
  if(!['OPEN','DRAINING'].includes(g.mode)||g.releaseId!==ISSUE507_GATE_RELEASE_ID||
     !g.active || Object.keys(g.active).length!==14)
    throw Error('ISSUE734_RECOVERY_ACTIVE_OR_RELEASE_DRIFT');
  // In maintenance mode, the pinned pause receipt is mandatory. This is
  // separate from the original per-execution producer ENDED receipt.
  var pauseKey='issue734_writer_pause_audit_v1',
      pauseRaw=props.getProperty(pauseKey);
  if(g.mode==='DRAINING'){
    var pause,oldGate=props.getProperty('issue734_writer_pause_before_v1');
    try{pause=pauseRaw?JSON.parse(pauseRaw):null;}catch(ignore){pause=null;}
    if(!pause||pause.status!=='PAUSED'||!oldGate||
       pause.originalGateDigest!==_issue734RecoverSha_(oldGate)||
       pause.pausedAt!==g.barrierAt||
       Date.now()-pause.pausedAt<420000)
      throw Error('ISSUE734_RECOVERY_PAUSE_UNVERIFIED');
  }else if(pauseRaw){
    throw Error('ISSUE734_RECOVERY_PAUSE_MODE_DRIFT');
  }
  var actual=Object.keys(g.active).map(function(token){
    var x=g.active[token];
    if(props.getProperty('issue507_writer_end_v1_'+token))
      throw Error('ISSUE734_RECOVERY_TERMINAL_RECEIPT_PRESENT');
    return x.name+'|'+x.startedAt;
  }).sort();
  var expected=ISSUE734_RECOVERY_EXPECTED_TIMED_OUT_.map(function(x){
    return x[0]+'|'+x[1];
  }).sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected))
    throw Error('ISSUE734_RECOVERY_EXECUTION_SET_DRIFT');
  if(ISSUE734_RECOVERY_EXPECTED_TIMED_OUT_.some(function(x){
    return !Number.isFinite(x[1]) || Date.now()-x[1]<420000;
  }))throw Error('ISSUE734_RECOVERY_EXECUTIONS_NOT_SETTLED');
  var backupKey='issue734_writer_gate_before_20261110_v1',
      auditKey='issue734_writer_gate_repair_audit_v1';
  if(props.getProperty(backupKey)||props.getProperty(auditKey))
    throw Error('ISSUE734_RECOVERY_ALREADY_PREPARED');
  if(_tradeLedgerWriteUnverified_()||_readPendingTradeSnapshotRebuild())
    throw Error('ISSUE734_RECOVERY_PENDING_FINANCIAL_WRITES');
  var ss=getss(),sh=ss.getSheetByName(CONFIG.SHEET_TRADES);
  if(!sh||sh.getLastRow()!==339||sh.getLastColumn()!==11)
    throw Error('ISSUE734_RECOVERY_LEDGER_SCHEMA_CHANGED');
  var journal=props.getProperty('trade_v2_migration_journal_v1');
  if(journal){
    var j;try{j=JSON.parse(journal);}catch(e){throw Error('ISSUE734_RECOVERY_JOURNAL_INVALID');}
    if(j && j.status!=='RESTORED')
      throw Error('ISSUE734_RECOVERY_MIGRATION_JOURNAL_BLOCK');
  }
  return {gateKey:gateKey,backupKey:backupKey,auditKey:auditKey,
    originalRaw:raw,gate:g,gateDigest:_issue734RecoverSha_(raw),
    priorActiveCount:actual.length};
}
// No financial writes, no property writes. Does not prove external actor isolation.
function issue734PreviewTimedOutGateRecovery() {
  var result=_issue507GateAtomic_(function(props){
    var p=_issue734RecoverInspect_(props);
    return {status:'MATCHED_BUT_NOT_AUTHORIZED',releaseVersion:'9.288',
      activeCount:p.priorActiveCount,originalGateDigest:p.gateDigest,
      requiresIndependentWriterIsolation:true,requiresOneTimeApproval:true,
      financeWrites:0,gateWrites:0};
  });
  if(typeof Logger!=='undefined')Logger.log(JSON.stringify(result));
  return result;
}
// Explicit one-time operator execution. Required approval Script Property:
// issue734_stale_gate_recovery_approval_v1 = {
//   "approvedFor":"PRUNE_EXACT_14_TIMED_OUT", "releaseVersion":"9.288",
//   "userApproved":true, "externalWritersExcluded":true,
//   "approvedDate":"YYYY-MM-DD", "expectedGateDigest":"<preview hash>"
// }
// Do not assert externalWritersExcluded without independently verifying it.
// This routine NEVER marks a missing end receipt as ENDED.
function issue734CommitTimedOutGateRecovery() {
  var result=_issue507GateAtomic_(function(props){
    var p=_issue734RecoverInspect_(props),rawApproval=
      props.getProperty('issue734_stale_gate_recovery_approval_v1');
    var a;try{a=rawApproval?JSON.parse(rawApproval):null;}
    catch(e){throw Error('ISSUE734_RECOVERY_APPROVAL_INVALID');}
    var stamp=Utilities.formatDate(new Date(),CONFIG.TIMEZONE,'yyyy-MM-dd');
    if(!a||a.approvedFor!=='PRUNE_EXACT_14_TIMED_OUT'||
       a.releaseVersion!=='9.288'||a.userApproved!==true||
       a.externalWritersExcluded!==true||a.approvedDate!==stamp||
       a.expectedGateDigest!==p.gateDigest)
      throw Error('ISSUE734_RECOVERY_APPROVAL_REQUIRED');
    // Under the existing GAS ScriptLock: no gated execution can enter
    // between exact-match inspection and the Gate property replacement.
    props.setProperty(p.backupKey,p.originalRaw);
    if(props.getProperty(p.backupKey)!==p.originalRaw)
      throw Error('ISSUE734_RECOVERY_BACKUP_READBACK_FAILED');
    var audit={operation:'PRUNE_EXACT_14_TIMED_OUT',
      status:'PREPARED',createdAt:new Date().toISOString(),
      originalGateDigest:p.gateDigest,recoveredCount:14,
      evidenceKind:'OPERATOR_EXECUTIONS_UI_TERMINAL_14',
      producerEndReceiptsRecreated:false};
    props.setProperty(p.auditKey,JSON.stringify(audit));
    if(props.getProperty(p.auditKey)!==JSON.stringify(audit))
      throw Error('ISSUE734_RECOVERY_AUDIT_READBACK_FAILED');
    var next=JSON.parse(p.originalRaw);
    next.active={}; // not "completed": no producer-owned ENDED proof exists
    var after=JSON.stringify(next);
    props.setProperty(p.gateKey,after);
    if(props.getProperty(p.gateKey)!==after)
      throw Error('ISSUE734_RECOVERY_GATE_READBACK_FAILED');
    audit.status='PRUNED';audit.completedAt=new Date().toISOString();
    props.setProperty(p.auditKey,JSON.stringify(audit));
    if(props.getProperty(p.auditKey)!==JSON.stringify(audit))
      throw Error('ISSUE734_RECOVERY_FINAL_AUDIT_READBACK_FAILED');
    return {status:'PRUNED',recoveredCount:14,
      activeCountAtReadback:Object.keys(next.active).length,
      backupRetained:true,producerEndReceiptsRecreated:false,
      migrationApplied:false,financeWrites:0};
  });
  if(typeof Logger!=='undefined')Logger.log(JSON.stringify(result));
  return result;
}


function issue734StartWriterMaintenancePause() {
  return _issue507GateAtomic_(function(props){
    // Manual owner action: precisely pinned 14 stale entries, no new writers.
    var p=_issue734RecoverInspect_(props),
        key='issue734_writer_pause_before_v1',
        auditKey='issue734_writer_pause_audit_v1';
    if(props.getProperty(key)||props.getProperty(auditKey))
      throw Error('ISSUE734_PAUSE_ALREADY_STARTED');
    var now=Date.now(),receipt={status:'PREPARED',createdAt:now,
      originalGateDigest:p.gateDigest,recoveredCount:0};
    props.setProperty(key,p.originalRaw);
    if(props.getProperty(key)!==p.originalRaw)
      throw Error('ISSUE734_PAUSE_BACKUP_READBACK_FAILED');
    props.setProperty(auditKey,JSON.stringify(receipt));
    if(props.getProperty(auditKey)!==JSON.stringify(receipt))
      throw Error('ISSUE734_PAUSE_AUDIT_READBACK_FAILED');
    var next=JSON.parse(p.originalRaw);
    next.mode='DRAINING';next.barrierAt=now;
    _issue507GateSave_(props,next);
    if(_issue507GateRead_(props).mode!=='DRAINING')
      throw Error('ISSUE734_PAUSE_GATE_READBACK_FAILED');
    receipt.status='PAUSED';receipt.pausedAt=now;
    props.setProperty(auditKey,JSON.stringify(receipt));
    if(props.getProperty(auditKey)!==JSON.stringify(receipt))
      throw Error('ISSUE734_PAUSE_FINAL_AUDIT_READBACK_FAILED');
    return {status:'DRAINING',activeBefore:14,activeAfter:14,
      noNewGatedWriters:true,originalGateBackupSaved:true,
      minBarrierMilliseconds:420000,financeWrites:0};
  });
}
function _issue734AssertDrainedAfterRepair_(props) {
  var g=_issue507GateRead_(props),s;
  if(g.mode!=='DRAINING'||g.releaseId!==ISSUE507_GATE_RELEASE_ID||
     Object.keys(g.active).length!==0||
     Date.now()-g.barrierAt<420000)
    throw Error('ISSUE734_MAINTENANCE_GATE_NOT_DRAINED');
  var raw=props.getProperty('issue734_writer_pause_audit_v1'),
      r=props.getProperty('issue734_writer_gate_repair_audit_v1');
  try {s={pause:JSON.parse(raw||'null'),repair:JSON.parse(r||'null')};}
  catch(ignore){throw Error('ISSUE734_MAINTENANCE_AUDIT_INVALID');}
  if(!s.pause||s.pause.status!=='PAUSED'||s.pause.pausedAt!==g.barrierAt||
     !s.repair||s.repair.status!=='PRUNED'||s.repair.recoveredCount!==14||
     !props.getProperty('issue734_writer_pause_before_v1')||
     !props.getProperty('issue734_writer_gate_before_20261110_v1'))
    throw Error('ISSUE734_MAINTENANCE_REPAIR_UNVERIFIED');
  if(_tradeLedgerWriteUnverified_()||_readPendingTradeSnapshotRebuild())
    throw Error('ISSUE734_MAINTENANCE_LEDGER_PENDING');
  return g;
}
function _issue734WithInternalBypass_(callback) {
  // Only for the trusted manually selected operator-only implementation.
  // DRAINING blocks all published web-app/scheduled gated writers.
  var previous=_issue507GateInside_;_issue507GateInside_=true;
  try{return callback();}
  finally{_issue507GateInside_=previous;}
}
function issue734DrainedTradeV2Preflight() {
  return _issue734WithInternalBypass_(function(){
    _issue734AssertDrainedAfterRepair_(
      PropertiesService.getScriptProperties());
    return _issue734DrainedTradeV2Migration_('PREVIEW');
  });
}
function issue734DrainedTradeV2Apply() {
  return _issue734WithInternalBypass_(function(){
    _issue734AssertDrainedAfterRepair_(
      PropertiesService.getScriptProperties());
    return _issue734DrainedTradeV2Migration_('APPLY');
  });
}
function issue734DrainedTradeV2Restore() {
  return _issue734WithInternalBypass_(function(){
    _issue734AssertDrainedAfterRepair_(
      PropertiesService.getScriptProperties());
    return _issue734DrainedTradeV2Migration_('RESTORE');
  });
}
function issue734ResumeWritersAfterApplied() {
  return _issue734WithInternalBypass_(function(){
    return _issue507GateAtomic_(function(props){
      var g=_issue734AssertDrainedAfterRepair_(props),
          raw=props.getProperty('trade_v2_migration_journal_v1'),j;
      try{j=raw?JSON.parse(raw):null;}catch(ignore){j=null;}
      if(!j||j.status!=='APPLIED'||j.rowCount!==338||
         j.operationId===undefined||
         !props.getProperty('trade_v2_migration_approval_v1'))
        throw Error('ISSUE734_RESUME_MIGRATION_NOT_APPLIED');
      var a;
      try{a=JSON.parse(props.getProperty('trade_v2_migration_approval_v1'));}
      catch(ignore){throw Error('ISSUE734_RESUME_APPROVAL_INVALID');}
      if(!a||a.userApproved!==true||a.writerIsolationConfirmed!==true||
         a.approvedFor!=='APPLY'||a.operationId!==j.operationId)
        throw Error('ISSUE734_RESUME_APPROVAL_MISMATCH');
      var ss=getss(),sh=ss.getSheetByName(CONFIG.SHEET_TRADES);
      if(!sh||sh.getLastRow()!==339||sh.getLastColumn()!==14||
         ss.getId()!==j.spreadsheetId||sh.getSheetId()!==j.sheetId)
        throw Error('ISSUE734_RESUME_SHEET_DRIFT');
      var backup=ss.getSheetByName(j.backupName);
      if(!backup||_sheetContentSignature(backup)!==j.sourceSignature||
         backup.getLastColumn()!==11||backup.getLastRow()!==339)
        throw Error('ISSUE734_RESUME_BACKUP_UNVERIFIED');
      if(_tradeV2Revision_(sh.getRange(2,1,338,14).getValues())!==j.targetRevision)
        throw Error('ISSUE734_RESUME_TRADE_ID_DRIFT');
      var ids=sh.getRange(2,14,338,1).getValues().map(function(x){return x[0];});
      if(new Set(ids).size!==338||ids.some(function(x){return !x;}))
        throw Error('ISSUE734_RESUME_DUPLICATE_OR_MISSING_IDS');
      var auditKey='issue734_writer_pause_audit_v1',
          audit=JSON.parse(props.getProperty(auditKey));
      audit.status='RESUMING';
      props.setProperty(auditKey,JSON.stringify(audit));
      if(props.getProperty(auditKey)!==JSON.stringify(audit))
        throw Error('ISSUE734_RESUME_AUDIT_READBACK_FAILED');
      // The one-off financial permission must not remain live on resume.
      props.deleteProperty('trade_v2_migration_approval_v1');
      props.deleteProperty('issue734_stale_gate_recovery_approval_v1');
      if(props.getProperty('trade_v2_migration_approval_v1')||
         props.getProperty('issue734_stale_gate_recovery_approval_v1'))
        throw Error('ISSUE734_RESUME_APPROVAL_REVOKE_FAILED');
      g.mode='OPEN';
      _issue507GateSave_(props,g);
      if(_issue507GateRead_(props).mode!=='OPEN')
        throw Error('ISSUE734_RESUME_GATE_READBACK_FAILED');
      audit.status='RESUMED';audit.resumedAt=Date.now();
      props.setProperty(auditKey,JSON.stringify(audit));
      if(props.getProperty(auditKey)!==JSON.stringify(audit))
        throw Error('ISSUE734_RESUME_FINAL_AUDIT_READBACK_FAILED');
      return {status:'OPEN',activeCount:0,tradeRows:338,
        migrationJournal:'APPLIED',approvalsRevoked:true,
        gateBackupsRetained:true,financeWrites:0};
    });
  });
}

// Exact reviewed GAS v9.288 migration with only explicit DRAINING entry
// and isolated-gate guards changed. See check-issue734-draining-maintenance.
function _issue734DrainedTradeV2Migration_(mode) {
  var props=PropertiesService.getScriptProperties(),
      journalKey='trade_v2_migration_journal_v1',
      approvalKey='trade_v2_migration_approval_v1';
  var lock=LockService.getScriptLock(),locked=false;
  var expectedHeaders=['날짜','매수/매도','계좌','종목명','종목코드','수량','단가',
    '자산유형','메모','비율','단주정산'];
  var addedHeaders=['외화단가','매입환율','거래ID'];
  var readJson=function(value,label){
    try {return value?JSON.parse(value):null;}
    catch(ignore){throw Error('TRADE_V2_MIGRATION_INVALID_'+label);}
  };
  var equal=function(a,b){return JSON.stringify(a)===JSON.stringify(b);};
  var assertSourceAtoK=function(sheet,backup,count){
    var a=sheet.getRange(1,1,count+1,11),
        b=backup.getRange(1,1,count+1,11);
    if(!equal(a.getValues(),b.getValues())||
       !equal(a.getFormulas(),b.getFormulas()))
      throw Error('TRADE_V2_MIGRATION_AK_DRIFT');
  };
  var checkHeader=function(sh,width){
    if((mode==='RESTORE'?[11,12,13,14]:[11,14]).indexOf(width)===-1)
      throw Error('TRADE_V2_MIGRATION_SCHEMA_UNSUPPORTED');
    var head=sh.getRange(1,1,1,11).getValues()[0];
    if(!equal(head,expectedHeaders))throw Error('TRADE_V2_MIGRATION_HEADER_DRIFT');
  };
  try {
    if(['PREVIEW','APPLY','RESTORE'].indexOf(mode)<0)
      throw Error('TRADE_V2_MIGRATION_MODE_INVALID');
    if(!lock.tryLock(30000))
      throw Error('TRADE_V2_MIGRATION_LOCK_BUSY');
    locked=true;
    var ss=getss(),configuredId=String(props.getProperty('SS_ID')||
      (typeof SS_ID!=='undefined'?SS_ID:'')||'');
    if(!configuredId||configuredId!==ss.getId())
      throw Error('TRADE_V2_MIGRATION_SSID_CONFIG_MISMATCH');
    var sh=ss.getSheetByName(CONFIG.SHEET_TRADES);
    if(!sh)throw Error('TRADE_V2_MIGRATION_SOURCE_MISSING');
    var width=sh.getLastColumn(),count=sh.getLastRow()-1;
    checkHeader(sh,width);
    if(!Number.isInteger(count)||count<1||count>100000)
      throw Error('TRADE_V2_MIGRATION_COUNT_INVALID');
    var srcSignature=_sheetContentSignature(sh),
        sourceRows=sh.getRange(2,1,count,Math.min(14,width)).getValues();
    var j=readJson(props.getProperty(journalKey),'JOURNAL');
    var stamp=Utilities.formatDate(new Date(),CONFIG.TIMEZONE,'yyyy-MM-dd');
    if(mode==='PREVIEW'){
      var preview=_tradeV2MigrationPlan_(sourceRows);
      return {status:'ok',mode:'PREVIEW',gasVersion:ISSUE507_GATE_API_VERSION,
        spreadsheetId:ss.getId(),sheetId:sh.getSheetId(),
        schemaWidth:width,sourceRows:preview.count,
        sourceDigest:preview.sourceDigest,sourceSignature:srcSignature,
        targetRevision:preview.proposedRevision,assignedIds:preview.assigned,
        preservedIds:preview.preserved,
        journalStatus:j?j.status:'NONE',requiresApproval:true,
        financeWrites:0};
    }
    if(ISSUE507_GATE_API_VERSION!=='9.288')
      throw Error('TRADE_V2_MIGRATION_RELEASE_MISMATCH');
    var a=readJson(props.getProperty(approvalKey),'APPROVAL');
    if(!a||a.userApproved!==true||a.writerIsolationConfirmed!==true||
       a.approvedFor!==mode||a.releaseVersion!=='9.288'||
       a.approvedDate!==stamp||!/^(?:mig_)[A-Za-z0-9_-]{12,64}$/.test(String(a.operationId||''))||
       a.spreadsheetId!==ss.getId()||
       Number(a.sheetId)!==sh.getSheetId()||
       !Number.isInteger(a.expectedRows)||a.expectedRows!==count)
      throw Error('TRADE_V2_MIGRATION_APPROVAL_REQUIRED');
    // A real approval must be created for the exact current workbook,
    // source revision and operation; never rely on the browser's old cache.
    var gate=readJson(props.getProperty('issue507_writer_gate_v1'),'WRITER_GATE');
    if(!gate||gate.mode!=='DRAINING'||!gate.active||
       Object.keys(gate.active).length!==0)
      throw Error('TRADE_V2_MIGRATION_WRITER_NOT_QUIESCENT');
    if(_tradeLedgerWriteUnverified_()||_readPendingTradeSnapshotRebuild())
      throw Error('TRADE_V2_MIGRATION_LEDGER_PENDING');
    // Additional operator-only cutover contract; published v9.288
    // admission remains closed for every other writer.
    _issue734AssertDrainedAfterRepair_(props);
    if(mode==='RESTORE'){
      if(!j||j.operationId!==a.operationId||
         j.spreadsheetId!==ss.getId()||j.sheetId!==sh.getSheetId()||
         j.rowCount!==count||j.sourceSignature!==a.expectedSourceSignature||
         j.sourceDigest!==a.expectedSourceDigest||
         j.targetRevision!==a.expectedTargetRevision||
         !['PREPARED','WRITING','PARTIAL','APPLIED','RESTORING','RESTORED'].includes(j.status))
        throw Error('TRADE_V2_MIGRATION_RESTORE_JOURNAL_MISMATCH');
      var backup=ss.getSheetByName(j.backupName);
      if(!backup||_sheetContentSignature(backup)!==j.backupSignature||
         j.backupSignature!==j.sourceSignature||
         backup.getLastColumn()!==11||backup.getLastRow()!==count+1)
        throw Error('TRADE_V2_MIGRATION_BACKUP_UNVERIFIED');
      assertSourceAtoK(sh,backup,count);
      if(j.status==='RESTORED'){
        if(width!==11||srcSignature!==j.sourceSignature)
          throw Error('TRADE_V2_MIGRATION_RESTORE_STATE_DRIFT');
        return {status:'ok',mode:'RESTORE',state:'RESTORED',alreadyDone:true,
          rowCount:count,backupName:j.backupName,financeWrites:0};
      }
      var before=backup.getRange(2,1,count,11).getValues();
      var planned=_tradeV2MigrationPlan_(before);
      if(planned.sourceDigest!==j.sourceDigest||
         planned.proposedRevision!==j.targetRevision)
        throw Error('TRADE_V2_MIGRATION_BACKUP_PLAN_DRIFT');
      // A partial timeout may have left a header and some IDs. Refuse
      // restoration if any L:N cell was edited to an unexpected value.
      if([11,12,13,14].indexOf(width)===-1)
        throw Error('TRADE_V2_MIGRATION_PARTIAL_SCHEMA_DRIFT');
      var additions=sh.getRange(1,12,count+1,3).getValues();
      for(var r=0;r<additions.length;r++){
        var expected=r===0?addedHeaders:planned.rows[r-1].slice(11,14);
        for(var c=0;c<3;c++){
          var v=additions[r][c];
          if(v!==''&&v!==null&&v!==undefined&&String(v)!==String(expected[c]))
            throw Error('TRADE_V2_MIGRATION_EXTERNAL_LN_CHANGE');
        }
      }
      // Original A:K and their formulas were never overwritten; remove
      // only newly created L:N content. Keep the independent backup intact.
      props.setProperty(journalKey,JSON.stringify(Object.assign({},j,{status:'RESTORING'})));
      sh.getRange(1,12,count+1,3).clearContent();
      SpreadsheetApp.flush();
      if(sh.getLastColumn()!==11||
         _sheetContentSignature(sh)!==j.sourceSignature)
        throw Error('TRADE_V2_MIGRATION_RESTORE_READBACK_FAILED');
      props.setProperty(journalKey,JSON.stringify(Object.assign({},j,{
        status:'RESTORED',restoredAt:new Date().toISOString()
      })));
      return {status:'ok',mode:'RESTORE',state:'RESTORED',
        alreadyDone:false,rowCount:count,backupName:j.backupName};
    }
    // Once applied, repeat the SAME operationId only as a verified no-op.
    // A different operation cannot replace an already-migrated ledger.
    if(j&&j.status==='APPLIED'&&j.operationId===a.operationId){
      if(width!==14||_tradeV2Revision_(sourceRows)!==j.targetRevision)
        throw Error('TRADE_V2_MIGRATION_ALREADY_APPLIED_DRIFT');
      return {status:'ok',mode:'APPLY',state:'APPLIED',
        alreadyDone:true,rowCount:count,backupName:j.backupName,financeWrites:0};
    }
    if(j&&!['RESTORED'].includes(j.status))
      throw Error('TRADE_V2_MIGRATION_PREVIOUS_OPERATION_UNRESOLVED');
    if(width!==11)
      throw Error('TRADE_V2_MIGRATION_REQUIRE_11_COLUMN_SOURCE');
    var plan=_tradeV2MigrationPlan_(sourceRows);
    if(plan.count!==count||plan.assigned!==count||plan.preserved!==0||
       a.expectedSourceDigest!==plan.sourceDigest||
       a.expectedSourceSignature!==srcSignature||
       a.expectedTargetRevision!==plan.proposedRevision)
      throw Error('TRADE_V2_MIGRATION_SOURCE_OR_PLAN_DRIFT');
    var originalFingerprint=_tradeLedgerContentFingerprint_(ss),
        savedFingerprint=props.getProperty(TRADE_LEDGER_FINGERPRINT_KEY);
    if(savedFingerprint&&savedFingerprint!==originalFingerprint)
      throw Error('TRADE_V2_MIGRATION_FINGERPRINT_STALE');
    var backupName=sh.getName()+'_v2_백업_'+a.operationId.slice(0,20);
    if(ss.getSheetByName(backupName))
      throw Error('TRADE_V2_MIGRATION_BACKUP_NAME_EXISTS');
    var capacity=_fundSheetCapacity(ss);
    if(!capacity||capacity.remainingCells<sh.getMaxRows()*sh.getMaxColumns())
      throw Error('TRADE_V2_MIGRATION_BACKUP_CAPACITY');
    // copyTo preserves formulas, formatting, column types and sheet state.
    // No stale backup is deleted or reused to make capacity for this write.
    var newBackup=sh.copyTo(ss);
    newBackup.setName(backupName);
    SpreadsheetApp.flush();
    var backupSignature=_sheetContentSignature(newBackup);
    if(backupSignature!==srcSignature)
      throw Error('TRADE_V2_MIGRATION_BACKUP_COPY_DRIFT');
    assertSourceAtoK(sh,newBackup,count);
    var record={operationId:a.operationId,status:'PREPARED',
      spreadsheetId:ss.getId(),sheetId:sh.getSheetId(),
      rowCount:count,sourceDigest:plan.sourceDigest,
      sourceSignature:srcSignature,targetRevision:plan.proposedRevision,
      backupName:backupName,backupSignature:backupSignature,
      preparedAt:new Date().toISOString()};
    props.setProperty(journalKey,JSON.stringify(record));
    // Persist WRITING before the first mutation. Hard timeouts leave a
    // recoverable journal instead of falsely reporting clean completion.
    props.setProperty(journalKey,JSON.stringify(Object.assign({},record,{status:'WRITING'})));
    sh.getRange(1,12,1,3).setValues([addedHeaders]);
    sh.getRange(2,12,count,3).setValues(plan.rows.map(function(row){
      return row.slice(11,14);
    }));
    SpreadsheetApp.flush();
    if(sh.getLastColumn()!==14||sh.getLastRow()!==count+1)
      throw Error('TRADE_V2_MIGRATION_WRITE_SIZE_MISMATCH');
    assertSourceAtoK(sh,newBackup,count);
    var applied=sh.getRange(2,1,count,14).getValues(),
        readback=_tradeV2MigrationPlan_(applied);
    if(readback.assigned!==0||readback.preserved!==count||
       readback.proposedRevision!==plan.proposedRevision||
       !equal(sh.getRange(1,12,1,3).getValues()[0],addedHeaders)||
       _tradeLedgerContentFingerprint_(ss)!==originalFingerprint)
      throw Error('TRADE_V2_MIGRATION_READBACK_MISMATCH');
    props.setProperty(journalKey,JSON.stringify(Object.assign({},record,{
      status:'APPLIED',appliedAt:new Date().toISOString()
    })));
    return {status:'ok',mode:'APPLY',state:'APPLIED',alreadyDone:false,
      rowCount:count,assignedIds:count,backupName:backupName,
      targetRevision:plan.proposedRevision};
  }catch(err){
    // Do not attempt a blind automatic restore after an indeterminate GAS
    // timeout or competing edit. Only a separately approved RESTORE action
    // may remove the candidate's L:N values, after validating A:K.
    return {status:'error',mode:mode,
      errorCode:String(err&&err.message||'TRADE_V2_MIGRATION_UNKNOWN'),
      requiresManualReview:true};
  }finally{if(locked)lock.releaseLock();}
}
