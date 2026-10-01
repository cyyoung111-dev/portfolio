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
assert.match(gas, /if \(!apply\) return plan;/, 'dry-run은 삭제 전에 반환해야 합니다.');
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
