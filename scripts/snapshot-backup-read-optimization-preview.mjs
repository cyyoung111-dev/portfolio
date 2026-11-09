// Staged proposal only. Pinned GAS v9.285, reference files and production untouched.
// Avoid one redundant full-sheet getValues() in backup creation when copyTo exists.
import assert from 'node:assert/strict';

function replaceOnce(source,before,after,label){
  const index=source.indexOf(before);
  assert.ok(index!==-1,'BACKUP_OPT_SOURCE_DRIFT_'+label);
  assert.equal(source.indexOf(before,index+1),-1,'BACKUP_OPT_AMBIGUOUS_'+label);
  return source.slice(0,index)+after+source.slice(index+before.length);
}
export function composeSnapshotBackupReadPreview(pinnedSource){
  assert.equal(typeof pinnedSource,'string');
  const first=pinnedSource.indexOf('function _backupSheetBeforeWrite(');
  assert.ok(first!==-1,'BACKUP_OPT_NO_FUNCTION');
  const last=pinnedSource.indexOf('\nfunction ',first+1);
  assert.ok(last>first,'BACKUP_OPT_NO_BOUNDARY');
  const original=pinnedSource.slice(first,last);
  let updated=replaceOnce(original,
    '  var values = rowCount > 0 && colCount > 0 ? sheet.getRange(1, 1, rowCount, colCount).getValues() : [];\n',
    '','REDUNDANT_READ');
  updated=replaceOnce(updated,'  if (values.length) {\n',
    '  if (rowCount > 0 && colCount > 0) {\n','COPY_GUARD');
  updated=replaceOnce(updated,
    "    var sourceRange = sheet.getRange(1, 1, values.length, colCount);\n"+
    "    var backupRange = backup.getRange(1, 1, values.length, colCount);\n"+
    "    if (typeof sourceRange.copyTo === 'function') sourceRange.copyTo(backupRange);\n"+
    "    else backupRange.setValues(values);\n",
    "    var sourceRange = sheet.getRange(1, 1, rowCount, colCount);\n"+
    "    var backupRange = backup.getRange(1, 1, rowCount, colCount);\n"+
    "    if (typeof sourceRange.copyTo === 'function') sourceRange.copyTo(backupRange);\n"+
    "    else backupRange.setValues(sourceRange.getValues());\n",
    'COPY_OR_FALLBACK');
  assert.match(updated,/_sheetContentSignature\(sheet\)/);
  assert.match(updated,/_sheetContentSignature\(backup\)/);
  assert.match(updated,/sourceRange\.copyTo\(backupRange\)/);
  assert.match(updated,/_registerSystemBackup\(record\)/);
  return {source:pinnedSource.slice(0,first)+updated+pinnedSource.slice(last),
    original,optimized:updated};
}
