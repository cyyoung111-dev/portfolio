import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const view = fs.readFileSync('src/web/views/views_history.js', 'utf8');
const pipeline = fs.readFileSync('src/web/views/views_history_pipeline.js', 'utf8');
const event = fs.readFileSync('src/web/app/event_delegation.js', 'utf8');
const gas = fs.readFileSync('src/gas/apps_script.gs', 'utf8');
const context = { window: {}, rawTrades: [], _normalizeHistDate: String, _fmtKrw: String };
vm.runInNewContext(`${view}\nglobalThis.buildDiagnostics=_buildHistoryDiagnostics;`, context);
const v = context.buildDiagnostics([
  { date:'2026-07-21', evalAmt:850000000, costAmt:700000000, itemCount:10 },
  { date:'2026-07-22', evalAmt:630000000, costAmt:701000000, itemCount:6 },
  { date:'2026-07-23', evalAmt:860000000, costAmt:702000000, itemCount:10 },
]);
assert.equal(v['2026-07-22'].kind, 'TRANSIENT_V', '5억원/60% 미만 V자도 후보여야 합니다.');
assert.match(pipeline, /diagnoseSnapshotIntegrityRange/);
assert.doesNotMatch(pipeline, /slice\(0, 10\)/, '후보 최대 10개 제한을 제거해야 합니다.');
assert.match(view, /HISTORY_BLOCKING_INTEGRITY_STATUSES[^\n]*PARTIAL[^\n]*MISMATCH[^\n]*CONFLICT[^\n]*NO_SNAPSHOT/);
assert.match(view, /pnlSegments/, '오류 Snapshot에서 손익선을 끊어야 합니다.');
assert.match(pipeline, /repairHistoryIntegritySnapshots[\s\S]*diagnoseSnapshotIntegrity[\s\S]*rewriteSnapshotDate[\s\S]*after\?\.status !== 'VALID'[\s\S]*await loadHistoryChart/);
assert.match(event, /repair-integrity[\s\S]*repairHistoryIntegritySnapshots/);
assert.match(gas, /function handleDiagnoseSnapshotIntegrityRange/);
for (const field of ['checkedDates','validDates','partialDates','mismatchDates','conflictDates','sourceIncompleteDates','noSnapshotDates','abnormalCandidates','diagnostics']) assert.match(gas, new RegExp(field));
assert.match(gas, /function maintainSystemBackups\(options\)/);
assert.match(gas, /if \(!apply\) return _planSystemBackupMaintenance\(ss\);/, 'dry-run은 lock·삭제 전에 계획만 반환해야 합니다.');
assert.match(gas, /activeOperation[\s\S]*formulaReferenceCount[\s\S]*USER_MANAGED\/UNKNOWN 보호/);
assert.match(gas, /ORPHAN_LIKELY_SYSTEM/);
assert.match(gas, /deletedSheetNames[\s\S]*protectedSheets[\s\S]*totalCellsAfter[\s\S]*remainingCellsAfter/);
assert.match(gas, /showSystemBackupDiagnosis/);
assert.match(gas, /applySystemBackupMaintenancePrompt/);
assert.match(gas, /operationId \? 'rewriteSnapshotDate\|' \+ String\(operationId\)/, '다일자 복구 operationId를 재사용해야 합니다.');
assert.match(gas, /status !== 'VALID'/, '재작성은 VALID 재진단을 요구해야 합니다.');
assert.match(gas, /MANUAL 행 보호/);
assert.match(pipeline, /SOURCE_INCOMPLETE/);
assert.match(pipeline, /CONFLICT/);
console.log('✅ Snapshot range 진단·차트 gap·안전 복구·백업 maintenance 회귀 검사 통과');
assert.match(gas, /function _classifyRawSnapshotDuplicateGroups/);
for (const classification of ['EXACT_DUPLICATE','SINGLE_EXPECTED_MATCH','MANUAL_PROTECTED','UNRESOLVED_CONFLICT','SOURCE_INCOMPLETE']) assert.match(gas, new RegExp(classification));
assert.match(gas, /rawDuplicateDecisions[\s\S]*!rawDuplicateDecisions\.length/, 'dedupe signature가 raw 중복을 숨기면 안 됩니다.');
assert.match(gas, /SpreadsheetApp\.flush\(\);[\s\S]*diagnoseSnapshotIntegrity\(ss, snapshotDate\)/, 'full repair는 flush 뒤 raw 재진단해야 합니다.');
assert.match(gas, /SYSTEM_BACKUP_KEEP_BY_SOURCE = \{[^\n]*'스냅샷': 0/);
assert.match(gas, /_systemBackupTimestampFromName\(name\)/, 'orphan 생성 시각은 이름에서 보존해야 합니다.');
assert.match(gas, /remainingCells < minimumCreationCells[\s\S]*_cleanupSystemBackups\(ss, sourceName\)[\s\S]*_fundSheetCapacity\(ss\)/, '셀 부족 시 정리 후 재계산해야 합니다.');
assert.match(gas, /가격이력 쓰기 후 검증 실패[\s\S]*_cleanupCurrentSystemBackup\(ss, backup\)/, '가격이력 repair 성공 후 현재 operation backup을 정리해야 합니다.');
assert.match(gas, /registeredCompleted \|\| \(registeredFailed \? item\.signatureMatch : \(item\.signatureMatch && item\.schemaMatch\)\)/, '등록된 COMPLETED 백업은 현재 schema 변경만으로 영구 보호하면 안 됩니다.');
assert.match(gas, /Snapshot 중복 정리 후 raw 검증 실패[\s\S]*_markSnapshotBackupStatus\(backup, 'COMPLETED'\)/, 'raw 검증이 COMPLETED 및 backup 삭제보다 먼저여야 합니다.');
assert.doesNotMatch(gas.match(/function _cleanupCurrentSystemBackup[\s\S]*?\n}/)?.[0] || '', /_reconcileSystemBackups|_sheetFormulaReferenceCount|getSheets\(/, '현재 operation FAST PATH는 workbook scan을 하면 안 됩니다.');
assert.doesNotMatch(gas.match(/function cleanupSnapshotDuplicates[\s\S]*?\n}/)?.[0] || '', /Object\.keys\(dates\)[\s\S]*_readRawSnapshotRowsByDate/, 'cleanup 초기 분류에서 날짜별 전체 Snapshot 재읽기 금지');
assert.doesNotMatch(gas, /최신 유효 백업은 source별 1개 보존/, '유지보수 안내문은 system backup 0개 정책과 일치해야 합니다.');
assert.match(gas, /GOOGLE_SHEETS_CELL_LIMIT = 10000000/, 'Google Sheets 파일당 10M cell 한도');
assert.match(gas, /deleteColumns[\s\S]*insertRowsAfter/, 'tall\/narrow backup은 열 축소 후 행 확장');
assert.match(gas, /if \(operationId\)[\s\S]*operationRecord[\s\S]*var signature = _sheetContentSignature/, '동일 operation backup은 source 전체 signature 전에 재사용');
assert.match(gas, /else if \(state\.failed === 0\) state\.backupCleanup/, '실패한 full repair는 전체 backup maintenance 금지');
assert.match(gas, /writeFailedCount:[\s\S]*writeFailed:/, 'backup summary count와 name 목록 key 분리');
assert.match(gas, /function maintainSystemBackups[\s\S]*hasLock\(\)[\s\S]*_planSystemBackupMaintenance/, 'maintenance apply는 lock 뒤 plan 재계산');
