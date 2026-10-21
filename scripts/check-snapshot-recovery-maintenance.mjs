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
assert.match(pipeline, /repairHistoryIntegritySnapshots[\s\S]*rewriteSnapshotDate[\s\S]*after\?\.status !== 'VALID'[\s\S]*await loadHistoryChart/);
assert.doesNotMatch(pipeline.match(/async function repairHistoryIntegritySnapshots[\s\S]*?\n}/)?.[0] || '', /diagnoseSnapshotIntegrity/, 'client/server 중복 진단 금지');
assert.match(pipeline, /catch \(error\) \{[\s\S]*failed\.push[\s\S]*break;/, 'history 다일자 repair는 첫 실패에서 중단해야 합니다.');
assert.match(event, /repair-integrity[\s\S]*repairHistoryIntegritySnapshots/);
assert.match(gas, /function handleDiagnoseSnapshotIntegrityRange/);
for (const field of ['checkedDates','validDates','partialDates','mismatchDates','conflictDates','sourceIncompleteDates','noSnapshotDates','abnormalCandidates','diagnostics']) assert.match(gas, new RegExp(field));
assert.match(gas, /function maintainSystemBackups\(options\)/);
assert.match(gas, /if \(!apply\) return _planSystemBackupMaintenance\(ss, options\);/, 'dry-run은 lock·삭제 전에 계획만 반환해야 합니다.');
assert.match(gas, /operationHasCreatedBackup/);
assert.match(gas, /formulaReferenceCount/);
assert.match(gas, /USER_MANAGED\/UNKNOWN 보호/);
assert.match(gas, /ORPHAN_LIKELY_SYSTEM/);
assert.match(gas, /deletedSheetNames[\s\S]*protectedSheets[\s\S]*totalCellsAfter[\s\S]*remainingCellsAfter/);
assert.match(gas, /showSystemBackupDiagnosis/);
assert.match(gas, /function _systemBackupProtectionSummaryLines/);
assert.match(gas, /function _systemBackupProtectionReason_/);
assert.match(gas, /content signature 불일치/);
assert.match(gas, /legacy signature 불일치 · 자동 재서명 금지/);
assert.match(gas, /SYSTEM_BACKUP_SIGNATURE_VERSION = 'backup-content-v2'/);
assert.match(gas, /currentTrustedV2[\s\S]*legacySupersededByTrustedV2/, 'trusted v2 성공 시 stale legacy cleanup 경로');
assert.match(gas, /operationsWithCreatedBackup[\s\S]*currentTrustedV2[\s\S]*!operationsWithCreatedBackup\[registered\.operationId\]/, 'fast cleanup current v2도 CREATED sibling이 있으면 신뢰 근거로 쓰지 않음');
assert.match(gas, /currentSchemaMatch[\s\S]*currentTrustedV2[\s\S]*currentSchemaMatch/, 'fast cleanup trusted v2는 source schema 일치 필수');
assert.match(gas, /formulaReferenceTargets[\s\S]*registered\.name[\s\S]*staleFormulaCounts[\s\S]*currentTrustedV2[\s\S]*staleFormulaCounts\[registered\.name\]/, 'fast cleanup trusted v2는 current backup 수식 참조 0건 필수');
assert.match(gas, /legacySupersededByTrustedV2[\s\S]*!operationsWithCreatedBackup\[item\.operationId\]/, 'stale legacy도 같은 operation의 CREATED sibling이 있으면 보호');
assert.match(gas, /legacySupersededByTrustedV2[\s\S]*!!item\.signature/, 'fast cleanup legacy 예외는 기존 registry signature가 있어야 함');
assert.match(gas, /legacySupersededByTrustedV2[\s\S]*!!records\[item\.name\][\s\S]*!!records\[item\.name\]\.signature/, 'maintenance legacy 예외도 기존 registry signature가 있어야 함');
assert.match(gas, /trustedV2CompletedAt[\s\S]*legacySupersededByTrustedV2/, 'maintenance dry-run도 newer trusted v2로 legacy stale 판정');
assert.match(gas, /sourceSignature/);
assert.match(gas, /copySignatureDrift/);
assert.match(gas, /_setCodeColumnText\(backup, codeColumn\)[\s\S]*SpreadsheetApp\.flush\(\)[\s\S]*var backupSignature = _sheetContentSignature\(backup\)/, 'backup signature 전에 copyTo·서식 변경 flush');
assert.match(gas, /미완료 registry 상태/);
assert.match(gas, /기타 안전 조건 불충족/);
assert.match(gas, /보존 사유/);
assert.match(gas, /grouped\[reason\]\.count\+\+/);
assert.match(gas, /names\.length < 3/, '백업 진단 대표 시트명은 사유별 최대 3개만 표시');

const protectionFn = gas.match(/function _systemBackupProtectionSummaryLines\([\s\S]*?\n\}/)?.[0] || '';
const protectionContext = {};
vm.runInNewContext(`${protectionFn}\nglobalThis.formatProtection=_systemBackupProtectionSummaryLines;`, protectionContext);
const protectionLines = protectionContext.formatProtection('스냅샷', {
  protected: [
    { name: '스냅샷_백업_A', reason: 'WRITE_FAILED · 복구 검증 없음' },
    { name: '스냅샷_백업_B', reason: 'WRITE_FAILED · 복구 검증 없음' },
    { name: '스냅샷_백업_C', reason: 'WRITE_FAILED · 복구 검증 없음' },
    { name: '스냅샷_백업_D', reason: 'WRITE_FAILED · 복구 검증 없음' },
    { name: '스냅샷_백업_E', reason: '수식 참조 존재' },
  ]
});
assert.equal(protectionLines.length, 2, '보존 사유별로 집계');
assert.match(protectionLines[0], /WRITE_FAILED · 복구 검증 없음: 4개/);
assert.match(protectionLines[0], /외 1개/, '대표 3개 초과분은 개수로 축약');
assert.doesNotMatch(protectionLines[0], /스냅샷_백업_D/, '대표 시트명 4번째부터 숨김');
assert.match(protectionLines[1], /수식 참조 존재: 1개/);

const reasonFn = gas.match(/function _systemBackupProtectionReason_\([\s\S]*?\n\}/)?.[0] || '';
const reasonContext = { SYSTEM_BACKUP_SIGNATURE_VERSION: 'backup-content-v2' };
vm.runInNewContext(`${reasonFn}\nglobalThis.protectionReason=_systemBackupProtectionReason_;`, reasonContext);
assert.equal(reasonContext.protectionReason(
  { operationHasCreatedBackup:false, formulaReferenceCount:0, signatureMatch:false, signatureVersion:'', classification:'REGISTERED_COMPLETED', status:'COMPLETED' },
  { registeredSourceExists:true, safeClass:true, registeredFailed:false }
), 'legacy signature 불일치 · 자동 재서명 금지');
assert.equal(reasonContext.protectionReason(
  { operationHasCreatedBackup:false, formulaReferenceCount:0, signatureMatch:false, signatureVersion:'backup-content-v2', classification:'REGISTERED_COMPLETED', status:'COMPLETED' },
  { registeredSourceExists:true, safeClass:true, registeredFailed:false }
), 'content signature 불일치');
assert.equal(reasonContext.protectionReason(
  { operationHasCreatedBackup:false, formulaReferenceCount:0, signatureMatch:true, classification:'REGISTERED_INCOMPLETE', status:'CREATED' },
  { registeredSourceExists:true, safeClass:true, registeredFailed:false }
), '미완료 registry 상태 · CREATED');
assert.equal(reasonContext.protectionReason(
  { operationHasCreatedBackup:true, formulaReferenceCount:0, signatureMatch:true, classification:'REGISTERED_INCOMPLETE', status:'CREATED' },
  { registeredSourceExists:true, safeClass:true, registeredFailed:false }
), '미완료 registry 상태 · CREATED', 'CREATED 자체는 실제 active로 오표시하지 않음');
assert.equal(reasonContext.protectionReason(
  { operationHasCreatedBackup:true, formulaReferenceCount:0, signatureMatch:true, classification:'REGISTERED_COMPLETED', status:'COMPLETED' },
  { registeredSourceExists:true, safeClass:true, registeredFailed:false }
), '동일 operation에 미완료 CREATED 백업 존재', '같은 operation의 완료 backup은 미완료 sibling 존재를 명시');

assert.equal(reasonContext.protectionReason(
  { operationHasCreatedBackup:false, formulaReferenceCount:0, signatureMatch:true, classification:'REGISTERED_WRITE_FAILED', status:'WRITE_FAILED' },
  { registeredSourceExists:true, safeClass:true, registeredFailed:true }
), 'WRITE_FAILED · 복구 검증 없음');
assert.equal(reasonContext.protectionReason(
  { operationHasCreatedBackup:false, formulaReferenceCount:0, signatureMatch:true, classification:'UNKNOWN', status:'' },
  { registeredSourceExists:true, safeClass:false, registeredFailed:false }
), 'USER_MANAGED/UNKNOWN 보호');

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
assert.doesNotMatch(gas.match(/function _reconcileSystemBackups[\s\S]*?\n}/)?.[0] || '', /_systemBackupTimestampFromName\(name\)|status: 'COMPLETED'|_writeSystemBackupRegistry/, '미등록 orphan은 원본 생성시각/서명 추측 없이 보호만 보고해야 합니다.');
assert.match(gas, /remainingCells < minimumCreationCells[\s\S]*_cleanupSystemBackups\(ss, sourceName, false\)[\s\S]*_fundSheetCapacity\(ss\)/, '셀 부족 cleanup은 orphan reconciliation 없이 재계산해야 합니다.');
assert.match(gas, /가격이력 쓰기 후 검증 실패[\s\S]*_cleanupCurrentSystemBackup\(ss, backup\)/, '가격이력 repair 성공 후 현재 operation backup을 정리해야 합니다.');
assert.match(gas, /safeClass && registeredSourceExists && !item\.orphanAdopted &&[\s\S]*\(item\.signatureMatch \|\| legacySupersededByTrustedV2\)/, '등록된 신뢰 완료본만 서명 검증 후 정리하고 adopted orphan은 보호');
assert.match(gas, /Snapshot 중복 정리 후 raw 검증 실패[\s\S]*_markSnapshotBackupStatus\(backup, 'COMPLETED'\)/, 'raw 검증이 COMPLETED 및 backup 삭제보다 먼저여야 합니다.');
const currentCleanupBody=gas.match(/function _cleanupCurrentSystemBackup[\s\S]*?\n}/)?.[0] || '';
assert.doesNotMatch(currentCleanupBody, /_reconcileSystemBackups|getSheets\(/, '현재 operation FAST PATH는 orphan/workbook sheet scan을 하면 안 됩니다.');
assert.match(currentCleanupBody, /staleCandidates\.length[\s\S]*_sheetFormulaReferenceCounts/, 'formula scan은 같은 source stale registry candidate가 있을 때만 1회 실행');
assert.doesNotMatch(gas.match(/function cleanupSnapshotDuplicates[\s\S]*?\n}/)?.[0] || '', /Object\.keys\(dates\)[\s\S]*_readRawSnapshotRowsByDate/, 'cleanup 초기 분류에서 날짜별 전체 Snapshot 재읽기 금지');
assert.doesNotMatch(gas, /최신 유효 백업은 source별 1개 보존/, '유지보수 안내문은 system backup 0개 정책과 일치해야 합니다.');
assert.match(gas, /GOOGLE_SHEETS_CELL_LIMIT = 10000000/, 'Google Sheets 파일당 10M cell 한도');
assert.match(gas, /deleteColumns[\s\S]*insertRowsAfter/, 'tall\/narrow backup은 열 축소 후 행 확장');
assert.match(gas, /if \(operationId\)[\s\S]*operationRecord[\s\S]*var sourceSignature = _sheetContentSignature/, '동일 operation backup은 source 전체 signature 전에 재사용');
assert.match(gas, /afterIntegrity\.status !== 'VALID'[\s\S]*state\.validatedOperationIds\.push\(repairOperationId\)/, 'VALID 재진단 operation만 cleanup 증명에 포함');
assert.match(gas, /else if \(state\.failed === 0\) state\.backupCleanup = maintainSystemBackups\(\{ apply: true, validatedOperationIds: state\.validatedOperationIds \}\)/, '성공한 full repair만 검증 operation 한정 cleanup');
assert.match(gas, /writeFailedCount:[\s\S]*writeFailed:/, 'backup summary count와 name 목록 key 분리');
assert.match(gas, /function maintainSystemBackups[\s\S]*hasLock\(\)[\s\S]*_planSystemBackupMaintenance/, 'maintenance apply는 lock 뒤 plan 재계산');
assert.match(gas, /function _settleSnapshotBackupOperation[\s\S]*succeeded \? 'COMPLETED' : 'WRITE_FAILED'/, 'operation backup은 공통 finalize/fail 경로를 사용');
assert.match(gas, /if \(!_snapshotBackupOperationId\) _markSnapshotBackupStatus\(snapshotBackupRecord, 'COMPLETED'\)/, '다일자 write는 개별 날짜에서 COMPLETED 승격 금지');
assert.match(gas, /failedExisting[\s\S]*실패한 Snapshot operationId는 재사용할 수 없습니다/, '실패 operationId 재사용 차단');
assert.match(gas, /after\.status !== 'VALID'[\s\S]*_settleSnapshotBackupOperation\(ss, rewriteOperationId, true\)/, 'rewrite VALID 뒤에만 finalize');
assert.match(gas, /errors\.length \? _settleSnapshotBackupOperation\(ss, rebuildOperationId, false[\s\S]*: _settleSnapshotBackupOperation\(ss, rebuildOperationId, true/, 'rebuild partial failure는 rollback backup 보존');
assert.match(gas, /dailyRewritePlan\.unsafe\.length[\s\S]*diagnoseSnapshotIntegrity\(ss, snapshotDate\)[\s\S]*status !== 'VALID'/, '일일 저장은 protected conflict 및 최종 비VALID를 성공 처리하면 안 됨');
assert.match(gas, /Object\.assign\(\{\}, operationRecord, \{ reused: true \}\)/, 'operation backup reuse는 provenance 전체 보존');
assert.match(gas, /var complete = Object\.assign\(\{\}, existing, record\)/, '상태 전환은 기존 registry metadata와 병합');
assert.match(gas, /sourceName === CONFIG\.SHEET_SNAPSHOT && repairState/, 'Snapshot repair operationId는 Snapshot source에만 자동 적용');
assert.match(gas, /validatedOperationIds\[item\.operationId\][\s\S]*item\.source === CONFIG\.SHEET_SNAPSHOT/, 'validated cleanup은 실제 VALID operationId와 Snapshot source로 제한');
assert.match(gas, /item\.status === 'COMPLETED' && item\.orphanAdopted !== true && signatureMatches\(item\)/, '용량 cleanup은 기존 adopted orphan 제외·registry signature 일치 필요');
assert.match(gas, /expected\.length === 0[\s\S]*lifecycleRemovedRows === 0[\s\S]*writeSnapshotRows\(ss, snapshotDate, existing, true, null, repairFundConfigs\)[\s\S]*afterDuplicateCleanup\.duplicateKeys\.length/, 'expected 없는 EXACT_DUPLICATE 또는 0좌 lifecycle 잔존도 실제 축약 후 raw 재진단');
assert.match(gas, /function\(record\)[\s\S]*record\.operationId !== operationId[\s\S]*_sheetContentSignature\(candidate\) === record\.signature/, '동일 operation backup은 backup 자체 signature 검증 후 재사용');
assert.match(gas, /fundRewritePlan\.unsafe\.length[\s\S]*snapshotOperationUnsafe = true/, '펀드 평가 protected conflict 성공 집계 금지');
assert.match(gas, /repairPlan\.unsafe\.length[\s\S]*snapshotCount: 0/, '가격·Snapshot repair protected conflict 성공 집계 금지');
assert.match(gas, /backfillPlan\.unsafe\.length[\s\S]*throw new Error\('Snapshot 보호 충돌:/, 'backfill protected conflict 성공 집계 금지');
assert.match(gas, /savePlan\.unsafe\.length[\s\S]*return jsonError\('Snapshot 보호 충돌:/, '직접 Snapshot 저장 protected conflict 성공 응답 금지');
assert.match(gas, /matchIndexes\.length > 1[\s\S]*_snapshotRewritePlan[\s\S]*writeSnapshotRows/, '펀드 import duplicate는 첫 행만 갱신하지 않음');
assert.match(gas, /snapshotRebuild\.errors[\s\S]*Snapshot rebuild 부분 실패[\s\S]*_markSnapshotBackupStatus\(tradeBackup, 'COMPLETED'\)/, '거래 Snapshot 부분 실패는 backup 완료·삭제 전에 오류 처리');
assert.match(gas, /saveDailyPriceHistory\|[\s\S]*writeSnapshotRows\(ss, snapshotDate[\s\S]*diagnoseSnapshotIntegrity\(ss, snapshotDate\)[\s\S]*_settleSnapshotBackupOperation\(ss, snapshotOperationId, true\)/, '일일 Snapshot은 최종 VALID 뒤 operation settle');
assert.match(gas, /repairPriceAndSnapshotForDate\|[\s\S]*writeSnapshotRows\(ss, normDate, snapRows, true, null, repairFundConfigs\)[\s\S]*_snapshotIntegritySatisfied\(repairIntegrity\)[\s\S]*_settleSnapshotBackupOperation\(ss, snapshotOperationId, true\)/, '날짜 복구는 VALID 또는 정상적인 빈 Snapshot 검증 뒤 operation settle');
assert.match(gas, /lifecycleRemovedHoldings[\s\S]*repairPlan\.needsRewrite[\s\S]*writeSnapshotRows\(ss, normDate, snapRows, true, null, repairFundConfigs\)/, '수동 복구는 0좌-only holdings도 빈 기대 결과로 실제 재작성');
assert.match(gas, /emptyBackfillPlan\.lifecycleRemovedRows > 0[\s\S]*writeSnapshotRows\(ss, dateStr, emptyBackfillPlan\.raw, true, null, fundConfigsBf\)[\s\S]*_finalizeBackfillSnapshotOperation\(ss, dateStr, backfillOperationId\)[\s\S]*totalSuccess\+\+/, '소급채우기는 0좌-only 날짜도 빈 Snapshot 정리 후 성공 집계');
assert.match(gas, /backfillOperationId[\s\S]*writeSnapshotRows\(ss, dateStr[\s\S]*batchUpsertPriceHistory[\s\S]*_finalizeBackfillSnapshotOperation\(ss, dateStr, backfillOperationId\)[\s\S]*totalSuccess\+\+/, 'backfill 연관 write·검증 완료 전 성공 집계 금지');
assert.match(gas, /function _snapshotIntegritySatisfied[\s\S]*status === 'NO_SNAPSHOT'[\s\S]*expectedRowCount[\s\S]*storedRowCount/, '기대·저장 모두 0인 NO_SNAPSHOT만 정상 빈 상태로 인정');
assert.match(gas, /function _finalizeBackfillSnapshotOperation[\s\S]*SpreadsheetApp\.flush\(\)[\s\S]*diagnoseSnapshotIntegrity[\s\S]*_snapshotIntegritySatisfied\(integrity\)[\s\S]*_settleSnapshotBackupOperation\(ss, operationId, true\)/, 'backfill은 검증된 정상 또는 0\/0 빈 Snapshot 뒤에만 success settle');


// #507 production VM: orphan has no source-at-copy provenance. Neither the
// registry reconciler nor the maintenance planner may promote or auto-delete
// it, including historical orphanAdopted COMPLETED records. No live resources.
{
  const grab=name=>{
    const a=gas.indexOf('function '+name+'('),end=gas.indexOf('\n}',a);
    assert.ok(a>=0&&end>a,'missing production backup function '+name);
    return gas.slice(a,end+2);
  };
  const names=['_reconcileSystemBackups','_planSystemBackupMaintenance',
    '_cleanupSystemBackups','_cleanupCurrentSystemBackup','_systemBackupProtectionReason_'];
  const original=names.map(grab).join('\n');
  const target='스냅샷_백업_20261021_090701_f7a0f4';
  function makeOrphanFixture(initialRegistry=[]){
    const state={registry:JSON.parse(JSON.stringify(initialRegistry)),
      registryWrites:0,deleted:[],reads:0};
    const source={getName:()=> '스냅샷'};
    const backup={getName:()=>target,getMaxRows:()=>1000,
      getMaxColumns:()=>12};
    const sheets=[source,backup];
    const ss={getSheets:()=>sheets,
      getSheetByName:name=>sheets.find(x=>x.getName()===name)||null,
      deleteSheet:sheet=>{state.deleted.push(sheet.getName());sheets.splice(sheets.indexOf(sheet),1)}};
    const ctx=vm.createContext({
      JSON,Object,Array,Number,String,Date,Math,
      CONFIG:{SHEET_SNAPSHOT:'스냅샷'},
      SYSTEM_BACKUP_SIGNATURE_VERSION:'backup-content-v2',
      SYSTEM_BACKUP_KEEP_BY_SOURCE:{'스냅샷':0},
      _readSystemBackupRegistry:()=>JSON.parse(JSON.stringify(state.registry)),
      _writeSystemBackupRegistry:records=>{state.registryWrites++;state.registry=JSON.parse(JSON.stringify(records))},
      _backupSourceFromSystemName:name=>name===target?'스냅샷':'',
      _isGasReferencedSheet:()=>false,
      _sheetFormulaReferenceCount:()=>0,
      _sheetFormulaReferenceCounts:()=>({}),
      _sheetContentSignature:sheet=>sheet===backup?'SELF_SIGNED':'SOURCE_SIGNED',
      _sheetHeaderSignature:sheet=>sheet===backup||sheet===source?'SCHEMA_V12':'',
      _backupTimeMillis:()=>1,
      _diagnoseWorkbookCells:()=>({totalCells:12000,remainingCells:9000000,
        sheets:[{name:target,backup:true,allocatedCells:12000,
          formulaReferenceCount:0,signatureMatch:true}],
        backupSummary:{sheetCount:1}})
    });
    vm.runInContext(original,ctx,{timeout:3000});
    return{ss,ctx,state};
  }
  const orphan=makeOrphanFixture();
  const result=orphan.ctx._reconcileSystemBackups(orphan.ss);
  assert.equal(result.reconciled.length,0,'unregistered orphan is never marked completed');
  assert.equal(result.unresolved.length,1);
  assert.equal(result.unresolved[0].classification,'ORPHAN_LIKELY_SYSTEM');
  assert.equal(orphan.state.registryWrites,0,'read-only reconciler must never touch Properties');
  assert.equal(orphan.state.registry.length,0);
  const plan=orphan.ctx._planSystemBackupMaintenance(orphan.ss,{});
  assert.equal(plan.backupSheets[0].classification,'ORPHAN_LIKELY_SYSTEM');
  assert.equal(plan.backupSheets[0].autoCleanupEligible,false);
  assert.equal(plan.expectedReleasedCells,0,'unregistered orphan is never deletion candidate');
  assert.match(plan.backupSheets[0].protectionReason,/미등록 backup/);
  const dry=orphan.ctx._cleanupSystemBackups(orphan.ss,'스냅샷');
  assert.equal(dry.deletedCount,0);
  assert.equal(orphan.state.deleted.length,0);
  const adopted={name:target,source:'스냅샷',operationId:'reconciled-orphan',
    systemGenerated:true,orphanAdopted:true,status:'COMPLETED',
    signature:'SELF_SIGNED',signatureVersion:'backup-content-v2',
    sourceSignature:'',createdAt:'2026-10-21T00:07:01.000Z'};
  const older=makeOrphanFixture([adopted]);
  const adoptedPlan=older.ctx._planSystemBackupMaintenance(older.ss,{});
  assert.equal(adoptedPlan.backupSheets[0].classification,'REGISTERED_COMPLETED');
  assert.equal(adoptedPlan.backupSheets[0].autoCleanupEligible,false);
  assert.equal(adoptedPlan.expectedReleasedCells,0);
  assert.match(adoptedPlan.backupSheets[0].protectionReason,/adopted orphan/);
  assert.equal(older.ctx._cleanupSystemBackups(older.ss,'스냅샷').deletedCount,0);
  assert.equal(older.state.deleted.length,0);
  const fast=older.ctx._cleanupCurrentSystemBackup(older.ss,adopted);
  assert.equal(fast.deleted,false);
  assert.match(fast.reason,/adopted orphan/);
  assert.equal(older.state.deleted.length,0);
  // Existing genuine registered completed backup remains eligible for
  // the current-source retention policy (here: keep 0).
  const real={...adopted,orphanAdopted:false,operationId:'operation-real',
    sourceSignature:'SOURCE_SIGNED'};
  const normal=makeOrphanFixture([real]);
  const normalPlan=normal.ctx._planSystemBackupMaintenance(normal.ss,{});
  assert.equal(normalPlan.backupSheets[0].autoCleanupEligible,true);
  assert.equal(normalPlan.expectedReleasedCells,12000);
  assert.equal(normal.ctx._cleanupSystemBackups(normal.ss,'스냅샷').deletedCount,1);
  assert.deepEqual(normal.state.deleted,[target]);
  // No real account IDs, codes, Snapshot values or GAS deployment touched.
  console.log('ISSUE507_ORPHAN_FAIL_CLOSED_PRODUCTION_CONTRACT_PASS');
}
