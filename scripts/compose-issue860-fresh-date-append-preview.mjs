// #860 source-only optimization proposal. A new-date append does not mutate
// existing Snapshot rows: its date-scoped writer has a rollback journal and
// verifies the persisted date before returning. Avoid a full 16k+ row backup
// only for this narrow case. Existing-date edits/repairs keep their full backup.
// Not an approved production GAS release; candidate must receive a new version,
// exact SHA approval, full-source CI and a manual deployment gate.
import assert from 'node:assert/strict';

function replaceOnce(input, before, after, label) {
  assert.equal(input.split(before).length, 2, 'ISSUE860_APPEND_SOURCE_DRIFT:'+label);
  return input.replace(before,after);
}
export function composeIssue860FreshDateAppendPreview(source) {
  assert.equal(typeof source, 'string');
  const start=source.indexOf('function writeSnapshotRows(');
  const end=source.indexOf('\n}',start);
  assert(start>=0 && end>start,'ISSUE860_APPEND_MISSING_WRITER');
  const original=source.slice(start,end+2);
  const before=[
    '      snapshotBackupRecord = _backupSnapshotBeforeWrite(ss, sh);',
    '      // #507: 날짜별 슬롯만 갱신합니다.'
  ].join('\n');
  const after=[
    '      // #860: append-only, new-date case. The date-scoped writer journals',
    '      // empty append slots, refuses occupied destinations, verifies the',
    '      // saved date, and rolls back only its own new cells on failure.',
    '      // No existing financial rows are overwritten in this branch.',
    '      if (overwrite === true && originalSameDateCount === 0 &&',
    '          !lifecycleRemovedRows && !rawDuplicateDecisions.length &&',
    '          mergedDate.length > 0 && mergedDate.length === newRows.length) {',
    '        _writeSnapshotDateScoped_(ss, sh, normDate, existing, mergedDate, colSize);',
    '        _touchSnapshotIntegritySourceRevision({ date: normDate });',
    "        Logger.log('[ISSUE860_FRESH_DATE_APPEND] '+JSON.stringify({date:normDate,rows:mergedDate.length,priorRowsUntouched:true}));",
    '        return;',
    '      }',
    '      snapshotBackupRecord = _backupSnapshotBeforeWrite(ss, sh);',
    '      // #507: 날짜별 슬롯만 갱신합니다.'
  ].join('\n');
  const replacement=replaceOnce(original,before,after,'BACKUP_BRANCH');
  const candidate=source.slice(0,start)+replacement+source.slice(end+2);
  assert(!source.includes('[ISSUE860_FRESH_DATE_APPEND]'),
    'ISSUE860_APPEND_ALREADY_APPLIED');
  return {source:candidate,original:source,changedFunctions:['writeSnapshotRows'],
    narrowCondition:'new-date append only',fullBackupForRepairs:true,
    scopedRollbackWriterUnchanged:true,productionVersionUnchanged:true,
    sourceOnly:true,approvedForDeploy:false,financialWrites:0,
    gasDeployments:0,telegramSends:0};
}
