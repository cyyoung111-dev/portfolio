// Source-only 9.286 profiling; pinned v9.285, production GAS and data unchanged.
// Logs carry stage and duration only, never cell data, credentials or backup IDs.
import assert from 'node:assert/strict';

function replaceExactlyOnce(input,before,after,label){
  const index=input.indexOf(before);
  assert(index!==-1,'TIMING_PROFILE_ANCHOR_MISSING:'+label);
  assert(input.indexOf(before,index+before.length)===-1,
    'TIMING_PROFILE_ANCHOR_AMBIGUOUS:'+label);
  return input.slice(0,index)+after+input.slice(index+before.length);
}
function editFunction(source,name,edit){
  const start=source.indexOf('function '+name+'(');
  assert(start>=0,'TIMING_PROFILE_FUNCTION_MISSING:'+name);
  const end=source.indexOf('\n}',start);
  assert(end>start,'TIMING_PROFILE_BOUNDARY_MISSING:'+name);
  const oldBody=source.slice(start,end+2);
  const newBody=edit(oldBody);
  assert.notEqual(newBody,oldBody);
  return source.slice(0,start)+newBody+source.slice(end+2);
}
const backupTimingStart=[
  '  // Structured log only; no sheet name, values, account, or backup ID.',
  '  var snapshotTimingEnabled = sourceName === CONFIG.SHEET_SNAPSHOT;',
  '  var snapshotTimingStartedAt = Date.now();',
  '  var snapshotTimingPreviousAt = snapshotTimingStartedAt;',
  '  var snapshotTimingMark = function(stage, state) {',
  '    if (!snapshotTimingEnabled) return;',
  '    var now = Date.now();',
  '    try {',
  "      if (typeof Logger !== 'undefined' && Logger && typeof Logger.log === 'function')",
  "        Logger.log('[SNAPSHOT_BACKUP_TIMING] ' + JSON.stringify({",
  '          stage:stage, state:state, startedMs:snapshotTimingStartedAt,',
  '          deltaMs:now-snapshotTimingPreviousAt, totalMs:now-snapshotTimingStartedAt',
  '        }));',
  '    } catch (ignoredProfileError) {}',
  '    snapshotTimingPreviousAt = now;',
  '  };'
].join('\n');
const writeTimingStart=[
  '  var snapshotWriteTimingStartedAt = 0;',
  '  var snapshotWriteTimingMark = function(stage) {',
  '    if (!snapshotWriteTimingStartedAt) return;',
  '    var now = Date.now();',
  '    try {',
  "      if (typeof Logger !== 'undefined' && Logger && typeof Logger.log === 'function')",
  "        Logger.log('[SNAPSHOT_WRITE_TIMING] ' + JSON.stringify({",
  '          stage:stage, startedMs:snapshotWriteTimingStartedAt,',
  '          totalMs:now-snapshotWriteTimingStartedAt',
  '        }));',
  '    } catch (ignoredProfileError) {}',
  '  };'
].join('\n');
export function composeGas9286SnapshotTimingProbe(source){
  assert.equal(typeof source,'string');
  let candidate=editFunction(source,'_backupSheetBeforeWrite',initial=>{
    let body=replaceExactlyOnce(initial,
      '  sourceName = String(sourceName || sheet.getName());',
      '  sourceName = String(sourceName || sheet.getName());\n'+backupTimingStart,
      'INIT_BACKUP');
    body=replaceExactlyOnce(body,
      '  var registry = _readSystemBackupRegistry();',
      "  var registry = _readSystemBackupRegistry();\n  snapshotTimingMark('registry_read','END');",
      'REGISTRY');
    body=replaceExactlyOnce(body,
      '    if (operationRecord) return Object.assign({}, operationRecord, { reused: true });',
      "    if (operationRecord) {\n      snapshotTimingMark('operation_reuse','END');\n      return Object.assign({}, operationRecord, { reused: true });\n    }",
      'OPERATION_REUSE');
    body=replaceExactlyOnce(body,
      '  var sourceSignature = _sheetContentSignature(sheet);',
      "  snapshotTimingMark('source_signature','START');\n  var sourceSignature = _sheetContentSignature(sheet);\n  snapshotTimingMark('source_signature','END');",
      'SOURCE_SIGNATURE');
    body=replaceExactlyOnce(body,
      '    return Object.assign({}, reusableRecord, { reused: true, operationId: reusableRecord.operationId || operationId });',
      "    snapshotTimingMark('registry_reuse','END');\n    return Object.assign({}, reusableRecord, { reused: true, operationId: reusableRecord.operationId || operationId });",
      'REGISTRY_REUSE');
    body=replaceExactlyOnce(body,
      '  var backup = ss.insertSheet(name);',
      "  snapshotTimingMark('backup_tab_create','START');\n  var backup = ss.insertSheet(name);\n  snapshotTimingMark('backup_tab_create','END');",
      'CREATE_TAB');
    body=replaceExactlyOnce(body,
      '  if (rowCount > 0 && colCount > 0) {',
      "  snapshotTimingMark('backup_copy','START');\n  if (rowCount > 0 && colCount > 0) {",
      'COPY_START');
    body=replaceExactlyOnce(body,
      '  // 백업 내용은 유지하되 기본 생성된 미사용 격자는 즉시 회수합니다.',
      "  snapshotTimingMark('backup_copy','END');\n  // 백업 내용은 유지하되 기본 생성된 미사용 격자는 즉시 회수합니다.",
      'COPY_END');
    body=replaceExactlyOnce(body,
      "  if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.flush) SpreadsheetApp.flush();",
      "  snapshotTimingMark('backup_flush','START');\n  if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.flush) SpreadsheetApp.flush();\n  snapshotTimingMark('backup_flush','END');",
      'FLUSH');
    body=replaceExactlyOnce(body,
      '  var backupSignature = _sheetContentSignature(backup);',
      "  snapshotTimingMark('backup_signature','START');\n  var backupSignature = _sheetContentSignature(backup);\n  snapshotTimingMark('backup_signature','END');",
      'BACKUP_SIGNATURE');
    body=replaceExactlyOnce(body,
      '  _registerSystemBackup(record);',
      "  _registerSystemBackup(record);\n  snapshotTimingMark('registry_commit','END');",
      'REGISTRY_COMMIT');
    for(const proof of [
      '_sheetContentSignature(sheet)','_sheetContentSignature(backup)',
      'sourceRange.copyTo(backupRange)','_registerSystemBackup(record)'
    ])assert(body.includes(proof),'TIMING_PROFILE_SAFETY_GUARD:'+proof);
    return body;
  });
  candidate=editFunction(candidate,'writeSnapshotRows',initial=>{
    let body=replaceExactlyOnce(initial,
      '  var snapshotBackupRecord = null;',
      '  var snapshotBackupRecord = null;\n'+writeTimingStart,'INIT_WRITE');
    body=replaceExactlyOnce(body,
      '      snapshotBackupRecord = _backupSnapshotBeforeWrite(ss, sh);',
      "      snapshotWriteTimingStartedAt = Date.now();\n      snapshotWriteTimingMark('backup_start');\n      snapshotBackupRecord = _backupSnapshotBeforeWrite(ss, sh);\n      snapshotWriteTimingMark('backup_done');",
      'BACKUP');
    body=replaceExactlyOnce(body,
      '      _writeSnapshotDateScoped_(ss, sh, normDate, existing, mergedDate, colSize);',
      "      snapshotWriteTimingMark('date_write_start');\n      _writeSnapshotDateScoped_(ss, sh, normDate, existing, mergedDate, colSize);\n      snapshotWriteTimingMark('date_write_done');",
      'DATE_WRITE');
    body=replaceExactlyOnce(body,
      "      if (!_snapshotBackupOperationId) _markSnapshotBackupStatus(snapshotBackupRecord, 'COMPLETED');",
      "      snapshotWriteTimingMark('cleanup_start');\n      if (!_snapshotBackupOperationId) _markSnapshotBackupStatus(snapshotBackupRecord, 'COMPLETED');",
      'CLEANUP_START');
    body=replaceExactlyOnce(body,
      '    } else {\n      if (newRows.length > 0) { _setCodeColumnText(sh, 2);',
      "      snapshotWriteTimingMark('cleanup_done');\n    } else {\n      if (newRows.length > 0) { _setCodeColumnText(sh, 2);",
      'CLEANUP_END');
    body=replaceExactlyOnce(body,
      "  } catch(err) {\n    _markSnapshotBackupStatus(snapshotBackupRecord, 'WRITE_FAILED', err.message);",
      "  } catch(err) {\n    snapshotWriteTimingMark('error');\n    _markSnapshotBackupStatus(snapshotBackupRecord, 'WRITE_FAILED', err.message);",
      'ERROR');
    assert(body.includes('writeLock.releaseLock()'));
    assert(body.includes('_writeSnapshotDateScoped_(ss, sh, normDate, existing, mergedDate, colSize)'));
    return body;
  });
  return {source:candidate,profileEventTypes:[
    'registry_read','source_signature','backup_tab_create',
    'backup_copy','backup_flush','backup_signature','registry_commit',
    'backup_start','backup_done','date_write_start','date_write_done',
    'cleanup_start','cleanup_done','error'
  ],sourceOnly:true,financeWrites:0,productionGasDeployments:0};
}
