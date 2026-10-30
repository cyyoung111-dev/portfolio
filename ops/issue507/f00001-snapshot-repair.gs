// Staged maintenance module: NOT loaded by deploy-gas, no HTTP/menu/trigger route.
// Install/execute only after separate approval. Uses the reviewed production
// calculator; never accepts client financial values or broad rewrite requests.
function issue507F00001SnapshotRepair_(apply) {
  if (apply !== false && apply !== true) throw new Error('EXPLICIT_MODE_REQUIRED');
  var lock=LockService.getScriptLock(), owned=false;
  try {
    if (!lock.tryLock(1000)) throw new Error('WRITER_BUSY');
    owned=true;
    var props=PropertiesService.getScriptProperties();
    _issue507F00001ExcludeWriters_(props);
    var ss=getss(), sheet=ss.getSheetByName(CONFIG.SHEET_SNAPSHOT);
    var read=function(){return sheet.getRange(1,1,sheet.getLastRow(),sheet.getLastColumn()).getValues();};
    var formulas=sheet.getRange(1,1,sheet.getLastRow(),sheet.getLastColumn()).getFormulas();
    if(formulas.some(function(row){return row.some(function(cell){return !!cell;});})) throw new Error('FORMULA_SNAPSHOT_UNSUPPORTED');
    var before=read(), sources=_issue507F00001Sources_(ss);
    var proof=_issue507F00001Proof_(ss), matches=[];
    before.forEach(function(row,i){if (_normalizeDate(row[0])==='2026-10-30' && row[1]==='F00001') matches.push(i);});
    if (matches.length!==1 || before[matches[0]].length<12) throw new Error('PHYSICAL_ROW_SCOPE');
    var index=matches[0], original=before[index];
    // Compare the physical row to the diagnostic, without hiding extra columns.
    if (JSON.stringify(original.slice(1,12))!==JSON.stringify(proof.stored.slice(1,12))) throw new Error('PHYSICAL_ROW_CHANGED');
    var intended=before.map(function(row){return row.slice();});
    [6,7,8,9,10].forEach(function(col){intended[index][col]=proof.expected[col];});
    var binding=_issue507F00001Hash_({before:before,sources:sources,intended:intended});
    if (!apply) return {mode:'DRY_RUN',rows:39,changed:0,writeAuthorized:false,approvalBinding:binding};
    // Exact one-use approval binding must be set separately by an authorized
    // operator after review; this module never creates its own approval.
    if (props.getProperty('issue507_f00001_approval_v1')!==binding) throw new Error('APPROVAL_REQUIRED');
    if (props.getProperty('issue507_f00001_external_writers_excluded_v1')!==binding) throw new Error('EXTERNAL_WRITER_EXCLUSION_REQUIRED');
    // Snapshot plus all calculator sources are re-read immediately before backup.
    if (JSON.stringify(read())!==JSON.stringify(before) || _issue507F00001Sources_(ss)!==sources) throw new Error('SOURCE_CHANGED');
    _issue507F00001ExcludeWriters_(props);
    // Dedicated native backup is retained on success AND failure. Do not use
    // settle helpers which may delete completed backups under the keep=0 policy.
    var backup=sheet.copyTo(ss);
    backup.setName('ISSUE507_F00001_'+Utilities.getUuid());
    SpreadsheetApp.flush();
    if (backup.getLastRow()!==before.length || backup.getLastColumn()!==before[0].length ||
        JSON.stringify(backup.getRange(1,1,before.length,before[0].length).getValues())!==JSON.stringify(before)) throw new Error('BACKUP_READBACK_FAILED');
    if (JSON.stringify(read())!==JSON.stringify(before) || _issue507F00001Sources_(ss)!==sources) throw new Error('SOURCE_CHANGED');
    _issue507F00001ExcludeWriters_(props);
    // Consume before writing: response loss/partial failure cannot retry blindly.
    props.deleteProperty('issue507_f00001_approval_v1');
    props.deleteProperty('issue507_f00001_external_writers_excluded_v1');
    if (props.getProperty('issue507_f00001_approval_v1')) throw new Error('APPROVAL_CONSUME_FAILED');
    // Exactly G:K of ONE EXISTING row. No append/delete/whole-date writer.
    sheet.getRange(index+1,7,1,5).setValues([intended[index].slice(6,11)]);
    SpreadsheetApp.flush();
    if (JSON.stringify(read())!==JSON.stringify(intended) || _issue507F00001Sources_(ss)!==sources) throw new Error('WRITE_READBACK_FAILED_BACKUP_RETAINED');
    var after=diagnoseSnapshotIntegrity(ss,'2026-10-30');
    // F00002 warning is intentionally still a source-only MISMATCH, never VALID.
    _issue507F00001RowsProof_(after,true);
    _touchSnapshotIntegritySourceRevision({date:'2026-10-30'});
    return {mode:'APPLIED',rows:39,changed:1,otherRowsPreserved:true,f00002WarningPreserved:true,backupRetained:true};
  } finally {if(owned)lock.releaseLock();}
}
function _issue507F00001Hash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(value)).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
}
function _issue507F00001Sources_(ss) {
  var context=_buildSnapshotRangeReadContext(ss,{});
  delete context.valuesByName[CONFIG.SHEET_SNAPSHOT];
  return _issue507StrictReadSourceDigest_(context);
}
function _issue507F00001ExcludeWriters_(props) {
  // ScriptLock is held for the entire transaction. In-flight network producers
  // may have released it: reject their leases/stages rather than stealing them.
  [PORTFOLIO_FUND_LEASE_KEY,PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY].forEach(function(key){
    var raw=props.getProperty(key);
    if(raw) throw new Error('WRITER_BUSY'); // even expired owners require separate reconciliation
  });
  // Fail closed even for stale stages; reconcile them separately, never here.
  if (['PRICE','FUND'].indexOf(props.getProperty('portfolio_close_stage'))>=0 ||
      _tradeLedgerWriteUnverified_() || props.getProperty(TRADE_SNAPSHOT_REBUILD_PENDING_KEY)) throw new Error('WRITER_BUSY');
}
function _issue507F00001Proof_(ss) {
  var d=diagnoseSnapshotIntegrity(ss,'2026-10-30');
  var proof=_issue507F00001RowsProof_(d,false);
  ['F00001','F00002'].forEach(function(code){
    var status=_getFundValuationStatus(ss,'2026-10-30','2026-10-30',code);
    if(status.code!==code || status.dates.length!==1) throw new Error('FUND_DAY_STATE');
    var day=status.dates[0];
    if(day.code!==code || day.date!=='2026-10-30' || !day.unitsApplied || !day.publicationExpected ||
       day.evaluationState!=='EXISTING_VALID' ||
       day.navState!==(code==='F00001'?'EXISTING_CONFIRMED':'NAV_MISSING') ||
       day.snapshotState!==(code==='F00001'?'WRITE_REQUIRED':'EXISTING_VALID')) throw new Error('FUND_DAY_STATE');
  });
  return proof;
}
function _issue507F00001RowsProof_(d,after) {
  if(!d || d.date!=='2026-10-30' || d.status!=='MISMATCH' || d.expectedRowCount!==39 || d.storedRowCount!==39 ||
      !Array.isArray(d.expectedRows) || d.expectedRows.length!==39 || !Array.isArray(d.storedRows) || d.storedRows.length!==39) throw new Error('FULL_RECHECK_REQUIRED');
  ['missingCodes','unexpectedCodes','qtyMismatches','costAmtMismatches','duplicateKeys','conflictKeys','sourceDataErrors'].forEach(function(key){
    if(!Array.isArray(d[key]) || d[key].length) throw new Error('OTHER_MISMATCH');
  });
  if(!Array.isArray(d.priceIntegrity) || !d.priceIntegrity.some(function(p){return p.code==='F00001' && p.status==='VALID';}) ||
     d.priceIntegrity.some(function(p){return p.status!=='VALID';})) throw new Error('PRICE_INTEGRITY');
  var expected={},stored={},target;
  [d.expectedRows,d.storedRows].forEach(function(rows,which){var map=which?stored:expected;
    rows.forEach(function(row){if(row.length!==12 || row[0]!=='2026-10-30' || !row[1] || map[row[1]]) throw new Error('ROW_KEY_SCOPE');map[row[1]]=row;});});
  if(Object.keys(expected).sort().join('|')!==Object.keys(stored).sort().join('|') || !expected.F00001 || !expected.F00002) throw new Error('ROW_KEY_SCOPE');
  Object.keys(expected).forEach(function(code){var e=expected[code],s=stored[code];
    for(var col=0;col<12;col++) {
      if(code==='F00001' && !after && [6,7,8,9,10].indexOf(col)>=0) continue;
      if(code==='F00002' && col===10) continue;
      if(e[col]!==s[col]) throw new Error('OTHER_ROW_OR_COLUMN_CHANGED');
    }
  });
  var e=expected.F00001,s=stored.F00001;
  if(e[10]!=='FUND_NAV' || (!after && (!/^FUND_NAV_CARRY(?:@2026-10-29)?$/.test(s[10]) || e[6]===s[6] || e[7]===s[7]))) throw new Error('TARGET_SOURCE');
  [6,7,8,9].forEach(function(col){if(typeof e[col]!=='number' || !Number.isFinite(e[col])) throw new Error('TARGET_NUMBER');});
  if(e[6]<=0 || e[7]<=0) throw new Error('TARGET_NUMBER');
  var kb=d.fundNavStates.filter(function(row){return row.code==='F00002';});
  if(kb.length!==1 || kb[0].sourceDate!=='2026-10-29' || expected.F00002[10]!=='FUND_NAV_CARRY@2026-10-29' ||
     !/^FUND_NAV_CARRY_INPUT_REQUIRED(?:@2026-10-29)?$/.test(stored.F00002[10])) throw new Error('KB_WARNING_REQUIRED');
  return {expected:e,stored:s};
}
