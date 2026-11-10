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
  if(g.mode!=='OPEN'||g.releaseId!==ISSUE507_GATE_RELEASE_ID||
     !g.active || Object.keys(g.active).length!==14)
    throw Error('ISSUE734_RECOVERY_ACTIVE_OR_RELEASE_DRIFT');
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
