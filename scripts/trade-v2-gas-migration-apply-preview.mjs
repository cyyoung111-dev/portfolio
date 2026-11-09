// Manually invoked GAS editor migration only. NEVER route via doGet/doPost.
// The 11-column source is never cleared/reordered: only L:N are written.
// Requires explicit one-day ScriptProperties approval and a verified backup.
// No writes occur by importing this source-only module in Node CI.
export const TRADE_V2_GAS_MIGRATION_APPLY = String.raw`
function runTradeV2MigrationPreflight() {
  return _tradeV2MigrationManual_('PREVIEW');
}
function runTradeV2MigrationApply() {
  return _tradeV2MigrationManual_('APPLY');
}
function runTradeV2MigrationRestore() {
  return _tradeV2MigrationManual_('RESTORE');
}
function _tradeV2MigrationManual_(mode) {
  if (typeof _issue507GateInside_ !== 'undefined' && !_issue507GateInside_)
    return _issue507GateInvoke_('_tradeV2MigrationManual_', _tradeV2MigrationManual_, this, arguments);
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
    if(width!==11&&width!==14)throw Error('TRADE_V2_MIGRATION_SCHEMA_UNSUPPORTED');
    var head=sh.getRange(1,1,1,11).getValues()[0];
    if(!equal(head,expectedHeaders))throw Error('TRADE_V2_MIGRATION_HEADER_DRIFT');
  };
  try {
    if(['PREVIEW','APPLY','RESTORE'].indexOf(mode)<0)
      throw Error('TRADE_V2_MIGRATION_MODE_INVALID');
    if(!lock.tryLock(30000))
      throw Error('TRADE_V2_MIGRATION_LOCK_BUSY');
    locked=true;
    var ss=getss(),sh=ss.getSheetByName(CONFIG.SHEET_TRADES);
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
    if(!gate||gate.mode!=='OPEN'||!gate.active||
       Object.keys(gate.active).length>1)
      throw Error('TRADE_V2_MIGRATION_WRITER_NOT_QUIESCENT');
    if(_tradeLedgerWriteUnverified_()||_readPendingTradeSnapshotRebuild())
      throw Error('TRADE_V2_MIGRATION_LEDGER_PENDING');
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
      if(width!==11&&width!==14)
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
    var savedFingerprint=props.getProperty(TRADE_LEDGER_FINGERPRINT_KEY);
    if(savedFingerprint&&savedFingerprint!==_tradeLedgerContentFingerprint_(ss))
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
       _tradeLedgerContentFingerprint_(ss)!==_tradeLedgerContentFingerprint_(newBackup))
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
`;
