import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/gas/apps_script.gs', 'utf8');
const editorSource = fs.readFileSync('src/web/features/management/mgmt_editor.js', 'utf8');
assert.doesNotMatch(source.match(/function _getFundNavStatus[\s\S]*?\n}/)?.[0] || '', /_fundDerivedState/, '좌수 화면 초기 현황에서 Snapshot 전체 파생 상태를 계산하면 안 됩니다.');
assert.doesNotMatch(editorSource.match(/function _renderFundNavStatus[\s\S]*?\n}/)?.[0] || '', /completedDates/, '좌수 화면 초기 DOM에 전체 완료 날짜를 생성하면 안 됩니다.');
assert.match(source.match(/function handleGetFundUnits[\s\S]*?\n}/)?.[0] || '', /performance:[\s\S]*navStatusMs:[\s\S]*priceHistoryRows:[\s\S]*snapshotRows:/, '좌수 초기 조회 성능과 읽은 행 수를 응답해야 합니다.');
assert.match(source,/SYSTEM_BACKUP_KEEP_BY_SOURCE = \{ '스냅샷': 0, '거래이력': 0, '가격이력': 0, '펀드기준가격': 0, '펀드좌수': 0, '종목코드': 0 \}/,'정상 완료 system backup 0개 정책');
assert.match(source,/var deletable = candidates\.slice\(keep\)/,'COMPLETED 보존 초과 백업을 자동 정리');
assert.doesNotMatch(source,/item\.status === 'WRITE_FAILED'.*newestCompletedAt/,'더 최신 성공본만으로 WRITE_FAILED 해제 금지');
assert.match(source,/registeredFailed[\s\S]*validatedOperationIds\[item\.operationId\]/,'명시적 VALID operationId 증거로만 WRITE_FAILED 정리');
assert.doesNotMatch(source.match(/function handleRefreshFundValuations[\s\S]*?\n}/)?.[0] || '', /waitLock/, '복구 handler 전체 잠금 제거');
const clone = value => JSON.parse(JSON.stringify(value));
let held = false;
const lock = { hasLock: () => held, waitLock: () => { held = true; }, releaseLock: () => { held = false; } };
const scriptProperties = new Map();
let failRevisionPropertyWrite = false;
let uuidSequence = 0;
const context = vm.createContext({ console, Logger: { log() {} }, LockService: { getScriptLock: () => lock },
  SpreadsheetApp: { flush() {} }, PropertiesService: { getScriptProperties: () => ({
    getProperty(key) { return scriptProperties.has(key) ? scriptProperties.get(key) : null; },
    setProperty(key, value) { if (failRevisionPropertyWrite && key === 'snapshot_integrity_source_revision_v1') throw new Error('property quota'); scriptProperties.set(key, String(value)); }, deleteProperty(key) { scriptProperties.delete(key); }
  }) }, Utilities: { formatDate: d => d.toISOString().slice(0,10), getUuid: () => 'test-' + (++uuidSequence) } });
vm.runInContext(source, context);
context.today = () => '2026-09-09';

const realDiagnoseSnapshotIntegrity=context.diagnoseSnapshotIntegrity;
const realSettleSnapshotBackupOperation=context._settleSnapshotBackupOperation;
const realFetchFundNav=context._fetchFundNav;
let backfillSettles=[];
context.diagnoseSnapshotIntegrity=()=>({status:'VALID'});
context._settleSnapshotBackupOperation=(_ss,operationId,succeeded,message)=>{backfillSettles.push({operationId,succeeded,message});return [];};
context._finalizeBackfillSnapshotOperation({},'2026-01-02','backfill-test-valid');
assert.deepEqual(backfillSettles,[{operationId:'backfill-test-valid',succeeded:true,message:undefined}],'backfill VALID만 success settle 실행');
backfillSettles=[];
context.diagnoseSnapshotIntegrity=()=>({status:'PRICE_SUSPICIOUS'});
assert.throws(()=>context._finalizeBackfillSnapshotOperation({},'2026-01-02','backfill-test-invalid'),/PRICE_SUSPICIOUS/,'backfill non-VALID은 success settle 전 실패');
assert.deepEqual(backfillSettles,[],'backfill non-VALID success settle 금지');
context.diagnoseSnapshotIntegrity=realDiagnoseSnapshotIntegrity;
context._settleSnapshotBackupOperation=realSettleSnapshotBackupOperation;

// 한화 공식 API는 요청 범위의 C-RPe만 반환하고 미확정 클래스는 외부 조회하지 않습니다.
const fundFetchCalls=[];
context.UrlFetchApp={fetch(url, options){
  assert.equal(held,false,'한화 외부 API 호출 중 ScriptLock 미보유');
  fundFetchCalls.push({url,options});
  return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({list:[
    {wkdate:'2025-12-31',price:'900.25'}, {wkdate:'2026-01-02',price:'1000.25'},
    {wkdate:'2026-01-03',price:'1001.25'}
  ]})};
}};
assert.deepEqual(clone(context._fetchFundNav('HANWHA_2045_CRPE','2026-01-01','2026-01-02')),[
  {date:'2026-01-02',nav:1000.25}
]);
context.UrlFetchApp={fetch:()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({list:[{wktDate:'2026-01-02',price:'1000'}]})})};
assert.throws(()=>context._fetchFundNav('HANWHA_2045_CRPE','2026-01-01','2026-01-02'),/응답 필드 불일치: price,wktDate/,'잘못된 날짜 key는 빈 날짜 오류 대신 실제 key를 보고');

assert.equal(context._parseHanwhaNavDate('2026.01.08'),'2026-01-08','한화 점 구분 공시일을 API 전용 parser에서 정규화');
assert.equal(context._parseHanwhaNavDate('2026/01/08'),'2026-01-08');
assert.equal(context._parseHanwhaNavDate('20260108'),'2026-01-08');
assert.throws(()=>context._parseHanwhaNavDate('2026-01-08~2026-01-09'),/2026-01-08~2026-01-09/,'범위 문자열은 단일 공시일로 허용하지 않고 원문 표시');
assert.equal(fundFetchCalls[0].options.method,'get');
assert.match(fundFetchCalls[0].url,/hanwhafund\.co\.kr\/api\/fund\/dailyPrice\?fundCd=008942&period=&startDate=2026-01-01&endDate=2026-01-02/);
context.UrlFetchApp={fetch(url,options){
  fundFetchCalls.push({url,options});
  return {getResponseCode:()=>200,getContentText:()=>JSON.stringify([
    {gijunYmd:'20260101',gijunGa:'2,000.25'},
    {gijunYmd:'20260102',gijunGa:'2,001.50'}
  ])};
}};
assert.deepEqual(clone(context._fetchFundNav('KB_VALUE_ST','2026-01-01','2026-01-02')),[
  {date:'2026-01-01',nav:2000.25},{date:'2026-01-02',nav:2001.5}
],'F00002는 exact standard code FunETF NAV를 자동조회');
assert.match(fundFetchCalls[1].url,/funetf\.co\.kr\/api\/public\/product\/view\/fundnav\?fundCd=KR5223AQ0185/);
assert.match(fundFetchCalls[1].options.headers.Referer,/KR5223AQ0185/);
assert.throws(()=>context._fetchFundNav('FIDELITY_BIG4_S','2026-01-01','2026-01-02'),/AP399.*미확인/);
assert.equal(fundFetchCalls.length,2,'F00001과 F00002만 자동 외부조회');
context.UrlFetchApp={fetch:()=>({getResponseCode:()=>403,getContentText:()=>'<html>forbidden</html>'})};
assert.throws(()=>context._fetchFundNav('HANWHA_2045_CRPE','2026-01-01','2026-01-02'),/HTTP 403/);
context.UrlFetchApp={fetch:()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({list:[]})})};
assert.throws(()=>context._fetchFundNav('HANWHA_2045_CRPE','2026-01-01','2026-01-02'),/조회 결과 없음/,'빈 응답은 정상 조회로 처리하지 않음');

class Sheet {
  constructor(rows = []) { this.rows = clone(rows); this.writes = 0; this.copies = 0; this.failWrite = false; this.failCopy = false; this.maxRows = 10000; this.maxColumns = 26; this.name = ''; this.formats = {}; this.formulaText = ''; }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return Math.max(0, ...this.rows.map(r => r.length)); }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxColumns; }
  deleteColumns(start, count) { this.rows.forEach(row => row.splice(start - 1, count)); this.maxColumns -= count; }
  copyTo() { this.copies++; if (this.failCopy) throw new Error('지원되지 않는 작업입니다.'); this.backup = clone(this.rows); return { setName() {} }; }
  insertRowsAfter(_after, count) { this.maxRows += count; }
  appendRow(row) { this.rows.push(clone(row)); }
  getRange(row, col, nr, nc) {
    return { getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => this.rows[row-1+i]?.[col-1+j] ?? '')),
      getFormulas: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => i === 0 && j === 0 ? this.formulaText : '')),
      setValues: values => {
        if (this.failWrite) throw new Error('write failed');
        assert.equal(values.length, nr);
        this.writes++;
        values.forEach((v,i) => { assert.equal(v.length,nc); this.rows[row-1+i] ||= []; v.forEach((cell,j) => { this.rows[row-1+i][col-1+j] = cell; }); });
      }, setNumberFormat: format => { this.formats[col]=format; return this; }, setBackground() { return this; }, setFontColor() { return this; }, setFontWeight() { return this; } };
  }
}
const snap = (date, code, value, src='PRICE_HISTORY') => [date, code, code, 1, 50, 50, value, value, value-50, 0, src, src === 'MANUAL' ? '2026-01-02 12:00:00' : ''];
const header = Array(12).fill('header');
const ssFor = sheets => {
  const bindNames=()=>Object.entries(sheets).map(([name,sheet])=>{ sheet.name=name; return sheet; });
  bindNames();
  return {
    getId: () => 'test-spreadsheet',
    getSheetByName: name => sheets[name] || null,
    getSheets: () => bindNames(),
    insertSheet: name => { const sheet=new Sheet(); sheet.name=name; sheets[name]=sheet; return sheet; },
    deleteSheet: sheet => { delete sheets[sheet.name]; }
  };
};

// backup 생성 후 실제 시트 내용이 source signature와 달라져도 실제 backup signature를 registry에 저장합니다.
scriptProperties.delete('system_backup_registry_v1');
scriptProperties.delete('sheet_backup_signature|스냅샷');
scriptProperties.delete('sheet_backup_operation|스냅샷');
context._snapshotBackupOperationId='';
const signatureSource=new Sheet([header,snap('2026-01-01','000001',100)]);
const signatureSheets={'스냅샷':signatureSource};
const signatureSs=ssFor(signatureSheets);
const sourceSignatureBefore=context._sheetContentSignature(signatureSource);
const originalSetCodeColumnText=context._setCodeColumnText;
context._setCodeColumnText=(backup,column)=>{
  originalSetCodeColumnText(backup,column);
  backup.rows[0][0]='backup-copy-recalculated';
};
const signatureRecord=clone(context._backupSheetBeforeWrite(signatureSs,signatureSource,'스냅샷'));
context._setCodeColumnText=originalSetCodeColumnText;
const signatureBackup=signatureSheets[signatureRecord.name];
assert(signatureBackup,'signature test backup 생성');
assert.equal(signatureRecord.sourceSignature,sourceSignatureBefore,'복사 직전 source signature 별도 저장');
assert.equal(signatureRecord.signature,context._sheetContentSignature(signatureBackup),'registry signature은 실제 backup 내용 기준');
assert.equal(signatureRecord.signatureVersion,'backup-content-v2');
assert.equal(signatureRecord.copySignatureDrift,true,'source/backup signature 차이를 진단 metadata로 기록');
assert.notEqual(signatureRecord.signature,signatureRecord.sourceSignature,'copy 후 값 변화에도 source와 backup signature 혼용 금지');
const signatureRegistry=JSON.parse(scriptProperties.get('system_backup_registry_v1'));
assert.equal(signatureRegistry[0].signature,signatureRecord.signature);
assert.equal(signatureRegistry[0].sourceSignature,sourceSignatureBefore);

// 이후 테스트와 registry 상태를 분리합니다.
scriptProperties.delete('system_backup_registry_v1');
scriptProperties.delete('sheet_backup_signature|스냅샷');
scriptProperties.delete('sheet_backup_operation|스냅샷');

const storedFallback=clone(context._storedFundNavRows([
  ['2026-01-01','F00002','KB',1111,'2026-01-01',1000,1111,'','KB_VALUE_ST'],
  ['2026-01-02','F00002','KB',1112,'2026-01-02',1000,1112,'','WRONG_CLASS'],
  ['2026-01-02','F00003','피델리티',2222,'2026-01-02',1000,2222,'','FIDELITY_BIG4_S']
],'F00002','KB_VALUE_ST','2026-01-01','2026-01-02'));
assert.deepEqual(storedFallback,[{date:'2026-01-01',nav:1111}],'기존 NAV fallback도 같은 코드·클래스만 사용');
assert.deepEqual(clone(context._storedFundNavRows([
  ['2026-01-03','F00002','KB',1111,'2026-01-02',1000,1111,'','KB_VALUE_ST'],
  ['2026-01-04','F00002','KB',1111,'2026-01-02',1000,1111,'','KB_VALUE_ST']
],'F00002','KB_VALUE_ST','2026-01-01','2026-01-04')),[{date:'2026-01-02',nav:1111}],'휴일 평가행은 가격공시일 NAV 하나로 복원');

// 실제 저장 경로에서 같은 날짜·다른 날짜·수동값 보존을 검증합니다.
const a = snap('2026-01-02','000001',100,'MANUAL');
const b = snap('2026-01-02','000002',200);
const other = snap('2026-01-01','000003',300);
const sheet = new Sheet([header,a,b,other]);
sheet.failCopy = true;
const snapshotSheets = { '스냅샷': sheet };
const ss = ssFor(snapshotSheets);
context.writeSnapshotRows(ss,'2026-01-02',[snap('2026-01-02','000004',400)],false);
assert.equal(sheet.rows.length,5);
assert(sheet.rows.some(r => r[1]==='000001' && r[7]===100));
assert(sheet.rows.some(r => r[0]==='2026-01-01' && r[7]===300));
assert.equal(sheet.copies,0,'지원되지 않는 시트 copyTo를 호출하지 않음');
const backupName = Object.keys(snapshotSheets).find(name => name.startsWith('스냅샷_백업_'));
assert.equal(backupName,undefined,'검증 성공 후 임시 스냅샷 백업 즉시 삭제');
context.writeSnapshotRows(ss,'2026-01-02',[snap('2026-01-02','000001',1)],true);
assert.equal(sheet.rows.find(r=>r[1]==='000001')[7],100);
const beforeEmpty=clone(sheet.rows);
context.writeSnapshotRows(ss,'2026-01-02',[],true);
assert.deepEqual(sheet.rows,beforeEmpty);
context.writeSnapshotRows(ss,'2026-01-02',[snap('2026-01-02','000001',120,'MANUAL')],true,['000001']);
assert.equal(sheet.rows.find(r=>r[1]==='000001')[7],120);
const beforeFailure=clone(sheet.rows);
sheet.failWrite=true;
const revisionBeforeFailedWrite=scriptProperties.get('snapshot_integrity_source_revision_v1');
const backupCountBeforeFailure=Object.keys(snapshotSheets).filter(name=>name.startsWith('스냅샷_백업_')).length;
assert.throws(()=>context.writeSnapshotRows(ss,'2026-01-02',[snap('2026-01-02','000002',250)],true),/write failed/);
assert.deepEqual(sheet.rows,beforeFailure,'쓰기 실패 전 전체 시트를 비우면 안 됩니다.');
const backupCountAfterFailure=Object.keys(snapshotSheets).filter(name=>name.startsWith('스냅샷_백업_')).length;
assert.equal(backupCountAfterFailure,backupCountBeforeFailure+1,'원본 상태가 달라진 쓰기 직전 백업은 생성');
assert.throws(()=>context.writeSnapshotRows(ss,'2026-01-02',[snap('2026-01-02','000002',250)],true),/write failed/);
assert.equal(Object.keys(snapshotSheets).filter(name=>name.startsWith('스냅샷_백업_')).length,backupCountAfterFailure,'같은 원본 상태의 실패 재시도는 백업 중복 생성 방지');
assert.equal(scriptProperties.get('snapshot_integrity_source_revision_v1'),revisionBeforeFailedWrite,'Snapshot 쓰기 실패는 integrity revision을 확정하지 않음');
sheet.failWrite=false;
context.writeSnapshotRows(ss,'2026-01-02',[snap('2026-01-02','000002',250)],true);
context._registerSystemBackup({name:'reuse-regression',source:'스냅샷',signature:'sig',status:'WRITE_FAILED',systemGenerated:true,createdAt:'2026-01-01T00:00:00Z'});
context._markSnapshotBackupStatus({name:'reuse-regression',source:'스냅샷',signature:'sig',status:'WRITE_FAILED',systemGenerated:true,reused:true},'COMPLETED');
const reusedRegistry=JSON.parse(scriptProperties.get('system_backup_registry_v1'));
assert.equal(reusedRegistry.find(item=>item.name==='reuse-regression').status,'COMPLETED','WRITE_FAILED 복구본 재사용 성공을 COMPLETED로 승격');
const operationSheet=new Sheet([header,snap('2026-01-01','000001',100),snap('2026-01-02','000001',110)]);
const operationSheets={'스냅샷':operationSheet};
const operationSs=ssFor(operationSheets);
const operationUuidBefore=uuidSequence;
const integrityRevisionBefore=scriptProperties.get('snapshot_integrity_source_revision_v1');
context._snapshotBackupOperationId='multi-date-recovery';
context.writeSnapshotRows(operationSs,'2026-01-01',[snap('2026-01-01','000001',101)],true);
operationSheet.failWrite=true;
assert.throws(()=>context.writeSnapshotRows(operationSs,'2026-01-02',[snap('2026-01-02','000001',111)],true),/write failed/);
let failedOperationRecord=JSON.parse(scriptProperties.get('system_backup_registry_v1')).find(item=>item.operationId==='multi-date-recovery');
assert.equal(failedOperationRecord.status,'WRITE_FAILED','재사용 backup 쓰기 실패 상태 보존');
assert.equal(failedOperationRecord.systemGenerated,true,'재사용 상태 전환 뒤 system provenance 보존');
operationSheet.failWrite=false;
context.writeSnapshotRows(operationSs,'2026-01-02',[snap('2026-01-02','000001',111)],true);
const activeOperationRecord=JSON.parse(scriptProperties.get('system_backup_registry_v1')).find(item=>item.operationId==='multi-date-recovery');
assert.equal(activeOperationRecord.status,'WRITE_FAILED','후속 개별 성공은 operation 실패 상태를 완료로 덮어쓰지 않음');
assert(Object.keys(operationSheets).some(name=>name.startsWith('스냅샷_백업_')),'operation 종료 전 rollback backup 유지');
context._settleSnapshotBackupOperation(operationSs,'multi-date-recovery',true);
assert(!Object.keys(operationSheets).some(name=>name.startsWith('스냅샷_백업_')),'다일자 operation 전체 성공 후 backup 0개');
assert.equal(uuidSequence-operationUuidBefore,1,'하나의 다일자 논리 작업은 전체 Snapshot 백업을 한 번만 생성');
context._snapshotBackupOperationId='';
const corruptOperationSheet=new Sheet([header,snap('2026-01-01','000001',100),snap('2026-01-02','000001',110)]);
const corruptOperationSheets={'스냅샷':corruptOperationSheet};
const corruptOperationSs=ssFor(corruptOperationSheets);
context._snapshotBackupOperationId='corrupt-backup-recovery';
context.writeSnapshotRows(corruptOperationSs,'2026-01-01',[snap('2026-01-01','000001',101)],true);
const firstCorruptBackupName=Object.keys(corruptOperationSheets).find(name=>name.startsWith('스냅샷_백업_'));
corruptOperationSheets[firstCorruptBackupName].rows.push(snap('2025-12-31','999999',999));
const corruptUuidBefore=uuidSequence;
context.writeSnapshotRows(corruptOperationSs,'2026-01-02',[snap('2026-01-02','000001',111)],true);
assert.equal(uuidSequence-corruptUuidBefore,1,'내용이 변경된 동일 operation backup을 재사용하지 않고 새 backup 생성');
assert.equal(Object.keys(corruptOperationSheets).filter(name=>name.startsWith('스냅샷_백업_')).length,2,'손상 backup 보존 후 새 안전 backup 생성');
const corruptCleanupResults=clone(context._settleSnapshotBackupOperation(corruptOperationSs,'corrupt-backup-recovery',true));
assert.equal(corruptCleanupResults.filter(item=>item.deleted).length,1,'정상 signature의 새 operation backup은 성공 settle 후 정리');
assert(corruptOperationSheets[firstCorruptBackupName],'signature가 변경된 기존 operation backup은 성공 settle 후에도 보호');
const protectedCorruptRecord=JSON.parse(scriptProperties.get('system_backup_registry_v1')).find(item=>item.name===firstCorruptBackupName);
assert(protectedCorruptRecord&&protectedCorruptRecord.status==='COMPLETED','손상 backup registry record도 삭제하지 않고 보존');
assert(corruptCleanupResults.some(item=>item.name===firstCorruptBackupName&&!item.deleted&&/signature 불일치/.test(item.reason)),'손상 backup 보호 사유 반환');
context._snapshotBackupOperationId='';
assert.notEqual(scriptProperties.get('snapshot_integrity_source_revision_v1'),integrityRevisionBefore,'Snapshot 상세행 저장은 합계와 무관하게 integrity cache revision 갱신');
const isolatedBefore=clone(context._snapshotIntegrityDateRevisions(['2026-01-01','2026-01-02']));
context._touchSnapshotIntegritySourceRevision({date:'2026-01-02'});
const isolatedAfter=clone(context._snapshotIntegrityDateRevisions(['2026-01-01','2026-01-02']));
assert.equal(isolatedAfter['2026-01-01'],isolatedBefore['2026-01-01'],'Snapshot 하루 변경은 영향 없는 과거 날짜 revision 유지');
assert.notEqual(isolatedAfter['2026-01-02'],isolatedBefore['2026-01-02'],'Snapshot 변경 날짜 revision 갱신');
context._touchSnapshotIntegritySourceRevision({from:'2026-01-02'});
const rangeAfter=clone(context._snapshotIntegrityDateRevisions(['2026-01-01','2026-01-02','2026-01-03']));
assert(Object.values(rangeAfter).every(value=>/^\d+$/.test(value)),'normal touch revision은 정수 문자열');
assert.equal(rangeAfter['2026-01-01'],isolatedBefore['2026-01-01'],'거래/NAV 영향 시작일 이전 cache 유지');
assert.equal(rangeAfter['2026-01-02'],rangeAfter['2026-01-03'],'거래/NAV 영향 시작일 이후 범위 invalidation');
scriptProperties.delete('snapshot_integrity_source_revision_v1');
const missingMigrated=clone(context._getSnapshotIntegrityRevisionState());
assert(Number.isSafeInteger(missingMigrated.revision)&&/^\d+$/.test(String(missingMigrated.revision)),'property 없음 migration revision은 cache key에 사용할 수 있는 정수');
assert(Object.values(clone(context._snapshotIntegrityDateRevisions(['2026-01-01']))).every(value=>/^\d+$/.test(value)),'날짜별 revision 응답은 정수 문자열');
assert.deepEqual(clone(context._snapshotIntegrityImpactForRows('가격이력', [['2026-02-03'],['2026-02-03']])),{from:'2026-02-03'},'가격 변경은 carry 영향을 고려해 해당 평가일부터 이후를 invalidate');
assert.deepEqual(clone(context._snapshotIntegrityImpactForRows('스냅샷', [['2026-02-03'],['2026-02-03']])),{dates:['2026-02-03']},'Snapshot 상세행 변경은 해당 날짜만 invalidate');
assert.deepEqual(clone(context._snapshotIntegrityImpactForRows('펀드기준가격', [['2026-02-05'],['2026-02-03']])),{from:'2026-02-03'},'펀드 NAV 변경은 가장 이른 공시일부터 carry 이후 범위 invalidate');
assert.deepEqual(clone(context._snapshotIntegrityImpactForRows('거래이력', [['2026-03-05'],['2026-03-01']])),{from:'2026-03-01'},'거래 변경은 최초 변경 거래일부터 이후 범위 invalidate');
const longState={revision:10000,all:0,dates:{},ranges:[]};
for(let i=0;i<400;i++){const date=new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10);longState.dates[date]=100+i;}
for(let i=0;i<150;i++)longState.ranges.push({from:new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10),revision:1000+i});
context._saveSnapshotIntegrityRevisionState(longState);
const compactedRaw=scriptProperties.get('snapshot_integrity_source_revision_v1');
const compacted=JSON.parse(compactedRaw);
assert(compactedRaw.length<=7000,'365일 이상 dates와 다수 ranges도 단일 property 안전 상한 이내');
assert(compacted.all>0,'compact로 제거한 revision은 all로 승격해 invalidation 의미 유지');
assert(Number.isSafeInteger(compacted.revision)&&Number.isSafeInteger(compacted.all)
  && Object.values(compacted.dates).every(Number.isSafeInteger)
  && compacted.ranges.every(item=>Number.isSafeInteger(item.revision)),'compact 후 date/all/range revision은 모두 안전한 정수');
scriptProperties.set('snapshot_integrity_source_revision_v1','legacy-v9.141-revision');
const legacyMigrated=clone(context._getSnapshotIntegrityRevisionState());
assert(legacyMigrated.all>0&&legacyMigrated.revision===legacyMigrated.all,'legacy scalar revision은 전체 재진단 state로 migration');
assert(Number.isSafeInteger(legacyMigrated.revision)&&/^\d+$/.test(String(legacyMigrated.revision)),'legacy migration revision은 정수');
scriptProperties.set('snapshot_integrity_source_revision_v1','{"revision":12,"dates":');
const malformedMigrated=clone(context._getSnapshotIntegrityRevisionState());
assert(malformedMigrated.all>0&&malformedMigrated.revision===malformedMigrated.all,'malformed revision state는 전체 재진단 fallback');
assert(Number.isSafeInteger(malformedMigrated.revision)&&/^\d+$/.test(String(malformedMigrated.revision)),'malformed migration revision은 정수');
const beforePropertyFailure=scriptProperties.get('snapshot_integrity_source_revision_v1');
failRevisionPropertyWrite=true;
assert.throws(()=>context._touchSnapshotIntegritySourceRevision({date:'2026-04-01'}),/property quota/,'revision 저장 실패를 정상 확정하면 안 됨');
failRevisionPropertyWrite=false;
assert.equal(scriptProperties.has('snapshot_integrity_source_revision_v1'),false,'저장 실패 시 stale revision property 제거');
const afterPropertyFailure=clone(context._getSnapshotIntegrityRevisionState());
assert.notEqual(JSON.stringify(afterPropertyFailure),beforePropertyFailure,'다음 read는 stale state 대신 전체 migration');
const editSheet=(name,dates)=>({getName:()=>name,getRange:()=>({getValue:()=>dates[0],getValues:()=>dates.map(date=>[date])})});
const editRange=(sheet,{row=2,rows=1,column=1,columns=1,value='' }={})=>({getSheet:()=>sheet,getRow:()=>row,getNumRows:()=>rows,getColumn:()=>column,getNumColumns:()=>columns,getValue:()=>value});
const priceDateSheet=editSheet('가격이력',['2026-02-01']);
assert.deepEqual(clone(context._snapshotIntegrityImpactForEdit({range:editRange(priceDateSheet,{value:'2026-02-01'}),oldValue:'2026-01-01'})),{from:'2026-01-01'},'날짜 old→new 수정은 더 이른 old 날짜부터 invalidate');
const snapshotDateSheet=editSheet('스냅샷',['2026-02-01']);
assert.deepEqual(clone(context._snapshotIntegrityImpactForEdit({range:editRange(snapshotDateSheet,{value:'2026-02-01'}),oldValue:'2026-01-01'})),{dates:['2026-01-01','2026-02-01']},'Snapshot 날짜 수정은 old/new 날짜 모두 invalidate');
assert.deepEqual(clone(context._snapshotIntegrityImpactForEdit({range:editRange(priceDateSheet,{rows:2,value:'2026-02-01'}),oldValue:'2026-01-01'})),{all:true},'날짜열 다중 paste는 복원 불가능한 old 날짜 때문에 전체 fallback');
const multiTradeSheet=editSheet('거래이력',['2026-03-03','2026-03-01']);
assert.deepEqual(clone(context._snapshotIntegrityImpactForEdit({range:editRange(multiTradeSheet,{rows:2,column:3})})),{from:'2026-03-01'},'날짜 외 다중행 편집은 범위 전체 날짜 중 최소일부터 invalidate');
const structureRevisionBefore=scriptProperties.get('snapshot_integrity_source_revision_v1');
context.handleSnapshotIntegritySheetChange({changeType:'REMOVE_ROW',source:{getActiveSheet:()=>({getName:()=>'가격이력'})}});
assert.notEqual(scriptProperties.get('snapshot_integrity_source_revision_v1'),structureRevisionBefore,'tracked source 행 삭제는 전체 integrity cache를 invalidate');
const insertedRevisionBefore=scriptProperties.get('snapshot_integrity_source_revision_v1');
context.handleSnapshotIntegritySheetChange({changeType:'INSERT_ROW',source:{getActiveSheet:()=>({getName:()=>'거래이력'})}});
assert.notEqual(scriptProperties.get('snapshot_integrity_source_revision_v1'),insertedRevisionBefore,'tracked source 행 삽입은 전체 integrity cache를 invalidate');
['INSERT_COLUMN','REMOVE_COLUMN'].forEach(changeType=>{
  const before=scriptProperties.get('snapshot_integrity_source_revision_v1');
  context.handleSnapshotIntegritySheetChange({changeType,source:{getActiveSheet:()=>({getName:()=>'스냅샷'})}});
  assert.notEqual(scriptProperties.get('snapshot_integrity_source_revision_v1'),before,`${changeType} tracked source 구조 변경은 전체 invalidate`);
});
const removedGridRevision=scriptProperties.get('snapshot_integrity_source_revision_v1');
context.handleSnapshotIntegritySheetChange({changeType:'REMOVE_GRID',source:{getActiveSheet:()=>({getName:()=>'설정'})}});
assert.notEqual(scriptProperties.get('snapshot_integrity_source_revision_v1'),removedGridRevision,'REMOVE_GRID는 unrelated active sheet여도 삭제 source를 알 수 없으므로 전체 invalidate');
const insertedGridRevision=scriptProperties.get('snapshot_integrity_source_revision_v1');
context.handleSnapshotIntegritySheetChange({changeType:'INSERT_GRID',source:{getActiveSheet:()=>({getName:()=>'가격이력'})}});
assert.notEqual(scriptProperties.get('snapshot_integrity_source_revision_v1'),insertedGridRevision,'tracked source INSERT_GRID는 전체 invalidate');
const otherRevision=scriptProperties.get('snapshot_integrity_source_revision_v1');
context.handleSnapshotIntegritySheetChange({changeType:'OTHER',source:{getActiveSheet:()=>({getName:()=>'설정'})}});
assert.notEqual(scriptProperties.get('snapshot_integrity_source_revision_v1'),otherRevision,'OTHER는 rename/source identity 변경을 판별할 수 없어 전체 invalidate');
const nonStructuralRevision=scriptProperties.get('snapshot_integrity_source_revision_v1');
context.handleSnapshotIntegritySheetChange({changeType:'EDIT',source:{getActiveSheet:()=>({getName:()=>'가격이력'})}});
assert.equal(scriptProperties.get('snapshot_integrity_source_revision_v1'),nonStructuralRevision,'일반 셀 edit는 onChange에서 중복 invalidate하지 않음');
context.handleSnapshotIntegritySheetChange({changeType:'FORMAT',source:{getActiveSheet:()=>({getName:()=>'가격이력'})}});
assert.equal(scriptProperties.get('snapshot_integrity_source_revision_v1'),nonStructuralRevision,'FORMAT은 integrity 데이터가 아니므로 invalidate하지 않음');
const originalScriptApp=context.ScriptApp;
const currentSpreadsheet={getId:()=> 'spreadsheet'};
const trigger=(handler,sourceId)=>({getHandlerFunction:()=>handler,getTriggerSourceId:()=>sourceId});
const otherTargetTrigger=trigger('handleSnapshotIntegritySheetChange','other-spreadsheet');
const otherHandlerTrigger=trigger('otherHandler','spreadsheet');
const changeTriggers=[otherTargetTrigger,otherHandlerTrigger];
let changeTriggerCreates=0;
context.getss=()=>currentSpreadsheet;
context.ScriptApp={
  getProjectTriggers:()=>changeTriggers,
  deleteTrigger:item=>{const index=changeTriggers.indexOf(item);if(index>=0)changeTriggers.splice(index,1);},
  newTrigger:handler=>({forSpreadsheet:ss=>({onChange:()=>({create:()=>{changeTriggerCreates++;changeTriggers.push(trigger(handler,ss.getId()));}})})}),
};
assert.equal(context._ensureSnapshotIntegrityChangeTrigger(true),true);
assert.equal(context._ensureSnapshotIntegrityChangeTrigger(true),true);
assert.equal(changeTriggerCreates,1,'설치형 onChange trigger는 중복 생성하지 않음');
changeTriggers.push(trigger('handleSnapshotIntegritySheetChange','spreadsheet'));
assert.equal(context._ensureSnapshotIntegrityChangeTrigger(true),true);
assert.equal(changeTriggers.filter(item=>item.getHandlerFunction()==='handleSnapshotIntegritySheetChange'&&item.getTriggerSourceId()==='spreadsheet').length,1,'현재 spreadsheet의 중복 integrity trigger는 하나만 유지');
assert(changeTriggers.includes(otherTargetTrigger)&&changeTriggers.includes(otherHandlerTrigger),'다른 대상 또는 handler trigger는 삭제하지 않음');
context.ScriptApp=originalScriptApp;
assert.equal(operationSheet.formats[2],'@','Snapshot 종목코드 열을 텍스트 형식으로 고정');
assert.equal(held,false);
assert.throws(()=>context._readSnapshotRowsByDate({getSheetByName(){throw new Error('read failed');}},'2026-01-02'),/read failed/);
assert.equal((source.match(/function getEarliestPriceHistory\(/g)||[]).length,1);
assert.match(source,/fn === 'syncMortgageFromSchedule' \|\| fn === 'runDailyFundValuations' \|\| fn === 'onOpen'/,'전체 트리거 재등록은 기존 19시 펀드 트리거도 삭제');
assert.throws(()=>context.getEarliestPriceHistory({getSheetByName(){throw new Error('read failed');}},['000001'],'2026-01-02',true),/read failed/);

const configs = [
  {code:'F00001',name:'테스트 펀드',provider:'HANWHA_2045_CRPE',startDate:'2026-01-01',units:1000},
  {code:'F00001',name:'테스트 펀드',provider:'HANWHA_2045_CRPE',startDate:'2026-01-04',units:2000},
  {code:'F00001',name:'테스트 펀드',provider:'HANWHA_2045_CRPE',startDate:'2026-01-06',units:0},
];
const nav=[{date:'2025-12-31',nav:1000.25},{date:'2026-01-02',nav:1100.25},{date:'2026-01-07',nav:1200.25}];
const daily=clone(context._fundDailyValues(configs,'F00001',nav,'2025-12-30','2026-01-08'));
assert.equal(daily.length,5);
assert.deepEqual(daily.map(row=>row.date),['2026-01-01','2026-01-02','2026-01-03','2026-01-04','2026-01-05']);
assert.equal(daily[0].evalAmt,1000);
assert.equal(daily[2].sourceDate,'2026-01-02');
assert.equal(daily[3].evalAmt,2201);
assert.equal(daily[0].units,1000);
assert.equal(daily[3].units,2000,'추가매수 좌수는 변경일부터만 적용');
assert.equal(daily.some(row=>row.date>='2026-01-06'),false,'0좌 적용일 이후에는 평가금액을 생성하지 않음');
assert.throws(()=>context._fundDate('2026-02-30'));
assert.equal(context._fundDailyValues(configs,'F00001',[],'2026-01-01','2026-01-02').length,0);
assert.deepEqual(clone(context._fundDailyValues(configs,'F00001',[
  {date:'2026-01-03',nav:999}
],'2026-01-01','2026-01-02')),[],'미래 NAV를 과거 평가일에 사용하지 않음');

const completeValue={date:'2026-01-02',code:'F00002',name:'KB',nav:1000,sourceDate:'2026-01-02',units:1000,evalAmt:1000,provider:'KB_VALUE_ST',carried:false,inputRequired:false};
const completeNav=['2026-01-02','F00002','KB',1000,'2026-01-02',1000,1000,'','KB_VALUE_ST'];
const completePrice=['2026-01-02','F00002','KB',1000,'','FUND_NAV'];
const completeSnapshot=snap('2026-01-02','F00002',1000,'FUND_NAV');
assert.equal(context._fundValueNeedsProcessing(completeValue,completeNav,completePrice,completeSnapshot),false,'NAV·평가·가격이력·Snapshot 전체 정상은 생략');
const navWithoutEvaluation=completeNav.slice(); navWithoutEvaluation[6]='';
assert.equal(context._fundValueNeedsProcessing(completeValue,navWithoutEvaluation,completePrice,completeSnapshot),true,'NAV 존재·평가금액 누락은 보완');
assert.equal(context._fundValueNeedsProcessing(completeValue,completeNav,null,completeSnapshot),true,'평가금액 존재·가격이력 누락은 보완');
assert.equal(context._fundValueNeedsProcessing(completeValue,completeNav,completePrice,null),true,'가격이력 존재·Snapshot 누락은 보완');
const carryPrice=['2026-01-02','F00002','KB',900,'','FUND_NAV_CARRY_INPUT_REQUIRED'];
assert.equal(context._fundValueNeedsProcessing(completeValue,completeNav,carryPrice,snap('2026-01-02','F00002',900,'FUND_NAV_CARRY_INPUT_REQUIRED')),true,'신규 확정 NAV는 임시 평가를 교체');

// F00003은 2026-08-25 0좌 적용일부터 평가하지 않습니다.
const fidelity2026=[
  {code:'F00003',name:'피델리티 월드Big4 S',provider:'FIDELITY_BIG4_S',startDate:'2026-01-01',units:15933.037},
  {code:'F00003',name:'피델리티 월드Big4 S',provider:'FIDELITY_BIG4_S',startDate:'2026-08-25',units:0}
];
const fidelityBoundary=clone(context._fundDailyValues(fidelity2026,'F00003',[
  {date:'2026-08-24',nav:1234.56},{date:'2026-08-25',nav:1235.67}
],'2026-08-24','2026-08-26'));
assert.deepEqual(fidelityBoundary.map(row=>row.date),['2026-08-24']);
assert.equal(fidelityBoundary[0].evalAmt,Math.round(15933.037*1234.56/1000));
assert.equal(context._fundDailyValues(fidelity2026,'F00003',[{date:'2026-08-25',nav:1235.67}],'2026-08-25','2026-08-31').length,0,'F00003 8/25~8/31 0좌 평가 제외');
const fidelityStatus=clone(context._getFundNavStatus(ssFor({
  '펀드기준가격':new Sheet([['date','code','name','nav','sourceDate','units','eval','at','provider'],['2026-08-24','F00003','피델리티 월드Big4 S',1234.56,'2026-08-24',15933.037,19669,'','FIDELITY_BIG4_S']])
}),fidelity2026)).find(item=>item.code==='F00003');
assert.equal(fidelityStatus.inputRequiredDates.some(date=>date>='2026-08-25'),false,'F00003 0좌 이후는 NAV 누락 목록에서 제외');
assert(fidelityStatus.zeroUnitsExcluded>0,'F00003 0좌 제외 상태를 현황에 반환');

const duplicatePriceConfigs=[{code:'F00002',name:'KB',provider:'KB_VALUE_ST',startDate:'2026-09-08',units:1000}];
const duplicatePriceBase={
  '펀드기준가격':new Sheet([['date','code','name','nav','sourceDate','units','eval','at','provider'],['2026-09-08','F00002','KB',1200,'2026-09-08',1000,1200,'','KB_VALUE_ST']])
};
const manualRepresentative=clone(context._getFundNavStatus(ssFor({...duplicatePriceBase,
  '가격이력':new Sheet([['date','code','name','price','at','source'],['2026-09-09','F00002','KB',1200,'','FUND_NAV_CARRY_INPUT_REQUIRED'],['2026-09-09','F00002','KB',1250,'','MANUAL']])
}),duplicatePriceConfigs))[0];
assert.equal(manualRepresentative.temporaryDates.includes('2026-09-09'),false,'중복 가격행은 MANUAL 대표행을 우선해 오래된 carry 경고를 제거');
const confirmedRepresentative=clone(context._getFundNavStatus(ssFor({...duplicatePriceBase,
  '가격이력':new Sheet([['date','code','name','price','at','source'],['2026-09-09','F00002','KB',1200,'','FUND_NAV_CARRY_INPUT_REQUIRED'],['2026-09-09','F00002','KB',1250,'','FUND_NAV']])
}),duplicatePriceConfigs))[0];
assert.equal(confirmedRepresentative.temporaryDates.includes('2026-09-09'),false,'확정 FUND_NAV는 오래된 carry input required보다 우선');
assert.equal(context._preferFundRepresentativeRow(['','','',1200, '', 'FUND_NAV_CARRY'],['','','',1100, '', 'FUND_NAV'],5,3,null),true,'FUND_NAV는 일반 carry보다 우선');
assert.equal(context._preferFundRepresentativeRow(['','','',1300, '', 'FUND_NAV'],['','','',1200, '', 'MANUAL'],5,3,null),true,'MANUAL은 FUND_NAV보다 우선');
assert.equal(context._preferFundRepresentativeRow(['','','',1200, '', 'FUND_NAV'],['','','',1250, '', 'FUND_NAV'],5,3,null),true,'동일 source rank는 history와 같이 큰 평가값을 deterministic 대표로 선택');
const carryRepresentative=clone(context._getFundNavStatus(ssFor({...duplicatePriceBase,
  '가격이력':new Sheet([['date','code','name','price','at','source'],['2026-09-09','F00002','KB',1200,'','FUND_NAV_CARRY_INPUT_REQUIRED']])
}),duplicatePriceConfigs))[0];
assert.equal(carryRepresentative.temporaryDates.includes('2026-09-09'),true,'실제 대표행이 carry input required이면 임시 평가 유지');
for (const legacyCode of ['', 'BROKEN']) {
  const legacyRepresentative=clone(context._getFundNavStatus(ssFor({...duplicatePriceBase,
    '가격이력':new Sheet([['date','code','name','price','at','source'],['2026-09-09',legacyCode,'KB',1200,'','FUND_NAV_CARRY_INPUT_REQUIRED']])
  }),duplicatePriceConfigs))[0];
  assert.equal(legacyRepresentative.temporaryDates.includes('2026-09-09'),true,`legacy code '${legacyCode}'는 유일한 펀드명으로 F코드 fallback`);
}
const ambiguousConfigs=[...duplicatePriceConfigs,{code:'F00003',name:'KB',provider:'FIDELITY_BIG4_S',startDate:'2026-09-08',units:1000}];
const ambiguousStatus=clone(context._getFundNavStatus(ssFor({...duplicatePriceBase,
  '가격이력':new Sheet([['date','code','name','price','at','source'],['2026-09-09','','KB',1200,'','FUND_NAV_CARRY_INPUT_REQUIRED']])
}),ambiguousConfigs));
assert(ambiguousStatus.every(item=>!item.temporaryDates.includes('2026-09-09')),'모호한 펀드명은 임의 F코드로 fallback하지 않음');
const derivedRank=clone(context._fundDerivedState(ssFor({
  '가격이력':new Sheet([['date','code','name','price','at','source'],['2026-09-09','','KB',1200,'','FUND_NAV_CARRY_INPUT_REQUIRED'],['2026-09-09','','KB',1250,'','FUND_NAV']]),
  '스냅샷':new Sheet([['date','code','name','qty','costUnit','cost','evalUnit','eval','pnl','pct','source','at'],['2026-09-09','F00002','KB',1,1,1,1200,1200,1199,0,'FUND_NAV_CARRY_INPUT_REQUIRED',''],['2026-09-09','F00002','KB',1,1,1,1250,1250,1249,0,'FUND_NAV','']])
}),duplicatePriceConfigs));
assert.equal(derivedRank.priceKeys['2026-09-09|F00002'][5],'FUND_NAV','_fundDerivedState 가격 대표행도 공통 source rank 적용');
assert.equal(derivedRank.snapshotKeys['2026-09-09|F00002'][10],'FUND_NAV','Snapshot 중복도 확정 FUND_NAV를 임시 carry보다 우선');

// 과거 보유 후 전량 매도한 F코드도 이력 계산은 가능하지만 0좌 이후에는 다시 생성하지 않습니다.
const retiredConfigs=[
  {code:'F00003',name:'과거 펀드',provider:'FIDELITY_BIG4_S',startDate:'2024-01-01',units:10000},
  {code:'F00003',name:'과거 펀드',provider:'FIDELITY_BIG4_S',startDate:'2024-01-03',units:12500},
  {code:'F00003',name:'과거 펀드',provider:'FIDELITY_BIG4_S',startDate:'2024-01-05',units:8000},
  {code:'F00003',name:'과거 펀드',provider:'FIDELITY_BIG4_S',startDate:'2024-01-07',units:0},
];
const retiredDaily=clone(context._fundDailyValues(retiredConfigs,'F00003',[
  {date:'2024-01-01',nav:1000},{date:'2024-01-04',nav:1200},{date:'2024-01-08',nav:1500}
],'2024-01-01','2024-01-09'));
assert.deepEqual(retiredDaily.map(row=>[row.date,row.units,row.evalAmt]),[
  ['2024-01-01',10000,10000],['2024-01-02',10000,10000],['2024-01-03',12500,12500],
  ['2024-01-04',12500,15000],['2024-01-05',8000,9600],['2024-01-06',8000,9600]
]);

// NAV → 가격이력 → 전체 스냅샷 연결 및 재시도/수동값 보호.
const fundConfig = new Sheet([['code','name','provider','start','units','at'],['F00001','테스트 펀드','HANWHA_2045_CRPE','2026-01-01',1000,'']]);
const fundNav = new Sheet([['date','code','name','nav','sourceDate','units','eval','at','provider'],['2025-12-31','F00001','테스트 펀드',950,'2025-12-31',1000,950,'','HANWHA_2045_CRPE']]);
const prices = new Sheet([['date','code','name','price','at','source'],['2026-01-02','F00001','테스트 펀드',999,'2026-01-02 12:00:00','MANUAL']]);
const trades = new Sheet([Array(8).fill('header'),['2026-01-01','buy','계좌','테스트 펀드','F00001',1,800,'펀드'],['2026-01-01','buy','계좌','주식','000001',2,100,'주식'],['2024-01-01','buy','계좌','과거 펀드','F00003',10,900,'펀드'],['2025-08-25','sell','계좌','과거 펀드','F00003',10,1000,'펀드']]);
const snapshots = new Sheet([header,snap('2026-01-02','000001',300)]);
const sheets={'펀드좌수':fundConfig,'펀드기준가격':fundNav,'가격이력':prices,'거래이력':trades,'스냅샷':snapshots};
context._fetchFundNav=()=>[{date:'2026-01-01',nav:1000},{date:'2026-01-02',nav:1100}];
const realBuild=context._buildSnapshotRowsFromTradeAndPriceHistory;
context._buildSnapshotRowsFromTradeAndPriceHistory=(_ss,date)=>[snap(date,'000001',300)];
const result=context._refreshFundValuations(ssFor(sheets),'2026-01-01','2026-01-02');
assert.equal(result.saved,1);
assert.equal(result.fundResults.F00001.carried,1,'F00001 목요일은 직전 확정 NAV를 이월');
assert.equal(result.fundResults.F00001.navMissing,0,'F00001 월·목은 NAV 누락 집계에서 제외');
assert.equal(prices.rows.find(r=>r[0]==='2026-01-01')[5],'FUND_NAV_CARRY');
assert.equal(prices.rows.find(r=>r[0]==='2026-01-02')[3],999);
assert.equal(snapshots.rows.filter(r=>r[0]==='2026-01-01').length,2,'펀드만으로 신규 전체자산 스냅샷을 만들면 안 됩니다.');
const count=prices.rows.length;
context._fetchFundNav=()=>{ throw new Error('이미 저장된 정확한 클래스 NAV가 충분하면 조회하면 안 됩니다.'); };
let repeatBuildCalls=0;
context._buildSnapshotRowsFromTradeAndPriceHistory=()=>{ repeatBuildCalls++; return [snap('2026-01-01','000001',300)]; };
const repeatedComplete=context._refreshFundValuations(ssFor(sheets),'2026-01-01','2026-01-02');
assert.equal(repeatedComplete.saved,0);
assert.equal(repeatedComplete.fundResults.F00001.valuations,0,'정상 완료 날짜는 평가 처리 대상에서 제외');
assert.equal(repeatedComplete.fundResults.F00001.completedSkipped,2,'정상 완료 날짜 생략 건수 반환');
assert.equal(repeatBuildCalls,0,'정상 완료 날짜는 Snapshot 재구성 함수 호출 전에 제외');
assert.equal(prices.rows.length,count);
context._buildSnapshotRowsFromTradeAndPriceHistory=()=>[];
delete sheets['스냅샷'];
const incomplete=context._refreshFundValuations(ssFor(sheets),'2026-01-01','2026-01-02');
assert(incomplete.missingHoldings.length>0);
assert.equal(sheets['스냅샷'],undefined);
context._buildSnapshotRowsFromTradeAndPriceHistory=realBuild;

// 일부 누락일은 첫 누락일부터만 조회하고, 시작일이 휴일이면 lookback NAV를 이월합니다.
const partialFund = new Sheet([['code','name','provider','start','units','at'],['F00001','테스트 펀드','HANWHA_2045_CRPE','2026-01-01',1000,'']]);
const partialNav = new Sheet([['date','code','name','nav','sourceDate','units','eval','at','provider'],
  ['2026-01-01','F00001','테스트 펀드',900,'2025-12-31',1000,900,'','HANWHA_2045_CRPE']]);
const partialPrices = new Sheet([['date','code','name','price','at','source']]);
const partialTrades = new Sheet([Array(8).fill('header'),['2026-01-01','buy','계좌','테스트 펀드','F00001',1,800,'펀드']]);
const partialSheets = {'펀드좌수':partialFund,'펀드기준가격':partialNav,'가격이력':partialPrices,'거래이력':partialTrades};
let partialArgs;
context._fetchFundNav=(provider,from,to)=>{ partialArgs={provider,from,to}; return [{date:'2026-01-02',nav:1000}]; };
context._buildSnapshotRowsFromTradeAndPriceHistory=()=>[];
const partialResult=context._refreshFundValuations(ssFor(partialSheets),'2026-01-01','2026-01-04');
assert.deepEqual(partialArgs,{provider:'HANWHA_2045_CRPE',from:'2026-01-01',to:'2026-01-02'},'한화 startDate 제외 경계를 보정하되 실제 공시 예정일까지만 조회');
assert.equal(partialResult.navSaved,1,'공식 API가 실제 반환한 날짜만 확정 NAV로 저장');
assert.deepEqual(partialNav.rows.slice(1).map(row=>[row[0],row[4]]),[
  ['2026-01-01','2025-12-31'],['2026-01-02','2026-01-02']
]);
context._fetchFundNav=()=>{ throw new Error('평일 확정 NAV가 충분하면 주말 때문에 재조회하면 안 됩니다.'); };
assert.equal(context._refreshFundValuations(ssFor(partialSheets),'2026-01-02','2026-01-04').fundResults.F00001.apiRequested,0);
context._fetchFundNav=()=>[{date:'2026-01-05',nav:1100}];
const failedFundOnly=context._refreshFundValuations(ssFor({'펀드좌수':partialFund}),'2026-01-01','2026-01-02');
assert.equal(failedFundOnly.completionStatus,'partial');
assert.equal(failedFundOnly.fundResults.F00001.status,'partial','F00001 실패는 펀드별 결과로 반환');
context._buildSnapshotRowsFromTradeAndPriceHistory=realBuild;

// 과거 전량 매도 F코드는 보유 기간의 가격이력·스냅샷만 채우고 매도/0좌 이후에는 새 행을 만들지 않습니다.
const retiredFundSheet = new Sheet([['code','name','provider','start','units','at'],
  ['F00003','과거 펀드','FIDELITY_BIG4_S','2024-01-01',10000,''],
  ['F00003','과거 펀드','FIDELITY_BIG4_S','2024-01-03',0,'']]);
const retiredPricesSheet = new Sheet([['date','code','name','price','at','source']]);
const retiredTradesSheet = new Sheet([Array(8).fill('header'),
  ['2024-01-01','buy','계좌','과거 펀드','F00003',10,900,'펀드'],
  ['2024-01-03','sell','계좌','과거 펀드','F00003',10,1000,'펀드'],
  ['2024-01-01','buy','계좌','주식','000001',2,100,'주식']]);
const retiredSnapshotsSheet = new Sheet([header]);
const retiredNavSheet = new Sheet([['date','code','name','nav','sourceDate','units','eval','at','provider'],
  ['2024-01-01','F00003','과거 펀드',1000,'2024-01-01',10000,10000,'','FIDELITY_BIG4_S'],
  ['2024-01-02','F00003','과거 펀드',1100,'2024-01-02',10000,11000,'','FIDELITY_BIG4_S']]);
const retiredSheets={'펀드좌수':retiredFundSheet,'펀드기준가격':retiredNavSheet,'가격이력':retiredPricesSheet,'거래이력':retiredTradesSheet,'스냅샷':retiredSnapshotsSheet};
context._fetchFundNav=()=>{ throw new Error('F00003은 외부조회하면 안 됩니다.'); };
context._buildSnapshotRowsFromTradeAndPriceHistory=(_ss,date)=>[snap(date,'000001',300)];
const retiredResult=context._refreshFundValuations(ssFor(retiredSheets),'2024-01-01','2024-01-04');
assert.equal(retiredResult.saved,2);
assert.deepEqual(retiredPricesSheet.rows.slice(1).map(row=>[row[0],row[1],row[3]]),[['2024-01-01','F00003',10000],['2024-01-02','F00003',11000]]);
assert.equal(retiredSnapshotsSheet.rows.some(row=>row[0]>='2024-01-03' && row[1]==='F00003'),false);
assert.equal(Object.keys(context.calcHoldingsAtDate(retiredTradesSheet.rows.slice(1),'2024-01-04',{'과거 펀드':'F00003'})).some(name=>name==='과거 펀드'),false);
context._buildSnapshotRowsFromTradeAndPriceHistory=realBuild;
const zeroOnlySheets={'펀드좌수':new Sheet([['code','name','provider','start','units','at'],['F00003','과거 펀드','FIDELITY_BIG4_S','2024-01-01',0,'']])};
context._fetchFundNav=()=>{ throw new Error('0좌만 남은 F코드는 조회하면 안 됩니다.'); };
assert.equal(context._refreshFundValuations(ssFor(zeroOnlySheets),'2026-01-01','2026-01-02').saved,0);
const lifecycleHoldings={
  '과거 펀드':{code:'F00003',name:'과거 펀드',qty:10,costAmt:1000},
  '일반주식':{code:'000001',name:'일반주식',qty:2,costAmt:200}
};
context._applyFundUnitLifecycleToSnapshotHoldings(lifecycleHoldings,[
  {code:'F00003',startDate:'2024-01-01',units:10000},
  {code:'F00003',startDate:'2024-01-03',units:0}
],'2024-01-04');
assert.equal(lifecycleHoldings['과거 펀드'],undefined,'0좌 전환일 이후 F코드는 Snapshot holdings에서 제거');
assert.equal(lifecycleHoldings['일반주식'].qty,2,'일반 종목은 영향 없음');

const headerOnlyLifecycleUnits=new Sheet([['code','name','provider','start','units','at'],
  ['F00003','과거 펀드','FIDELITY_BIG4_S','2024-01-01',0,'']]);
const headerOnlyLifecycleSnapshot=new Sheet([header]);
const headerOnlyLifecycleSheets={'펀드좌수':headerOnlyLifecycleUnits,'스냅샷':headerOnlyLifecycleSnapshot};
const headerOnlyLifecycleSs=ssFor(headerOnlyLifecycleSheets);
context.writeSnapshotRows(headerOnlyLifecycleSs,'2024-01-04',[
  snap('2024-01-04','F00003',3000,'MANUAL'),
  snap('2024-01-04','000001',300,'PRICE_HISTORY')
],true);
assert.equal(headerOnlyLifecycleSnapshot.rows.some(row=>row[1]==='F00003'),false,'헤더-only Snapshot append 전 0좌 F코드 제거');
assert(headerOnlyLifecycleSnapshot.rows.some(row=>row[1]==='000001'),'헤더-only Snapshot의 정상 종목은 저장');

const missingLifecycleSheets={'펀드좌수':headerOnlyLifecycleUnits};
const missingLifecycleSs=ssFor(missingLifecycleSheets);
context.writeSnapshotRows(missingLifecycleSs,'2024-01-04',[snap('2024-01-04','F00003',3000,'MANUAL')],true);
assert.equal(!!missingLifecycleSheets['스냅샷'],false,'0좌 F코드만 들어온 신규 Snapshot은 빈 시트를 만들지 않음');

// F00001 batch 일부 timeout이어도 저장 NAV 기반 F00002/F00003 복구는 계속합니다.
const mixedUnits = new Sheet([['code','name','provider','start','units','at'],
  ['F00001','한화','HANWHA_2045_CRPE','2026-01-01',1000,''],
  ['F00002','KB','KB_VALUE_ST','2026-01-01',1000,''],
  ['F00003','피델리티','FIDELITY_BIG4_S','2026-01-01',1000,''],
  ['F00003','피델리티','FIDELITY_BIG4_S','2026-01-20',0,'']]);
const mixedNav = new Sheet([['date','code','name','nav','sourceDate','units','eval','at','provider'],
  ['2026-01-02','F00002','KB',2000,'2026-01-02',1000,2000,'','KB_VALUE_ST'],
  ['2026-01-02','F00003','피델리티',3000,'2026-01-02',1000,3000,'','FIDELITY_BIG4_S']]);
const mixedPrices = new Sheet([['date','code','name','price','at','source']]);
const mixedSs = ssFor({'펀드좌수':mixedUnits,'펀드기준가격':mixedNav,'가격이력':mixedPrices});
const mixedCalls=[];
context._fetchFundNav=(provider,from,to)=>{
  mixedCalls.push([provider,from,to]);
  if (provider==='HANWHA_2045_CRPE' && from === '2026-01-12' && to === '2026-01-14') throw new Error('한화 NAV API timeout');
  if (provider==='KB_VALUE_ST') {
    const rows=[];
    for (let cursor=new Date(from+'T00:00:00Z'), end=new Date(to+'T00:00:00Z'); cursor<=end; cursor.setUTCDate(cursor.getUTCDate()+1)) {
      const day=cursor.getUTCDay();
      if (day!==0 && day!==6) rows.push({date:cursor.toISOString().slice(0,10),nav:2000});
    }
    return rows;
  }
  return [{date:to,nav:1000}];
};
context._buildSnapshotRowsFromTradeAndPriceHistory=()=>[];
const mixed=context._refreshFundValuations(mixedSs,'2026-01-01','2026-01-31');
assert.equal(mixed.completionStatus,'partial');
assert.equal(mixed.fundResults.F00001.apiFailed,1);
assert.equal(mixed.fundResults.F00001.apiSuccess,8,'성공한 API batch NAV는 유지');
assert.equal(mixed.fundResults.F00002.storedNav,1);
assert(mixed.fundResults.F00002.apiRequested>0,'F00002 누락일은 exact standard-code 외부 NAV 자동조회');
assert.equal(mixed.fundResults.F00002.apiFailed,0,'F00002 정상 응답은 실패 없이 반영');
assert.equal(mixed.fundResults.F00002.inputRequiredDates.length,0,'F00002 자동조회 성공분은 입력 필요 경고 제거');
assert.equal(mixed.fundResults.F00003.storedNav,1);
assert.equal(mixed.fundResults.F00003.zeroUnitsExcluded,12,'0좌 이후 평가 제외');
assert(mixedCalls.some(call=>call[0]==='KB_VALUE_ST'),'F00002 자동조회 실행');
assert.equal(mixedCalls.filter(call=>call[0]==='FIDELITY_BIG4_S').length,0,'F00003 외부조회 금지 유지');
assert.equal(mixedCalls.filter(call=>call[1]==='2026-01-12' && call[2]==='2026-01-14').length,2,'보정된 실패 batch는 최초 호출 후 1회만 재시도');
const kbOnly=context._refreshFundValuations(mixedSs,'2026-01-01','2026-01-07','F00002');
assert.deepEqual(Object.keys(kbOnly.fundResults),['F00002'],'웹 요청이 F코드별로 독립 실행 가능');
context._buildSnapshotRowsFromTradeAndPriceHistory=realBuild;
context._fetchFundNav=realFetchFundNav;

// 다른 펀드 갱신 중에도 0좌 F00003 기존 Snapshot이 다시 병합되거나 완전성 검사에 포함되지 않습니다.
const staleZeroUnits=new Sheet([['code','name','provider','start','units','at'],
  ['F00002','KB','KB_VALUE_ST','2026-01-01',1000,''],
  ['F00003','피델리티','FIDELITY_BIG4_S','2026-01-01',1000,''],
  ['F00003','피델리티','FIDELITY_BIG4_S','2026-01-05',0,'']]);
const staleZeroNav=new Sheet([['date','code','name','nav','sourceDate','units','eval','at','provider'],
  ['2026-01-05','F00002','KB',2000,'2026-01-05',1000,2000,'','KB_VALUE_ST']]);
const staleZeroPrices=new Sheet([['date','code','name','price','at','source']]);
const staleZeroTrades=new Sheet([Array(8).fill('header'),
  ['2026-01-01','buy','계좌','KB','F00002',1,1500,'펀드'],
  ['2026-01-01','buy','계좌','피델리티','F00003',1,1000,'펀드']]);
const staleZeroSnapshots=new Sheet([header,snap('2026-01-05','F00003',3000,'MANUAL')]);
const staleZeroSs=ssFor({'펀드좌수':staleZeroUnits,'펀드기준가격':staleZeroNav,'가격이력':staleZeroPrices,'거래이력':staleZeroTrades,'스냅샷':staleZeroSnapshots});
context._buildSnapshotRowsFromTradeAndPriceHistory=()=>[];
const staleZeroResult=context._refreshFundValuations(staleZeroSs,'2026-01-05','2026-01-05','F00002',true);
assert.equal(staleZeroResult.missingHoldings.length,0,'0좌 F00003을 다른 펀드 갱신의 누락 보유로 오인하지 않음');
assert(staleZeroSnapshots.rows.some(row=>row[0]==='2026-01-05'&&row[1]==='F00002'),'F00002 갱신 Snapshot 저장');
assert.equal(staleZeroSnapshots.rows.some(row=>row[0]==='2026-01-05'&&row[1]==='F00003'),false,'기존 0좌 F00003 MANUAL Snapshot도 lifecycle이 우선하여 제거');
context._buildSnapshotRowsFromTradeAndPriceHistory=realBuild;

// 정상행이 expected와 이미 같아도 0좌 행이 원장에 남아 있으면 lifecycle 제거 자체가 rewrite 사유입니다.
const lifecycleRewriteUnits=new Sheet([['code','name','provider','start','units','at'],
  ['F00003','피델리티','FIDELITY_BIG4_S','2026-01-01',1000,''],
  ['F00003','피델리티','FIDELITY_BIG4_S','2026-01-05',0,'']]);
const lifecycleNormal=snap('2026-01-05','000001',100,'PRICE_HISTORY');
const lifecycleZeroManual=snap('2026-01-05','F00003',3000,'MANUAL');
const lifecycleRewriteSnapshot=new Sheet([header,lifecycleNormal,lifecycleZeroManual]);
const lifecycleRewriteSs=ssFor({'펀드좌수':lifecycleRewriteUnits,'스냅샷':lifecycleRewriteSnapshot});
const lifecyclePlan=clone(context._snapshotRewritePlan(lifecycleRewriteSs,'2026-01-05',[lifecycleNormal]));
assert.equal(lifecyclePlan.lifecycleRemovedRows,1,'0좌 원장 행 제거 건수 기록');
assert.equal(lifecyclePlan.needsRewrite,true,'필터 후 signature가 같아도 0좌 제거는 rewrite 사유');
context.writeSnapshotRows(lifecycleRewriteSs,'2026-01-05',[lifecycleNormal],true);
assert.equal(lifecycleRewriteSnapshot.rows.some(row=>row[0]==='2026-01-05'&&row[1]==='F00003'),false,'signature no-op보다 lifecycle 제거를 우선');
assert.equal(lifecycleRewriteSnapshot.rows.filter(row=>row[0]==='2026-01-05'&&row[1]==='000001').length,1,'정상행은 그대로 1개 유지');

// 세 펀드 import는 GAS에서 좌수·클래스·기존 NAV를 다시 검증합니다.
const importUnits = new Sheet([['code','name','provider','start','units','at'],
  ['F00001','한화 LIFEPLUS 적격 TDF 2045 C-RPe','HANWHA_2045_CRPE','2025-01-01',2000,''],
  ['F00002','KB 밸류포커스 소득공제 S-T','KB_VALUE_ST','2025-01-01',1000,''],
  ['F00003','피델리티 월드Big4 S','FIDELITY_BIG4_S','2026-01-01',15933.037,''],
  ['F00003','피델리티 월드Big4 S','FIDELITY_BIG4_S','2026-08-25',0,'']]);
const importNav = new Sheet([['date','code','name','nav','sourceDate','units','eval','at','provider'],
  ['2025-01-02','F00002','KB 밸류포커스 소득공제 S-T',1000,'2025-01-02',1000,1000,'','KB_VALUE_ST']]);
const importSs = ssFor({'펀드좌수':importUnits,'펀드기준가격':importNav});
const importPayload = (code,provider,classCode,rows,sourceText='',ackWarnings=false) => JSON.stringify({code,provider,classCode,rows,sourceText,ackWarnings});
assert.equal(context._inspectFundNavImport(importSs,importPayload('F00001','HANWHA_2045_CRPE','C-RPe',[
  {date:'2025-01-02',nav:1100}
])).candidates.length,1,'F00001도 공식 API 장애 시 검증 NAV import 지원');
const kbInspect=clone(context._inspectFundNavImport(importSs,importPayload('F00002','KB_VALUE_ST','AQ018',[
  {rowNumber:2,date:'2025-01-02',nav:1000},{rowNumber:3,date:'2025-01-03',nav:1001},{rowNumber:4,date:'2025-01-03',nav:1001}
],'AQ018 KR5223AQ0185')));
assert.equal(kbInspect.candidates.length,1);
assert.equal(kbInspect.identical.length,1);
assert.equal(kbInspect.duplicates.length,1);
assert.equal(context._inspectFundNavImport(importSs,importPayload('F00002','KB_VALUE_ST','AQ018',[
  {rowNumber:2,date:'2025-01-03',nav:1001},{rowNumber:3,date:'2025-01-03',nav:1002}
])).errors.length,1,'동일 서로 다른 NAV는 충돌로 저장 차단');
const fidelityInspect=clone(context._inspectFundNavImport(importSs,importPayload('F00003','FIDELITY_BIG4_S','AP399',[
  {rowNumber:2,date:'2026-08-24',nav:1234},{rowNumber:3,date:'2026-08-25',nav:1235},{rowNumber:4,date:'2026-08-26',nav:1236}
],'AP399 KR5235AP3996')));
assert.equal(fidelityInspect.candidates.length,1);
assert.equal(fidelityInspect.zeroUnits.length,2,'F00003 0좌 전환일 이후 NAV는 평가로 다시 나타나지 않음');
assert.throws(()=>context._inspectFundNavImport(importSs,importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2025-01-03',nav:1000}],'2K04')),/다른 클래스/);
assert.throws(()=>context._inspectFundNavImport(importSs,importPayload('F00003','FIDELITY_BIG4_S','AP399',[{date:'2025-01-03',nav:1000}],'AQ018')),/다른 클래스/);
for (const row of [{date:'2026-09-10',nav:1000},{date:'2025-01-03',nav:0},{date:'2025-01-03',nav:-1},{date:'bad',nav:1000}]) {
  assert.equal(context._inspectFundNavImport(importSs,importPayload('F00002','KB_VALUE_ST','AQ018',[row])).errors.length,1);
}
const conflict=clone(context._inspectFundNavImport(importSs,importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2025-01-02',nav:999}])));
assert.equal(conflict.updates.length,1);
assert.deepEqual([conflict.updates[0].existingNav,conflict.updates[0].uploadedNav],[1000,999]);
assert.equal(conflict.canSave,true);
assert.equal(conflict.warnings.some(row=>/기존 NAV/.test(row.reason)),true);
assert.equal(importNav.rows[1][3],1000,'미리보기 충돌은 기존 NAV를 변경하지 않음');
const samePrevious=clone(context._inspectFundNavImport(importSs,importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2025-01-03',nav:1000}])));
assert.equal(samePrevious.warnings.some(row=>/직전 확정 NAV와 동일/.test(row.reason)),true,'사용자 NAV의 전일 동일값은 WARNING');
const todayWarning=clone(context._inspectFundNavImport(importSs,importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2026-09-09',nav:1000}])));
assert.equal(todayWarning.warnings.some(row=>/오늘 NAV/.test(row.reason)),true,'오늘 수동 NAV는 확정 확인 WARNING');
const importWriteNav = new Sheet([['date','code','name','nav','sourceDate','units','eval','at','provider'],
  ['2025-01-02','F00002','KB 밸류포커스 소득공제 S-T',900,'2025-01-02',1000,900,'','KB_VALUE_ST'],
  ['2025-01-03','F00002','KB 밸류포커스 소득공제 S-T',900,'2025-01-02',1000,900,'','KB_VALUE_ST'],
  ['2025-01-05','F00002','KB 밸류포커스 소득공제 S-T',1100,'2025-01-05',1000,1100,'','KB_VALUE_ST']]);
const importWritePrices = new Sheet([['date','code','name','price','at','source'],
  ['2025-01-03','F00002','KB 밸류포커스 소득공제 S-T',900,'','MANUAL'],
  ['2025-01-02','000001','일반주식',777,'','MANUAL']]);
const importWriteTrades = new Sheet([Array(8).fill('header'),
  ['2025-01-01','buy','계좌','KB 밸류포커스 소득공제 S-T','F00002',1,800,'펀드']]);
const fxSnapshot = ['2025-01-02','US0001','해외자산',1,100,100,123,123,23,23,'FX_HISTORY',''];
const importWriteSnapshots = new Sheet([header,snap('2025-01-03','F00002',900,'MANUAL'),fxSnapshot]);
const importWriteSs = ssFor({'펀드좌수':importUnits,'펀드기준가격':importWriteNav,'가격이력':importWritePrices,'거래이력':importWriteTrades,'스냅샷':importWriteSnapshots});
context.getss=()=>importWriteSs;
context.jsonOk=extra=>({status:'ok',...extra}); context.jsonError=(message,extra)=>({status:'error',message,...(extra||{})});
// 선택적 진단은 단계별 시작/종료와 시간을 남기고, 꺼진 기존 실행에는 결과 필드를 추가하지 않습니다.
context.getss=()=>mixedSs;
context._buildSnapshotRowsFromTradeAndPriceHistory=()=>[];
const diagnosticResponse=context.handleRefreshFundValuations('2026-01-01','2026-01-07','F00002','true');
assert.equal(diagnosticResponse.status,'ok');
assert.equal(diagnosticResponse.diagnostic.fundCode,'F00002');
const diagnosticStages=diagnosticResponse.diagnostic.events.map(event=>event.stage+':'+event.status);
for (const stage of ['request:start','fundUnitsRead:start','storedNavRead:start','fundUnitsResolve:start','storedNavResolve:start','navConfirm:start','valuationCalculate:start','writeLockWait:start','navWrite:start','priceHistoryRead:start','priceHistoryWrite:start','snapshotTargetCalculate:start','snapshotWrite:start','resultAggregate:start','request:end']) assert(diagnosticStages.includes(stage),stage+' 진단 누락');
assert(diagnosticResponse.diagnostic.events.every(event=>Number.isFinite(event.elapsedMs)&&Number.isFinite(event.stageElapsedMs)),'진단 시간 기록');
assert.equal(Object.prototype.hasOwnProperty.call(kbOnly,'diagnostic'),false,'diagnostic=false 기존 응답 유지');
const forcedDiagnostic=context._createFundRecoveryDiagnostic(true,'2026-07-23','2026-07-29','F00002');
const forcedError=Object.assign(new Error('지원되지 않는 작업입니다.'),{stack:'forced diagnostic stack'});
context._fundRecoveryDiagnosticStart(forcedDiagnostic,'F00002','snapshotWrite','writeSnapshotRows');
context._fundRecoveryDiagnosticFinish(forcedDiagnostic,'error',forcedError);
const forcedEvent=forcedDiagnostic.events.find(event=>event.status==='error');
assert.equal(forcedEvent.stage,'snapshotWrite'); assert.equal(forcedEvent.functionName,'writeSnapshotRows');
assert.equal(forcedEvent.error,'지원되지 않는 작업입니다.'); assert.match(forcedEvent.stack,/forced diagnostic stack/);
const savedReadFundUnits=context._readFundUnits;
context._readFundUnits=()=>{ throw forcedError; };
const diagnosticErrorResponse=context.handleRefreshFundValuations('2026-07-23','2026-07-29','F00002','true');
assert.equal(diagnosticErrorResponse.status,'error');
const responseErrorEvent=diagnosticErrorResponse.diagnostic.events.find(event=>event.stage==='fundUnitsRead'&&event.status==='error');
assert.equal(responseErrorEvent.functionName,'_readFundUnits'); assert.equal(responseErrorEvent.error,'지원되지 않는 작업입니다.');
context._readFundUnits=savedReadFundUnits;
context._buildSnapshotRowsFromTradeAndPriceHistory=realBuild;
context.getss=()=>importWriteSs;
// 같은 실제 공시일 정정은 그 sourceDate를 참조하는 기존 carry-forward 행과 파생값을 함께 갱신합니다.
const correctionNav=new Sheet([['date','code','name','nav','sourceDate','units','eval','at','provider'],
  ['2025-01-02','F00002','KB 밸류포커스 소득공제 S-T',900,'2025-01-02',1000,900,'','KB_VALUE_ST'],
  ['2025-01-03','F00002','KB 밸류포커스 소득공제 S-T',900,'2025-01-02',1000,900,'','KB_VALUE_ST']]);
const correctionPrices=new Sheet([['date','code','name','price','at','source'],
  ['2025-01-02','F00002','KB 밸류포커스 소득공제 S-T',900,'','FUND_NAV'],
  ['2025-01-03','F00002','KB 밸류포커스 소득공제 S-T',900,'','FUND_NAV']]);
const correctionSnapshots=new Sheet([header,snap('2025-01-02','F00002',900),snap('2025-01-03','F00002',900)]);
const correctionSs=ssFor({'펀드좌수':importUnits,'펀드기준가격':correctionNav,'가격이력':correctionPrices,'거래이력':importWriteTrades,'스냅샷':correctionSnapshots});
context.getss=()=>correctionSs;
const correction=context.handleImportFundNav(importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2025-01-02',nav:950}],'',true));
assert.equal(correction.status,'ok');
assert.deepEqual(correctionNav.rows.slice(1).map(row=>[row[0],row[3],row[4],row[6]]),[
  ['2025-01-02',950,'2025-01-02',950],['2025-01-03',950,'2025-01-02',950]
]);
assert.deepEqual(correctionPrices.rows.slice(1).map(row=>[row[0],row[3]]),[['2025-01-02',950],['2025-01-03',950]]);
assert.deepEqual(correctionSnapshots.rows.slice(1).map(row=>[row[0],row[7]]),[['2025-01-02',950],['2025-01-03',950]]);
context.getss=()=>importWriteSs;

// 누락 공시일을 중간에 삽입하면 다음 공식 NAV 직전의 기존 이월 행까지 새 공시일을 참조합니다.
const insertionNav=new Sheet([['date','code','name','nav','sourceDate','units','eval','at','provider'],
  ['2025-01-02','F00002','KB 밸류포커스 소득공제 S-T',900,'2025-01-02',1000,900,'','KB_VALUE_ST'],
  ['2025-01-03','F00002','KB 밸류포커스 소득공제 S-T',900,'2025-01-02',1000,900,'','KB_VALUE_ST'],
  ['2025-01-04','F00002','KB 밸류포커스 소득공제 S-T',900,'2025-01-02',1000,900,'','KB_VALUE_ST'],
  ['2025-01-05','F00002','KB 밸류포커스 소득공제 S-T',1100,'2025-01-05',1000,1100,'','KB_VALUE_ST']]);
const insertionPrices=new Sheet([['date','code','name','price','at','source'],
  ['2025-01-03','F00002','KB 밸류포커스 소득공제 S-T',900,'','FUND_NAV'],
  ['2025-01-04','F00002','KB 밸류포커스 소득공제 S-T',900,'','FUND_NAV']]);
const insertionSnapshots=new Sheet([header,snap('2025-01-03','F00002',900),snap('2025-01-04','F00002',900)]);
const insertionSs=ssFor({'펀드좌수':importUnits,'펀드기준가격':insertionNav,'가격이력':insertionPrices,'거래이력':importWriteTrades,'스냅샷':insertionSnapshots});
context.getss=()=>insertionSs;
const insertion=context.handleImportFundNav(importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2025-01-03',nav:1000}]));
assert.equal(insertion.status,'ok');
assert.deepEqual(insertionNav.rows.slice(1).map(row=>[row[0],row[3],row[4]]),[
  ['2025-01-02',900,'2025-01-02'],['2025-01-03',1000,'2025-01-03'],
  ['2025-01-04',1000,'2025-01-03'],['2025-01-05',1100,'2025-01-05']
]);
assert.deepEqual(insertionPrices.rows.slice(1).map(row=>[row[0],row[3]]),[['2025-01-03',1000],['2025-01-04',1000]]);
context.getss=()=>importWriteSs;

// 수동 NAV import도 0좌 F코드를 완전성 검사 대상에서 제외해 정상 펀드 Snapshot 저장을 막지 않습니다.
const importLifecycleUnits=new Sheet([['code','name','provider','start','units','at'],
  ['F00002','KB','KB_VALUE_ST','2026-01-01',1000,''],
  ['F00003','피델리티','FIDELITY_BIG4_S','2026-01-01',1000,''],
  ['F00003','피델리티','FIDELITY_BIG4_S','2026-01-05',0,'']]);
const importLifecycleNav=new Sheet([['date','code','name','nav','sourceDate','units','eval','at','provider']]);
const importLifecyclePrices=new Sheet([['date','code','name','price','at','source']]);
const importLifecycleTrades=new Sheet([Array(8).fill('header'),
  ['2026-01-01','buy','계좌','KB','F00002',1,800,'펀드'],
  ['2026-01-01','buy','계좌','피델리티','F00003',1,700,'펀드']]);
const importLifecycleSnapshots=new Sheet([header,snap('2026-01-05','F00003',3000,'MANUAL')]);
const importLifecycleSs=ssFor({'펀드좌수':importLifecycleUnits,'펀드기준가격':importLifecycleNav,'가격이력':importLifecyclePrices,'거래이력':importLifecycleTrades,'스냅샷':importLifecycleSnapshots});
context.getss=()=>importLifecycleSs;
const importLifecycle=context.handleImportFundNav(importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2026-01-05',nav:1000}]));
assert.equal(importLifecycle.status,'ok','0좌 다른 펀드가 있어도 수동 NAV import 성공');
assert(importLifecycle.evaluation.snapshots>0,'정상 F00002 Snapshot 저장');
assert(importLifecycleSnapshots.rows.some(row=>row[0]==='2026-01-05'&&row[1]==='F00002'),'수동 import F00002 Snapshot 존재');
assert.equal(importLifecycleSnapshots.rows.some(row=>row[0]==='2026-01-05'&&row[1]==='F00003'),false,'기존 Snapshot이 있어도 수동 import에서 0좌 F00003 MANUAL 행 제거');
context.getss=()=>importWriteSs;

const imported=context.handleImportFundNav(importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2025-01-03',nav:1000}]));
assert.equal(imported.status,'ok'); assert.equal(imported.importResult.saved,1); assert.deepEqual(clone(imported.evaluation.ranges),[{from:'2025-01-03',to:'2025-01-03'}]);
assert.deepEqual(importWriteNav.rows.slice(1,4).map(row=>[row[0],row[3],row[4],row[6]]),[
  ['2025-01-02',900,'2025-01-02',900],['2025-01-03',1000,'2025-01-03',1000],['2025-01-05',1100,'2025-01-05',1100]
]);
assert.equal(importWriteNav.rows.some(row=>row[0]==='2025-01-04'),false,'직전 NAV를 미공시 날짜의 확정 NAV로 복제하지 않음');
assert.equal(importWritePrices.rows.find(row=>row[0]==='2025-01-03'&&row[1]==='F00002')[3],900,'기존 MANUAL 가격 보존');
assert.equal(importWritePrices.rows.find(row=>row[1]==='000001')[3],777,'관련 없는 일반주식 가격이력 보존');
assert.equal(importWriteSnapshots.rows.find(row=>row[1]==='F00002')[7],900,'기존 MANUAL Snapshot 보존');
assert.deepEqual(importWriteSnapshots.rows.find(row=>row[1]==='US0001'),fxSnapshot,'해외자산 과거 FX 스냅샷 보존');
const repeated=context.handleImportFundNav(importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2025-01-03',nav:1000}]));
assert.equal(repeated.importResult.saved,0,'동일 NAV 재입력은 NAV를 다시 저장하지 않음');
const beforeConflict=clone(importWriteNav.rows);
assert.equal(context.handleImportFundNav(importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2025-01-03',nav:1002}])).status,'error','WARNING 미확인은 저장 차단');
assert.deepEqual(importWriteNav.rows,beforeConflict,'WARNING 확인 전에는 기존 NAV를 변경하지 않음');
const updated=context.handleImportFundNav(importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2025-01-03',nav:1002}],'',true));
assert.equal(updated.status,'ok'); assert.equal(updated.importResult.updated,1);
assert.equal(importWriteNav.rows.find(row=>row[0]==='2025-01-03')[3],1002,'사용자 확인 후 동일 날짜 확정 NAV 갱신');
const correctedSource=context.handleImportFundNav(importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2025-01-02',nav:950}],'',true));
assert.equal(correctedSource.status,'ok');
assert.deepEqual(importWriteNav.rows.filter(row=>row[1]==='F00002'&&row[4]==='2025-01-02').map(row=>[row[0],row[3],row[6]]),[
  ['2025-01-02',950,950]
],'정정 공시일을 참조하는 현재 carry-forward 행은 이후 정정으로 sourceDate가 바뀐 행과 구분');

const beforeImportFailure=clone(importWriteNav.rows); importWriteNav.failWrite=true;
const fullFailure=context.handleImportFundNav(importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2025-01-04',nav:1002}],'',true));
assert.equal(fullFailure.status,'error');
assert.equal(fullFailure.saveState,'failed','첫 저장 단계 실패는 전체 저장 실패로 구분');
assert.deepEqual(importWriteNav.rows,beforeImportFailure,'부분 쓰기 실패 시 기존 NAV 보존');
importWriteNav.failWrite=false;

// 설정 저장은 같은 적용일 수정·과거 소급 변경을 거부하고 미래 변경만 추가합니다.
fundNav.rows = fundNav.rows.filter((row,index)=>index===0 || row[0]!=='2025-12-31');
context.jsonOk=extra=>({status:'ok',...extra});
context.jsonError=(message,extra)=>({status:'error',message,...(extra||{})});
context.getss=()=>ssFor(sheets);
context._ensureFundDailyTrigger=()=>{};
context._readSettingsMap=()=>({EDITABLE_PRICES:[{code:'F00001',name:'테스트 펀드',fund:true}]});
const saveConfig=(startDate,units,provider='HANWHA_2045_CRPE')=>context.handleSaveFundUnits(JSON.stringify({code:'F00001',provider,startDate,units}));
assert.equal(saveConfig('2026-01-01',1000).status,'ok');
assert.equal(saveConfig('2026-01-01',2000).status,'error');
assert.equal(saveConfig('2025-12-31',2000).status,'ok','다음 설정 이전의 미작성 날짜는 별도 좌수를 등록할 수 있습니다.');
assert.equal(saveConfig('2026-01-02',2000).status,'error','이미 작성한 날짜에 다른 좌수를 소급 적용할 수 없습니다.');
assert.equal(saveConfig('2026-01-03',2000).status,'ok');
assert.equal(saveConfig('2026-01-04',0).status,'ok');
assert.equal(saveConfig('2026-01-05','').status,'error');
assert.equal(saveConfig('2026-01-05',1000,'__proto__').status,'error');
assert.equal(saveConfig('2026-01-05',1e30).status,'error');
const catalog=context._getFundCodeCatalog(ssFor(sheets),context._readFundUnits(ssFor(sheets)));
assert.equal(catalog.find(item=>item.code==='F00001').currentHolding,true,'현재 보유 F코드는 현재 보유로 분류');
assert.equal(catalog.find(item=>item.code==='F00003').currentHolding,false,'전량 매도 F코드는 과거 보유로 분류');
assert.equal(catalog.find(item=>item.code==='F00003').name,'과거 펀드');
const fundUnitsResponse=context.handleGetFundUnits();
assert.equal(fundUnitsResponse.funds.find(item=>item.code==='F00003').currentHolding,false,'조회 API도 과거 F코드를 반환');
const saveRetired=(startDate,units)=>context.handleSaveFundUnits(JSON.stringify({code:'F00003',provider:'FIDELITY_BIG4_S',startDate,units}));
assert.equal(saveRetired('2024-01-01',10000).status,'ok','거래이력에만 있는 과거 F코드도 좌수 이력을 등록');
assert.equal(saveRetired('2024-01-01',12000).status,'error','같은 적용일의 다른 좌수는 덮어쓰지 않음');
assert.equal(context._readFundUnits(ssFor(sheets)).some(c=>c.code==='F00003' && c.units===10000),true);

// 실수량을 가진 펀드도 가격이력 총액을 다시 수량으로 곱하지 않습니다.
const realSheets={'거래이력':new Sheet([Array(8).fill('header'),['2026-01-01','buy','계좌','테스트 펀드','F00001',10,100,'펀드']]),
  '가격이력':new Sheet([Array(6).fill('header'),['2026-01-02','F00001','테스트 펀드',1200,'','FUND_NAV']])};
const built=clone(realBuild(ssFor(realSheets),'2026-01-02',true));
assert.equal(built.length,1);
assert.equal(built[0][3],1);
assert.equal(built[0][5],1000);
assert.equal(built[0][7],1200);
assert.equal(realBuild(ssFor(realSheets),'2026-01-01',true).length,0,'미래 가격을 과거에 소급하지 않습니다.');
const legacy=snap('2026-01-02','',777,'MANUAL'); legacy[2]='테스트 펀드';
const canonical=snap('2026-01-02','F00001',888); canonical[2]='테스트 펀드';
const mergedLegacy=clone(context._mergeSnapshotRowsSafely([legacy],[canonical],true));
assert.equal(mergedLegacy.length,1);
assert.equal(mergedLegacy[0][7],777);

// NAV 저장 뒤 가격이력 쓰기가 실패해도 동일 NAV 재입력으로 파생 데이터만 복구합니다.
const partialCommitNav=new Sheet([['date','code','name','nav','sourceDate','units','eval','at','provider']]);
partialCommitNav.failCopy=true;
const partialCommitPrices=new Sheet([['date','code','name','price','at','source']]); partialCommitPrices.failWrite=true;
const partialCommitSheets={'펀드좌수':importUnits,'펀드기준가격':partialCommitNav,'가격이력':partialCommitPrices,'거래이력':importWriteTrades};
const partialCommitSs=ssFor(partialCommitSheets);
context.getss=()=>partialCommitSs;
const partialFailure=context.handleImportFundNav(importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2025-01-02',nav:975}]));
assert.equal(partialFailure.status,'error');
assert.equal(partialFailure.saveState,'partial','NAV 저장 후 가격이력 실패는 일부 저장으로 구분');
assert.equal(partialFailure.persisted.navWrite.appendedRows,1,'이번 요청에서 실제 저장된 NAV 신규 행 수 반환');
assert.equal(partialFailure.persisted.priceHistoryWrite.appendedRows,0,'실패한 가격이력은 저장 건수 0');
assert.match(partialFailure.message,/일부 저장 후 실패/);
assert.doesNotMatch(partialFailure.message,/기존 데이터는 변경하지 않았습니다/);
assert.equal(partialCommitNav.copies,0,'NAV import 백업은 지원되지 않는 copyTo를 호출하지 않음');
assert.equal(Object.keys(partialCommitSheets).some(name=>name.includes('_백업_')),false,'NAV import는 반복 백업 시트를 만들지 않음');
assert.equal(partialFailure.diagnostic.events.find(event=>event.status==='error').stage,'priceHistoryWrite','부분 저장 실패 단계를 응답에 식별');
assert.equal(Object.prototype.hasOwnProperty.call(partialFailure.diagnostic.events.find(event=>event.status==='error'),'stack'),false,'import 실패 진단에 stack 미노출');
assert.equal(partialCommitNav.rows.filter(row=>row[1]==='F00002').length,1,'파생 쓰기 실패 전 저장된 유효 NAV 유지');
partialCommitPrices.failWrite=false;
const partialRetry=context.handleImportFundNav(importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2025-01-02',nav:975}]));
assert.equal(partialRetry.status,'ok');
assert.equal(partialRetry.importResult.identical.length,1);
assert.equal(partialCommitNav.rows.filter(row=>row[1]==='F00002').length,1,'동일 NAV 재실행에서 중복 NAV 없음');
assert.equal(partialCommitPrices.rows.filter(row=>row[1]==='F00002').length,1,'동일 NAV 재실행에서 누락 가격이력 복구');
const partialRetryAgain=context.handleImportFundNav(importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2025-01-02',nav:975}]));
assert.equal(partialCommitPrices.rows.filter(row=>row[1]==='F00002').length,1,'반복 재실행 idempotent');
context.getss=()=>importWriteSs;

// 통합문서가 셀 한도에 근접해도 기존 시트의 여유 행 안에서 증분 저장하며 새 백업 시트를 만들지 않습니다.
const capacityUnits=new Sheet([['code','name','provider','start','units','at'],['F00002','KB','KB_VALUE_ST','2026-01-01',1000,'']]);
const capacityNav=new Sheet([['date','code','name','nav','sourceDate','units','eval','at','provider']]);
const capacityPrices=new Sheet([['date','code','name','price','at','source']]);
const capacityTrades=new Sheet([Array(8).fill('header'),['2026-01-01','buy','계좌','KB','F00002',1,800,'펀드']]);
const capacitySnapshots=new Sheet([header]);
[capacityUnits,capacityNav,capacityPrices,capacityTrades,capacitySnapshots].forEach(sheet=>{ sheet.maxRows=100; });
const capacityFiller=new Sheet([['keep']]); capacityFiller.maxRows=380000; capacityFiller.maxColumns=26;
const capacitySheets={'펀드좌수':capacityUnits,'펀드기준가격':capacityNav,'가격이력':capacityPrices,'거래이력':capacityTrades,'스냅샷':capacitySnapshots,'기존대형시트':capacityFiller};
const capacitySs=ssFor(capacitySheets);
context.getss=()=>capacitySs;
context.today=()=> '2026-09-22';
const capacityResult=context.handleImportFundNav(importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2026-09-21',nav:1200}]));
assert.equal(capacityResult.status,'ok');
assert.equal(capacityNav.rows.filter(row=>row[0]==='2026-09-21').length,1,'한도 근접 통합문서에도 NAV 증분 저장');
assert.equal(Object.keys(capacitySheets).some(name=>name.includes('_백업_')),false,'한도 근접 저장도 백업 시트 미생성');
assert(capacityResult.evaluation.capacity.before.totalCells>9800000,'10M 한도 근접 실행 전 전체 할당 셀 진단');
assert.equal(capacityResult.evaluation.capacity.before.totalCells,capacityResult.evaluation.capacity.after.totalCells,'기존 여유 행 안의 import는 할당 셀을 늘리지 않음');

// 10M 한도 근처에서 필요한 셀을 확보하고 대상 시트의 빈 초과 열만 회수해 확장합니다.
const compactNav=new Sheet([Array(9).fill('header')]); compactNav.maxRows=1; compactNav.maxColumns=29;
const compactPrices=new Sheet([Array(6).fill('header')]); compactPrices.maxRows=1; compactPrices.maxColumns=6;
const compactSnapshots=new Sheet([header]); compactSnapshots.maxRows=1; compactSnapshots.maxColumns=12;
const compactFillerA=new Sheet([['keep']]); compactFillerA.maxRows=344798; compactFillerA.maxColumns=29;
const compactFillerB=new Sheet([['keep']]); compactFillerB.maxRows=1; compactFillerB.maxColumns=25;
const compactSs=ssFor({'펀드기준가격':compactNav,'가격이력':compactPrices,'스냅샷':compactSnapshots,'기존대형시트A':compactFillerA,'기존대형시트B':compactFillerB});
assert.equal(context._fundSheetCapacity(compactSs).remainingCells,786,'10M 한도 잔여 셀 786개 재현');
context._ensureFundImportRowCapacity(compactSs,compactNav,36);
assert.equal(compactNav.getMaxColumns(),9,'값이 없는 초과 20개 열만 회수');
assert.equal(compactNav.getMaxRows(),37,'29열 기준 1,044셀 대신 9열 기준 324셀로 행 확장');
assert.equal(compactFillerA.getMaxColumns(),29,'무관한 시트는 변경하지 않음');

const diagnostic=clone(context._diagnoseWorkbookCells(ssFor({
  '스냅샷':new Sheet([header]), '스냅샷_백업_20260921_120000_test':new Sheet([header,snap('2026-01-01','000001',100)]),
  'LEGACY_과거':new Sheet([['old']])
}),false));
assert.equal(diagnostic.sheets.find(item=>item.name==='스냅샷').role,'SNAPSHOT');
assert.equal(diagnostic.sheets.find(item=>item.name==='LEGACY_과거').legacy,true);
assert.equal(diagnostic.backupSummary.sheetCount,1,'백업 시트 수 합산');
assert.equal(diagnostic.backupSummary.allocatedCells,260000,'실제 사용 범위가 아닌 최대 행×열을 백업 점유량으로 계산');
assert.equal(diagnostic.backupSummary.reclaimableAfterVerifiedDeletion,260000,'검증·승인 후 예상 확보 셀 반환');
const cleanupSheets={
  '스냅샷':new Sheet([header]),
  '스냅샷_백업_시스템_구버전':new Sheet([header]),
  '스냅샷_백업_시스템_최신':new Sheet([header]),
  '스냅샷_백업_수정됨':new Sheet([header,snap('2026-01-01','000001',999)]),
  '스냅샷_백업_사용자보관':new Sheet([header])
};
const cleanupSs=ssFor(cleanupSheets);
const cleanBackupSignature=context._sheetContentSignature(cleanupSheets['스냅샷_백업_시스템_구버전']);
scriptProperties.set('system_backup_registry_v1',JSON.stringify([
  {name:'스냅샷_백업_시스템_구버전',source:'스냅샷',signature:cleanBackupSignature,status:'COMPLETED',systemGenerated:true,completedAt:'2026-09-20T00:00:00Z'},
  {name:'스냅샷_백업_시스템_최신',source:'스냅샷',signature:cleanBackupSignature,status:'COMPLETED',systemGenerated:true,completedAt:'2026-09-21T00:00:00Z'},
  {name:'스냅샷_백업_수정됨',source:'스냅샷',signature:cleanBackupSignature,status:'COMPLETED',systemGenerated:true,completedAt:'2026-09-18T00:00:00Z'},
  {name:'스냅샷_백업_실패',source:'스냅샷',signature:cleanBackupSignature,status:'WRITE_FAILED',systemGenerated:true,createdAt:'2026-09-19T00:00:00Z'}
]));
cleanupSheets['스냅샷_백업_실패']=new Sheet([header]);
cleanupSs.getSheets();
const cleanupResult=clone(context._cleanupSystemBackups(cleanupSs,'스냅샷'));
assert.deepEqual(cleanupResult.deleted,['스냅샷_백업_시스템_최신','스냅샷_백업_시스템_구버전'],'성공본만 cleanup');
assert(!cleanupSheets['스냅샷_백업_시스템_최신'],'정상 완료 system backup 0개');
assert(cleanupSheets['스냅샷_백업_사용자보관'],'이름만 백업인 미등록 사용자 시트 보호');
assert(cleanupSheets['스냅샷_백업_실패'],'더 최신 COMPLETED만으로 WRITE_FAILED를 정리하지 않음');
assert(cleanupResult.unresolved.some(item=>item.name==='스냅샷_백업_실패'&&/쓰기 실패/.test(item.reason)),'셀 부족 사전 cleanup에서도 WRITE_FAILED 보호');
assert(cleanupSheets['스냅샷_백업_수정됨'],'registry signature와 실제 내용이 다른 COMPLETED backup 보호');
assert(cleanupResult.unresolved.some(item=>item.name==='스냅샷_백업_수정됨'&&/signature/.test(item.reason)),'변경된 COMPLETED backup을 unresolved로 보고');
assert.equal(cleanupResult.releasedCells,520000,'COMPLETED cleanup 확보 실제 allocatedCells 합산');

// 새 성공 시 과거 검증된 COMPLETED만 정리하고 WRITE_FAILED는 복구 검증 전까지 보호합니다.
const lifecycleSheets={ '스냅샷':new Sheet([header]), 'failed-A':new Sheet([header]), 'completed-A':new Sheet([header]), 'success-B':new Sheet([header]) };
const lifecycleSs=ssFor(lifecycleSheets), lifecycleSignature=context._sheetContentSignature(lifecycleSheets['failed-A']);
scriptProperties.set('system_backup_registry_v1',JSON.stringify([
  {name:'failed-A',source:'스냅샷',signature:lifecycleSignature,status:'WRITE_FAILED',systemGenerated:true,operationId:'old-failed',updatedAt:'2026-09-19T00:00:00Z'},
  {name:'completed-A',source:'스냅샷',signature:lifecycleSignature,status:'COMPLETED',systemGenerated:true,operationId:'old-completed',completedAt:'2026-09-20T00:00:00Z'},
  {name:'success-B',source:'스냅샷',signature:lifecycleSignature,status:'COMPLETED',systemGenerated:true,operationId:'new-success',completedAt:'2026-09-21T00:00:00Z'}
]));
let lifecycleCleanup=clone(context._cleanupCurrentSystemBackup(lifecycleSs,{name:'success-B',source:'스냅샷',operationId:'new-success'}));
assert.deepEqual(lifecycleCleanup.staleDeleted,['completed-A'],'과거 COMPLETED만 stale 정리');
assert(lifecycleCleanup.staleProtected.some(item=>item.name==='failed-A'&&/WRITE_FAILED.*복구 검증 없음/.test(item.reason)),'unrelated 성공으로 WRITE_FAILED 삭제 금지');
assert.deepEqual(Object.keys(lifecycleSheets).filter(name=>name!=='스냅샷'),['failed-A'],'current/과거 COMPLETED는 정리하고 WRITE_FAILED만 보호');
assert.deepEqual(JSON.parse(scriptProperties.get('system_backup_registry_v1')).map(item=>item.name),['failed-A'],'WRITE_FAILED registry 유지');

// 검증된 최신 v2 COMPLETED가 생기면 더 오래된 legacy COMPLETED는 재서명 없이 schema/formula 검증으로 정리합니다.
const legacyMigrationSheets={
  '스냅샷':new Sheet([header]),
  'legacy-mismatch':new Sheet([header]),
  'legacy-formula':new Sheet([header]),
  'legacy-schema':new Sheet([['다른헤더']]),
  'legacy-sibling':new Sheet([header]),
  'legacy-sibling-created':new Sheet([header]),
  'legacy-no-signature':new Sheet([header]),
  'trusted-v2':new Sheet([header]),
  'legacy-ref':new Sheet([['ref']])
};
legacyMigrationSheets['legacy-ref'].formulaText="='legacy-formula'!A1";
const legacyMigrationSs=ssFor(legacyMigrationSheets);
const trustedV2Signature=context._sheetContentSignature(legacyMigrationSheets['trusted-v2']);
scriptProperties.set('system_backup_registry_v1',JSON.stringify([
  {name:'legacy-mismatch',source:'스냅샷',signature:'legacy-source-signature',status:'COMPLETED',systemGenerated:true,operationId:'legacy-old',completedAt:'2026-09-18T00:00:00Z'},
  {name:'legacy-formula',source:'스냅샷',signature:'legacy-source-signature',status:'COMPLETED',systemGenerated:true,operationId:'legacy-formula-old',completedAt:'2026-09-18T01:00:00Z'},
  {name:'legacy-schema',source:'스냅샷',signature:'legacy-source-signature',status:'COMPLETED',systemGenerated:true,operationId:'legacy-schema-old',completedAt:'2026-09-18T02:00:00Z'},
  {name:'legacy-sibling',source:'스냅샷',signature:'legacy-source-signature',status:'COMPLETED',systemGenerated:true,operationId:'partial-op',completedAt:'2026-09-18T03:00:00Z'},
  {name:'legacy-sibling-created',source:'스냅샷',signature:'legacy-source-signature',status:'CREATED',systemGenerated:true,operationId:'partial-op',createdAt:'2026-09-18T03:01:00Z'},
  {name:'legacy-no-signature',source:'스냅샷',status:'COMPLETED',systemGenerated:true,operationId:'legacy-no-signature-op',completedAt:'2026-09-18T04:00:00Z'},
  {name:'trusted-v2',source:'스냅샷',signature:trustedV2Signature,signatureVersion:'backup-content-v2',status:'COMPLETED',systemGenerated:true,operationId:'trusted-v2-op',completedAt:'2026-09-21T00:00:00Z'}
]));
const legacyMigrationCleanup=clone(context._cleanupCurrentSystemBackup(legacyMigrationSs,{name:'trusted-v2',source:'스냅샷',operationId:'trusted-v2-op'}));
assert(!legacyMigrationSheets['legacy-mismatch'],'trusted v2가 있으면 stale legacy signature mismatch를 정리');
assert(legacyMigrationCleanup.legacyMigratedDeleted.includes('legacy-mismatch'),'legacy migration 삭제를 결과에 기록');
assert(legacyMigrationSheets['legacy-formula'],'수식 참조 legacy는 계속 보호');
assert(legacyMigrationSheets['legacy-schema'],'source schema 불일치 legacy는 계속 보호');
assert(legacyMigrationSheets['legacy-sibling'],'같은 operation에 CREATED sibling이 남은 legacy COMPLETED는 보호');
assert(legacyMigrationSheets['legacy-sibling-created'],'미완료 CREATED sibling 자체도 보호');
assert(legacyMigrationSheets['legacy-no-signature'],'signature 없는 legacy COMPLETED는 자동 정리하지 않음');
assert(legacyMigrationCleanup.staleProtected.some(item=>item.name==='legacy-no-signature'&&/signature 없음/.test(item.reason)),'signature 없는 legacy 보호 사유 유지');
assert(legacyMigrationCleanup.staleProtected.some(item=>item.name==='legacy-sibling'&&/signature/.test(item.reason)),'부분 완료 operation의 legacy COMPLETED는 cleanup 예외에서 제외');
assert(legacyMigrationCleanup.staleProtected.some(item=>item.name==='legacy-formula'&&/수식 참조/.test(item.reason)),'legacy formula 보호 사유 유지');
assert(legacyMigrationCleanup.staleProtected.some(item=>item.name==='legacy-schema'&&/signature/.test(item.reason)),'legacy schema mismatch는 signature 보호 유지');
assert(!legacyMigrationSheets['trusted-v2'],'성공한 current v2 backup은 steady state 0 정책대로 정리');

// current v2 자체가 source schema와 다르거나 수식 참조되면 legacy migration 근거로 사용하지 않습니다.
const trustedV2FormulaSheets={
  '스냅샷':new Sheet([header]),
  'legacy-formula-current':new Sheet([header]),
  'trusted-v2-formula':new Sheet([header]),
  'trusted-v2-ref':new Sheet([['ref']])
};
trustedV2FormulaSheets['trusted-v2-ref'].formulaText="='trusted-v2-formula'!A1";
const trustedV2FormulaSs=ssFor(trustedV2FormulaSheets);
const trustedV2FormulaSignature=context._sheetContentSignature(trustedV2FormulaSheets['trusted-v2-formula']);
scriptProperties.set('system_backup_registry_v1',JSON.stringify([
  {name:'legacy-formula-current',source:'스냅샷',signature:'legacy-source-signature',status:'COMPLETED',systemGenerated:true,operationId:'legacy-formula-current-op',completedAt:'2026-09-18T00:00:00Z'},
  {name:'trusted-v2-formula',source:'스냅샷',signature:trustedV2FormulaSignature,signatureVersion:'backup-content-v2',status:'COMPLETED',systemGenerated:true,operationId:'trusted-v2-formula-op',completedAt:'2026-09-21T00:00:00Z'}
]));
const trustedV2FormulaCleanup=clone(context._cleanupCurrentSystemBackup(trustedV2FormulaSs,{name:'trusted-v2-formula',source:'스냅샷',operationId:'trusted-v2-formula-op'}));
assert(trustedV2FormulaSheets['legacy-formula-current'],'current v2가 수식 참조되면 legacy mismatch를 삭제하지 않음');
assert(!trustedV2FormulaCleanup.legacyMigratedDeleted.includes('legacy-formula-current'),'formula-referenced current v2는 migration 증거 아님');

const trustedV2SchemaSheets={
  '스냅샷':new Sheet([['변경된헤더']]),
  'legacy-schema-current':new Sheet([['변경된헤더']]),
  'trusted-v2-schema':new Sheet([header])
};
const trustedV2SchemaSs=ssFor(trustedV2SchemaSheets);
const trustedV2SchemaSignature=context._sheetContentSignature(trustedV2SchemaSheets['trusted-v2-schema']);
scriptProperties.set('system_backup_registry_v1',JSON.stringify([
  {name:'legacy-schema-current',source:'스냅샷',signature:'legacy-source-signature',status:'COMPLETED',systemGenerated:true,operationId:'legacy-schema-current-op',completedAt:'2026-09-18T00:00:00Z'},
  {name:'trusted-v2-schema',source:'스냅샷',signature:trustedV2SchemaSignature,signatureVersion:'backup-content-v2',status:'COMPLETED',systemGenerated:true,operationId:'trusted-v2-schema-op',completedAt:'2026-09-21T00:00:00Z'}
]));
const trustedV2SchemaCleanup=clone(context._cleanupCurrentSystemBackup(trustedV2SchemaSs,{name:'trusted-v2-schema',source:'스냅샷',operationId:'trusted-v2-schema-op'}));
assert(trustedV2SchemaSheets['legacy-schema-current'],'current v2 source schema 불일치면 legacy mismatch를 삭제하지 않음');
assert(!trustedV2SchemaCleanup.legacyMigratedDeleted.includes('legacy-schema-current'),'schema-mismatched current v2는 migration 증거 아님');


const maintenanceSheets={ '스냅샷':new Sheet([header]), '스냅샷_백업_failed_op':new Sheet([header]), '스냅샷_백업_completed_op':new Sheet([header]) };
const maintenanceSs=ssFor(maintenanceSheets), maintenanceSignature=context._sheetContentSignature(maintenanceSheets['스냅샷_백업_failed_op']);
scriptProperties.set('system_backup_registry_v1',JSON.stringify([
  {name:'스냅샷_백업_failed_op',source:'스냅샷',signature:maintenanceSignature,status:'WRITE_FAILED',systemGenerated:true,operationId:'failed-validated-op',createdAt:'2026-09-19T00:00:00Z'},
  {name:'스냅샷_백업_completed_op',source:'스냅샷',signature:maintenanceSignature,status:'COMPLETED',systemGenerated:true,operationId:'unrelated-success',completedAt:'2026-09-21T00:00:00Z'}
]));
context.getss=()=>maintenanceSs;
const genericMaintenance=clone(context.maintainSystemBackups({apply:true}));
assert(maintenanceSheets['스냅샷_백업_failed_op'],'validatedOperationIds 없는 maintenance는 WRITE_FAILED 보호');
assert(!maintenanceSheets['스냅샷_백업_completed_op'],'generic maintenance에서 COMPLETED cleanup 유지');
assert(genericMaintenance.protectedSheets.some(item=>item.name==='스냅샷_백업_failed_op'&&/WRITE_FAILED.*복구 검증 없음/.test(item.reason)));
const validatedMaintenance=clone(context.maintainSystemBackups({apply:true,validatedOperationIds:['failed-validated-op']}));
assert(!maintenanceSheets['스냅샷_백업_failed_op'],'최종 VALID operationId 증거가 있는 Snapshot WRITE_FAILED cleanup 허용');
assert(validatedMaintenance.deletedSheetNames.includes('스냅샷_백업_failed_op'));

const sourceMissingMaintenanceSheets={ '스냅샷_백업_source_missing_completed':new Sheet([header]), '스냅샷_백업_source_missing_failed':new Sheet([header]) };
const sourceMissingMaintenanceSs=ssFor(sourceMissingMaintenanceSheets);
const sourceMissingMaintenanceSignature=context._sheetContentSignature(sourceMissingMaintenanceSheets['스냅샷_백업_source_missing_completed']);
scriptProperties.set('system_backup_registry_v1',JSON.stringify([
  {name:'스냅샷_백업_source_missing_completed',source:'스냅샷',signature:sourceMissingMaintenanceSignature,status:'COMPLETED',systemGenerated:true,operationId:'source-missing-completed',completedAt:'2026-09-21T00:00:00Z'},
  {name:'스냅샷_백업_source_missing_failed',source:'스냅샷',signature:sourceMissingMaintenanceSignature,status:'WRITE_FAILED',systemGenerated:true,operationId:'source-missing-validated',createdAt:'2026-09-20T00:00:00Z'}
]));
context.getss=()=>sourceMissingMaintenanceSs;
const sourceMissingDiagnosis=clone(context._diagnoseWorkbookCells(sourceMissingMaintenanceSs,true));
assert(sourceMissingDiagnosis.sheets.filter(item=>item.backup).every(item=>!item.autoCleanupEligible&&/source sheet 없음/.test(item.protectionReason)),'진단도 source 없는 registered backup을 자동 정리 불가로 표시');
const sourceMissingMaintenance=clone(context.maintainSystemBackups({apply:true,validatedOperationIds:['source-missing-validated']}));
assert.deepEqual(sourceMissingMaintenance.deletedSheetNames,[],'source 없으면 COMPLETED/validated WRITE_FAILED 모두 삭제 금지');
assert(sourceMissingMaintenance.protectedSheets.every(item=>/source sheet 없음/.test(item.reason)));
assert(sourceMissingMaintenanceSheets['스냅샷_백업_source_missing_completed']&&sourceMissingMaintenanceSheets['스냅샷_백업_source_missing_failed'],'source-missing backup sheet 보호');
assert.equal(JSON.parse(scriptProperties.get('system_backup_registry_v1')).length,2,'source-missing registry 보호');

const createdSheets={ '스냅샷':new Sheet([header]), 'created-cross-execution':new Sheet([header]), 'success-created-test':new Sheet([header]) };
const createdSs=ssFor(createdSheets), createdSignature=context._sheetContentSignature(createdSheets['created-cross-execution']);
scriptProperties.set('system_backup_registry_v1',JSON.stringify([
  {name:'created-cross-execution',source:'스냅샷',signature:createdSignature,status:'CREATED',systemGenerated:true,operationId:'other-execution',createdAt:'2026-09-20T00:00:00Z'},
  {name:'success-created-test',source:'스냅샷',signature:createdSignature,status:'COMPLETED',systemGenerated:true,operationId:'current-execution',completedAt:'2026-09-21T00:00:00Z'}
]));
context._snapshotBackupOperationId='current-execution';
const createdCleanup=clone(context._cleanupCurrentSystemBackup(createdSs,{name:'success-created-test',source:'스냅샷',operationId:'current-execution'}));
context._snapshotBackupOperationId='';
assert(createdSheets['created-cross-execution'],'다른 실행의 오래된 CREATED도 fast path에서 보호');
assert(!createdSheets['success-created-test'],'현재 COMPLETED backup은 정상 정리');
assert(createdCleanup.staleProtected.some(item=>item.name==='created-cross-execution'&&/CREATED.*확인 불가/.test(item.reason)));
assert(JSON.parse(scriptProperties.get('system_backup_registry_v1')).some(item=>item.name==='created-cross-execution'),'CREATED registry 보호');

const sourceMissingSheets={ 'current-without-source':new Sheet([header]) }, sourceMissingSs=ssFor(sourceMissingSheets);
const sourceMissingRecord={name:'current-without-source',source:'스냅샷',signature:context._sheetContentSignature(sourceMissingSheets['current-without-source']),status:'COMPLETED',systemGenerated:true,operationId:'missing-source-op',completedAt:'2026-09-21T00:00:00Z'};
scriptProperties.set('system_backup_registry_v1',JSON.stringify([sourceMissingRecord]));
const sourceMissingCleanup=clone(context._cleanupCurrentSystemBackup(sourceMissingSs,sourceMissingRecord));
assert.equal(sourceMissingCleanup.deleted,false);
assert.match(sourceMissingCleanup.reason,/원본 source sheet 없음/);
assert(sourceMissingSheets['current-without-source'],'source 없는 current backup sheet 보호');
assert(JSON.parse(scriptProperties.get('system_backup_registry_v1')).some(item=>item.name==='current-without-source'),'source 없는 current registry 보호');

// 현재 COMPLETED backup이 유효하지 않으면 과거 검증 가능한 COMPLETED rollback을 먼저 삭제하면 안 됩니다.
const invalidCurrentSheets={ '스냅샷':new Sheet([header]), 'older-valid':new Sheet([header]), 'current-invalid':new Sheet([header,snap('2026-01-01','000001',999)]) };
const invalidCurrentSs=ssFor(invalidCurrentSheets), olderValidSignature=context._sheetContentSignature(invalidCurrentSheets['older-valid']);
scriptProperties.set('system_backup_registry_v1',JSON.stringify([
  {name:'older-valid',source:'스냅샷',signature:olderValidSignature,status:'COMPLETED',systemGenerated:true,operationId:'older-valid-op',completedAt:'2026-09-20T00:00:00Z'},
  {name:'current-invalid',source:'스냅샷',signature:olderValidSignature,status:'COMPLETED',systemGenerated:true,operationId:'current-invalid-op',completedAt:'2026-09-21T00:00:00Z'}
]));
const invalidCurrentCleanup=clone(context._cleanupCurrentSystemBackup(invalidCurrentSs,{name:'current-invalid',source:'스냅샷',operationId:'current-invalid-op'}));
assert.equal(invalidCurrentCleanup.deleted,false);
assert.match(invalidCurrentCleanup.reason,/signature 불일치/);
assert(invalidCurrentSheets['older-valid'],'현재 backup signature 불일치 시 과거 COMPLETED rollback 보호');
assert(invalidCurrentSheets['current-invalid'],'signature 불일치 current backup도 보호');
assert.deepEqual(JSON.parse(scriptProperties.get('system_backup_registry_v1')).map(item=>item.name),['older-valid','current-invalid'],'현재 검증 실패 시 registry도 보존');

const missingCurrentSheets={ '스냅샷':new Sheet([header]), 'older-survivor':new Sheet([header]) };
const missingCurrentSs=ssFor(missingCurrentSheets), missingCurrentSignature=context._sheetContentSignature(missingCurrentSheets['older-survivor']);
scriptProperties.set('system_backup_registry_v1',JSON.stringify([
  {name:'older-survivor',source:'스냅샷',signature:missingCurrentSignature,status:'COMPLETED',systemGenerated:true,operationId:'older-survivor-op',completedAt:'2026-09-20T00:00:00Z'},
  {name:'current-missing',source:'스냅샷',signature:missingCurrentSignature,status:'COMPLETED',systemGenerated:true,operationId:'current-missing-op',completedAt:'2026-09-21T00:00:00Z'}
]));
const missingCurrentCleanup=clone(context._cleanupCurrentSystemBackup(missingCurrentSs,{name:'current-missing',source:'스냅샷',operationId:'current-missing-op'}));
assert.equal(missingCurrentCleanup.deleted,false);
assert.match(missingCurrentCleanup.reason,/backup sheet 없음/);
assert.deepEqual(missingCurrentCleanup.staleDeleted,[],'현재 backup 누락 시 과거 cleanup 금지');
assert(missingCurrentSheets['older-survivor'],'현재 backup 누락 시 과거 COMPLETED rollback 보호');
assert.deepEqual(JSON.parse(scriptProperties.get('system_backup_registry_v1')).map(item=>item.name),['older-survivor'],'누락된 current registry만 정리하고 과거 rollback registry 보존');

const protectedSheets={ '스냅샷':new Sheet([header]), 'active-A':new Sheet([header]), 'mismatch-A':new Sheet([header,snap('2026-01-01','000001',999)]), 'formula-A':new Sheet([header]), 'success-C':new Sheet([header]), '참조':new Sheet([['ref']]) };
protectedSheets['참조'].formulaText="='formula-A'!A1";
const protectedSs=ssFor(protectedSheets), protectedSignature=context._sheetContentSignature(protectedSheets['active-A']);
scriptProperties.set('system_backup_registry_v1',JSON.stringify([
  {name:'active-A',source:'스냅샷',signature:protectedSignature,status:'CREATED',systemGenerated:true,operationId:'active-op',createdAt:'2026-09-18T00:00:00Z'},
  {name:'mismatch-A',source:'스냅샷',signature:protectedSignature,status:'COMPLETED',systemGenerated:true,operationId:'mismatch-op',completedAt:'2026-09-18T00:00:00Z'},
  {name:'formula-A',source:'스냅샷',signature:protectedSignature,status:'COMPLETED',systemGenerated:true,operationId:'formula-op',completedAt:'2026-09-18T00:00:00Z'},
  {name:'success-C',source:'스냅샷',signature:protectedSignature,status:'COMPLETED',systemGenerated:true,operationId:'success-op',completedAt:'2026-09-21T00:00:00Z'}
]));
context._snapshotBackupOperationId='active-op';
lifecycleCleanup=clone(context._cleanupCurrentSystemBackup(protectedSs,{name:'success-C',source:'스냅샷',operationId:'success-op'}));
context._snapshotBackupOperationId='';
assert(protectedSheets['active-A']&&protectedSheets['mismatch-A']&&protectedSheets['formula-A'],'active/signature mismatch/formula 백업 보호');
assert(lifecycleCleanup.staleProtected.some(item=>item.name==='active-A'&&/CREATED.*확인 불가/.test(item.reason)));
assert(lifecycleCleanup.staleProtected.some(item=>item.name==='mismatch-A'&&/signature/.test(item.reason)));
assert(lifecycleCleanup.staleProtected.some(item=>item.name==='formula-A'&&/수식/.test(item.reason)));

const missingRegistrySs=ssFor({'스냅샷':new Sheet([header])}); context.getss=()=>missingRegistrySs;
scriptProperties.set('system_backup_registry_v1',JSON.stringify([{name:'missing-only',source:'스냅샷',signature:'sig',status:'WRITE_FAILED',systemGenerated:true,createdAt:'2026-09-01T00:00:00Z'}]));
const missingMaintenance=clone(context.maintainSystemBackups({apply:true}));
assert.deepEqual(missingMaintenance.removedMissingRegistryRecords,['missing-only'],'sheet 없는 system registry record 정리');
assert.deepEqual(JSON.parse(scriptProperties.get('system_backup_registry_v1')),[]);
const unresolvedSheets={'스냅샷':new Sheet([header]),'failed-only':new Sheet([header]),'delete-fails':new Sheet([header])};
const unresolvedSs=ssFor(unresolvedSheets), unresolvedSignature=context._sheetContentSignature(unresolvedSheets['failed-only']);
scriptProperties.set('system_backup_registry_v1',JSON.stringify([{name:'failed-only',source:'스냅샷',signature:unresolvedSignature,status:'WRITE_FAILED',systemGenerated:true,createdAt:'2026-09-01T00:00:00Z'}]));
const unresolvedCleanup=clone(context._cleanupSystemBackups(unresolvedSs,'스냅샷',false));
assert(unresolvedSheets['failed-only'],'후속 성공 증거 없는 WRITE_FAILED 보호');
assert(unresolvedCleanup.unresolved.some(item=>item.name==='failed-only'&&/쓰기 실패/.test(item.reason)));
const deleteFailRecord={name:'delete-fails',source:'스냅샷',signature:context._sheetContentSignature(unresolvedSheets['delete-fails']),status:'COMPLETED',systemGenerated:true,operationId:'delete-fail-op',completedAt:'2026-09-22T00:00:00Z'};
scriptProperties.set('system_backup_registry_v1',JSON.stringify([deleteFailRecord]));
unresolvedSs.deleteSheet=()=>{throw new Error('delete denied');};
const deleteFailure=clone(context._cleanupCurrentSystemBackup(unresolvedSs,deleteFailRecord));
assert.match(deleteFailure.reason,/삭제 실패: delete denied/);
assert(JSON.parse(scriptProperties.get('system_backup_registry_v1')).some(item=>item.name==='delete-fails'),'삭제 실패 record를 거짓 삭제하지 않음');
assert.deepEqual(clone(context._normalizeCodeRows([[5930],[34230],[23280],['0046Y0'],['F00001'],['AAPL']],0)),
  [['005930'],['034230'],['023280'],['0046Y0'],['F00001'],['AAPL']],'숫자형 국내 코드 앞자리 0 복원 및 영숫자·해외 코드 보존');
const identicalRow=snap('2026-02-01','000001',100);
const canonicalDateRow=[new Date('2026-02-01T00:00:00Z'),5930,'삼성전자',1,'50',50,100,100,50,'100',' price_history ','old'];
const canonicalStringRow=['2026-02-01','005930','삼성전자',1,50,50,100,100,50,100,'PRICE_HISTORY','new'];
assert.equal(context._snapshotComparableSignature(canonicalDateRow),context._snapshotComparableSignature(canonicalStringRow),'Date/code/numeric/source/savedAt canonical comparison');
const conflictManual=snap('2026-02-02','000002',200,'MANUAL');
const conflictHistory=snap('2026-02-02','000002',210,'PRICE_HISTORY');
const identicalManual=snap('2026-02-06','000006',600,'MANUAL');
let manualDecision=clone(context._classifyRawSnapshotDuplicateGroups('2026-02-06',[identicalManual,clone(identicalManual)],[],''))[0];
assert.equal(manualDecision.classification,'EXACT_DUPLICATE','동일 MANUAL 물리 중복은 exact duplicate');
assert.equal(manualDecision.autoResolvable,true,'동일 MANUAL 중복은 한 행으로 안전 축약 가능');
manualDecision=clone(context._classifyRawSnapshotDuplicateGroups('2026-02-06',[identicalManual,snap('2026-02-06','000006',610,'MANUAL')],[],''))[0];
assert.equal(manualDecision.classification,'MANUAL_PROTECTED','값이 다른 MANUAL 충돌은 계속 보호');
assert.equal(manualDecision.autoResolvable,false,'서로 다른 MANUAL 충돌 자동 축약 금지');
const blankSnapshotRow=Array(12).fill('');
const unidentifiedSnapshotRow=['2026-02-01','','',1,50,50,100,100,50,100,'PRICE_HISTORY',''];
const duplicateSnapshot=new Sheet([header,identicalRow,blankSnapshotRow,clone(identicalRow),unidentifiedSnapshotRow,conflictManual,conflictHistory]);
const duplicateSs=ssFor({'스냅샷':duplicateSnapshot});
context.getss=()=>duplicateSs;
context._buildSnapshotRowsFromTradeAndPriceHistory=(_ss,date)=>date==='2026-02-02'?[conflictHistory]:[identicalRow];
const realRawSnapshotReader=context._readRawSnapshotRowsByDate;
let rawSnapshotReadCount=0;
context._readRawSnapshotRowsByDate=(...args)=>{rawSnapshotReadCount++;return realRawSnapshotReader(...args);};
const duplicateCleanup=clone(context.cleanupSnapshotDuplicates());
assert.equal(duplicateCleanup.removedRows,1,'완전히 동일한 중복만 자동 제거');
assert.equal(duplicateCleanup.manualProtectedGroups,1,'MANUAL 충돌을 별도 보고');
assert.equal(duplicateSnapshot.rows.filter(row=>row[0]==='2026-02-02').length,2,'MANUAL과 충돌하는 행은 첫 행 임의 선택 없이 보존');
assert(duplicateSnapshot.rows.some(row=>row.every(cell=>cell==='')),'중간 빈 행을 삭제하지 않고 read-back 검증 기준에서만 제외');
assert(duplicateSnapshot.rows.some(row=>row[0]==='2026-02-01'&&!row[1]&&!row[2]),'식별자 없는 기존 행 보존');
const cleanupRegistry=JSON.parse(scriptProperties.get('system_backup_registry_v1')||'[]');
assert(!cleanupRegistry.some(item=>item.source==='스냅샷'&&item.status==='WRITE_FAILED'),'유효행 대칭 검증 성공 후 backup이 WRITE_FAILED로 남지 않음');
assert.equal(rawSnapshotReadCount,0,'중복 없는 날짜를 날짜별 전체 Snapshot 재읽기하지 않음');
context._readRawSnapshotRowsByDate=realRawSnapshotReader;

// 날짜 유실 payload와 0좌 펀드 잔존 행은 안전정리 경로에서 제거하고 정상행은 유지합니다.
const damagedSnapshot=new Sheet([header,
  ['', '000001','날짜유실',1,50,50,100,100,50,100,'KRX',''],
  snap('2026-02-01','F00003',300,'FUND_NAV'),
  snap('2026-02-01','000001',100)
]);
const damagedUnits=new Sheet([['code','name','provider','start','units','at'],
  ['F00003','과거 펀드','FIDELITY_BIG4_S','2026-01-01',1000,''],
  ['F00003','과거 펀드','FIDELITY_BIG4_S','2026-02-01',0,'']
]);
const damagedSs=ssFor({'스냅샷':damagedSnapshot,'펀드좌수':damagedUnits});
context.getss=()=>damagedSs;
context._buildSnapshotRowsFromTradeAndPriceHistory=()=>[snap('2026-02-01','000001',100)];
const damagedCleanup=clone(context.cleanupSnapshotDuplicates());
assert.equal(damagedCleanup.invalidDateRowsRemoved,1,'날짜 유실 payload 제거');
assert.equal(damagedCleanup.zeroUnitFundRowsRemoved,1,'0좌 펀드 Snapshot 잔존 제거');
assert.equal(damagedCleanup.removedRows,2);
assert(damagedSnapshot.rows.some(row=>row[0]==='2026-02-01'&&row[1]==='000001'),'정상 Snapshot 유지');
assert.equal(damagedSnapshot.rows.some(row=>row[0]==='2026-02-01'&&row[1]==='F00003'),false,'0좌 F00003 제거');
context._buildSnapshotRowsFromTradeAndPriceHistory=realBuild;

const verifyWriteDedup=(stored,expected)=>{const target=new Sheet([header,...stored]);const targetSs=ssFor({'스냅샷':target});context.writeSnapshotRows(targetSs,expected[0],expected[1],true);return target.rows.filter(row=>row[0]===expected[0]);};
let writeRows=verifyWriteDedup([identicalRow,clone(identicalRow)],['2026-02-01',[identicalRow]]);
assert.equal(writeRows.length,1,'writeSnapshotRows exact duplicate를 실제 raw 1개로 축약');
const staleConflict=snap('2026-02-03','000003',300), expectedConflict=snap('2026-02-03','000003',330);
writeRows=verifyWriteDedup([staleConflict,expectedConflict],['2026-02-03',[expectedConflict]]);
assert.equal(writeRows.length,1,'writeSnapshotRows SINGLE_EXPECTED_MATCH를 expected raw 1개로 축약');
writeRows=verifyWriteDedup([snap('2026-02-04','000004',400,'MANUAL'),snap('2026-02-04','000004',410)],['2026-02-04',[snap('2026-02-04','000004',410)]]);
assert.equal(writeRows.length,2,'writeSnapshotRows MANUAL conflict 보존');
assert.deepEqual(writeRows,[snap('2026-02-04','000004',400,'MANUAL'),snap('2026-02-04','000004',410)],'MANUAL protected raw content 불변');
writeRows=verifyWriteDedup([snap('2026-02-05','000005',500),snap('2026-02-05','000005',510)],['2026-02-05',[snap('2026-02-05','000005',520)]]);
assert.equal(writeRows.length,2,'writeSnapshotRows unresolved conflict 보존');
assert.deepEqual(writeRows,[snap('2026-02-05','000005',500),snap('2026-02-05','000005',510)],'unresolved key의 기존 첫 raw와 행 개수 보존');
context._buildSnapshotRowsFromTradeAndPriceHistory=realBuild;
assert.equal(context._earliestChangedTradeDate([
  ['2026-01-02','buy','A','주식','000001',1,100]
],[
  ['2026-01-02','buy','A','주식','000001',1,100],
  ['2026-01-05','sell','A','주식','000001',1,120]
]),'2026-01-05','과거 거래 추가의 최초 영향일 계산');
context.today=()=> '2026-09-09';
context.getss=()=>importWriteSs;

// 운영값이 아닌 fixture NAV 2587.52도 NAV→가격이력→스냅샷에 같은 평가금액으로 연결됩니다.
const kbExampleNav=new Sheet([['date','code','name','nav','sourceDate','units','eval','at','provider']]);
const kbExamplePrices=new Sheet([['date','code','name','price','at','source']]);
const kbExampleSnapshots=new Sheet([header]);
const kbExampleSs=ssFor({'펀드좌수':importUnits,'펀드기준가격':kbExampleNav,'가격이력':kbExamplePrices,'거래이력':importWriteTrades,'스냅샷':kbExampleSnapshots});
context.getss=()=>kbExampleSs;
context.today=()=> '2026-09-22';
const kbExample=context.handleImportFundNav(importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2026-09-18',nav:2587.52}]));
assert.equal(kbExample.status,'ok');
assert.equal(kbExampleNav.rows.find(row=>row[0]==='2026-09-18')[6],2588,'fixture NAV × 1000좌 ÷ 1000 평가금액');
assert.equal(kbExamplePrices.rows.find(row=>row[0]==='2026-09-18')[3],2588,'가격이력 평가금액 일치');
assert.equal(kbExampleSnapshots.rows.find(row=>row[0]==='2026-09-18'&&row[1]==='F00002')[7],2588,'Snapshot 평가금액 일치');
context.today=()=> '2026-09-09';
context.getss=()=>importWriteSs;

// 오늘 미공시는 과거 확정 NAV 누락과 별도 상태로 집계합니다.
const pendingTodaySs=ssFor({'펀드좌수':new Sheet([['code','name','provider','start','units','at'],['F00002','KB','KB_VALUE_ST','2026-09-01',1000,'']]),
  '펀드기준가격':new Sheet([['date','code','name','nav','sourceDate','units','eval','at','provider'],['2026-09-08','F00002','KB',1200,'2026-09-08',1000,1200,'','KB_VALUE_ST']])});
context._buildSnapshotRowsFromTradeAndPriceHistory=()=>[];
const pendingToday=context._refreshFundValuations(pendingTodaySs,'2026-09-09','2026-09-09','F00002',true);
assert.equal(pendingToday.fundResults.F00002.latestUnpublished,1);
assert.equal(pendingToday.fundResults.F00002.navMissing,0);
context.today=()=> '2026-09-21'; // F00001 월요일은 정상 비공시일
const nonPublicationSs=ssFor({
  '펀드좌수':new Sheet([['code','name','provider','start','units','at'],['F00001','한화','HANWHA_2045_CRPE','2026-09-01',1000,'']]),
  '펀드기준가격':new Sheet([['date','code','name','nav','sourceDate','units','eval','at','provider'],['2026-09-18','F00001','한화',1200,'2026-09-18',1000,1200,'','HANWHA_2045_CRPE']]),
  '거래이력':new Sheet([Array(8).fill('header'),['2026-09-01','buy','계좌','한화','F00001',1,1000,'펀드']]),
  '가격이력':new Sheet([['date','code','name','price','at','source']])
});
context._buildSnapshotRowsFromTradeAndPriceHistory=()=>[];
const nonPublication=context._refreshFundValuations(nonPublicationSs,'2026-09-21','2026-09-21','F00001');
assert.equal(nonPublication.fundResults.F00001.dates[0].navState,'NON_PUBLICATION_CARRY','당일이어도 정상 비공시일은 미공시가 아닌 이월로 분류');
assert.equal(nonPublication.fundResults.F00001.dates[0].valuationRequired,true,'직전 확정 NAV가 있는 비공시일은 carry 평가 생성 대상 유지');
assert.equal(nonPublication.fundResults.F00001.latestUnpublished,0);
const readOnlyMonday=clone(context._getFundValuationStatus(nonPublicationSs,'2026-09-21','2026-09-21','F00001'));
assert.equal(readOnlyMonday.dates[0].navState,'NON_PUBLICATION_CARRY','read-only 재검증도 월요일을 정상 이월로 판정');
assert.equal(readOnlyMonday.dates[0].valuationRequired,true,'조회와 저장 경로가 비공시 carry 생성 대상 정책을 공유');

// 외부 API 오류 범위가 정상 비공시일을 포함해도 월·목·주말 상태를 API_FAILED로 덮어쓰지 않습니다.
context.today=()=> '2026-09-28';
const savedBatchFetch=context._fetchMissingFundNavBatches;
context._fetchMissingFundNavBatches=()=>({rows:[],batches:[],errors:[{from:'2026-09-21',to:'2026-09-27',message:'provider timeout'}]});
const broadError=context._refreshFundValuations(nonPublicationSs,'2026-09-21','2026-09-27','F00001');
const broadStates=Object.fromEntries(broadError.fundResults.F00001.dates.map(day=>[day.date,day.navState]));
assert.equal(broadStates['2026-09-21'],'NON_PUBLICATION_CARRY','월요일 API 실패 오염 방지');
assert.equal(broadStates['2026-09-24'],'NON_PUBLICATION_CARRY','목요일 API 실패 오염 방지');
assert.equal(broadStates['2026-09-26'],'NON_PUBLICATION_CARRY','토요일 API 실패 오염 방지');
assert.equal(broadStates['2026-09-27'],'NON_PUBLICATION_CARRY','일요일 API 실패 오염 방지');
assert.equal(broadStates['2026-09-22'],'API_FAILED','실제 공시 예상·미확보일은 API_FAILED 유지');
context._fetchMissingFundNavBatches=savedBatchFetch;
context.today=()=> '2026-09-09';
context._buildSnapshotRowsFromTradeAndPriceHistory=realBuild;

// 확정 NAV와 평가금액이 일치하면 남아 있는 임시 source만으로 그래프 경고를 유지하지 않습니다.
context.jsonOk=extra=>({status:'ok',...extra});
const historyConsistencySs=ssFor({
  '펀드기준가격':new Sheet([['date','code','name','nav','sourceDate','units','eval','at','provider'],
    ['2026-09-16','F00001','한화',2054.75,'2026-09-16',15567554,31987432,'','HANWHA_2045_CRPE']]),
  '스냅샷':new Sheet([header,
    ['2026-09-16','F00001','한화',1,30000000,30000000,31987432,31987432,1987432,6.62,'FUND_NAV_CARRY_INPUT_REQUIRED',''],
    ['2026-09-16','F00002','KB',1,1000,1000,1100,1100,100,10,'FUND_NAV_CARRY_INPUT_REQUIRED','']])
});
context.getss=()=>historyConsistencySs;
const historyConsistency=clone(context.handleGetHistory('2026-09-16','2026-09-16'));
assert.deepEqual(historyConsistency.snapshots[0].navInputRequiredCodes,['F00002'],'확정 NAV 평가금액 일치 F00001 경고만 제거하고 실제 미확정 F00002 유지');

// Script Properties에는 날짜 상세 배열을 저장하지 않고 충분히 작은 운영 요약만 기록합니다.
const oversizedDailyResult={
  completionStatus:'partial',saved:96,navSaved:24,snapshots:20,lastDate:'2026-09-30',missingHoldings:[],
  fundResults:{}
};
['F00001','F00002','F00003'].forEach((code,index)=>{
  oversizedDailyResult.fundResults[code]={
    status:index===1?'partial':'ok',storedNav:10,apiRequested:8,apiSuccess:7,apiFailed:1,navMissing:index===1?2:0,
    latestUnpublished:1,carried:6,zeroUnitsExcluded:index===2?12:0,inputRequiredDates:index===1?['2026-09-29','2026-09-30']:[],
    snapshots:20,dates:Array.from({length:32},(_,day)=>({date:'2026-09-'+String(day+1).padStart(2,'0'),navState:'CONFIRMED',evaluationState:'SAVED_OR_UPDATED',snapshotState:'SAVED_OR_UPDATED',extra:'x'.repeat(120)}))
  };
});
const compactDailyResult=clone(context._compactFundDailyResultForProperty(oversizedDailyResult));
const compactDailyJson=JSON.stringify(compactDailyResult);
assert(compactDailyJson.length<4000,'일일 펀드 Properties 요약은 날짜 상세를 제외해 충분히 작아야 함');
assert.equal(Object.prototype.hasOwnProperty.call(compactDailyResult.funds.F00001,'dates'),false,'날짜별 상세 배열 Properties 저장 금지');
assert.equal(compactDailyResult.funds.F00002.inputRequiredCount,2,'입력 필요 건수는 요약에 유지');
assert.equal(compactDailyResult.snapshotWarningCount,0,'Snapshot 보호 경고 건수도 compact summary에 기록');
assert.equal(context._compactFundDailyResultForProperty({completionStatus:'ok',lastDate:'',missingHoldings:[],fundResults:{}},'2026-09-09').lastDate,'2026-09-09','무변경 실행은 요청 종료일을 최근 처리 기준일로 보존');

// 일일 실행의 partial은 자동화 자체를 실패시키지 않고 경고로 기록하며, hard error만 실패 처리합니다.
const savedRefresh=context._refreshFundValuations;
context._refreshFundValuations=()=>({completionStatus:'ok',saved:0,navSaved:0,snapshots:0,lastDate:'',missingHoldings:[],fundResults:{F00001:{status:'ok',inputRequiredDates:[]}}});
assert.doesNotThrow(()=>context.runDailyFundValuations(),'변경 없는 정상 일일 실행도 성공');
assert.equal(JSON.parse(scriptProperties.get('fund_last_result')||'{}').lastDate,'2026-09-09','무변경 일일 실행 Properties 기준일 보존');
context._refreshFundValuations=()=>oversizedDailyResult;
assert.doesNotThrow(()=>context.runDailyFundValuations(),'일일 partial은 저장된 성공분을 유지하고 warning으로 기록');
assert.match(scriptProperties.get('fund_last_warning')||'',/F00002.*NAV 미확보 2일/);
const storedDailyProperty=scriptProperties.get('fund_last_result')||'';
assert(storedDailyProperty.length<4000,'실제 fund_last_result도 Properties 제한보다 충분히 작게 저장');
assert.equal(JSON.parse(storedDailyProperty).lastDate,'2026-09-30');
assert.equal(Object.prototype.hasOwnProperty.call(JSON.parse(storedDailyProperty).funds.F00001,'dates'),false);
const protectedSnapshotReason='2026-09-08:MANUAL_PROTECTED: MANUAL 행 보호';
context._refreshFundValuations=()=>({
  completionStatus:'partial',saved:0,navSaved:0,snapshots:0,lastDate:'2026-09-08',
  missingHoldings:[protectedSnapshotReason],snapshotWarnings:[protectedSnapshotReason],
  fundResults:{F00002:{status:'partial',navMissing:0,inputRequiredDates:[]}}
});
assert.doesNotThrow(()=>context.runDailyFundValuations(),'보호된 Snapshot 충돌은 일일 hard failure가 아님');
assert.match(scriptProperties.get('fund_last_warning')||'',/Snapshot 보호 충돌 1건/,'보호 충돌은 warning에 기록');
assert.equal(JSON.parse(scriptProperties.get('fund_last_result')||'{}').snapshotWarningCount,1);
context._refreshFundValuations=()=>({completionStatus:'partial',missingHoldings:['2026-09-08:F00001'],snapshotWarnings:[],fundResults:{F00001:{status:'partial',navMissing:0,inputRequiredDates:[]}}});
assert.throws(()=>context.runDailyFundValuations(),/거래이력 없는 스냅샷 1건/,'실제 보유자료 누락은 hard failure 유지');
context._refreshFundValuations=()=>({completionStatus:'partial',missingHoldings:[],snapshotWarnings:[],fundResults:{F00001:{status:'error',navMissing:1,inputRequiredDates:[]}}});
assert.throws(()=>context.runDailyFundValuations(),/F00001/,'hard error는 일일 자동화 실패로 기록');
context._refreshFundValuations=savedRefresh;

// 파생 시트 쓰기 실패 뒤에도 저장 확정 NAV를 이용해 재실행할 수 있습니다.
const retryUnits=new Sheet([['code','name','provider','start','units','at'],['F00002','KB','KB_VALUE_ST','2026-08-01',1000,'']]);
const retryNav=new Sheet([['date','code','name','nav','sourceDate','units','eval','at','provider'],['2026-08-03','F00002','KB',1200,'2026-08-03',1000,1200,'','KB_VALUE_ST']]);
const retryPrices=new Sheet([['date','code','name','price','at','source']]); retryPrices.failWrite=true;
const retrySheets={'펀드좌수':retryUnits,'펀드기준가격':retryNav,'가격이력':retryPrices};
context._buildSnapshotRowsFromTradeAndPriceHistory=()=>[];
assert.throws(()=>context._refreshFundValuations(ssFor(retrySheets),'2026-08-03','2026-08-03','F00002'),/write failed/);
assert.equal(retryNav.rows[1][3],1200,'파생 시트 실패 시 기존 NAV 보존');
retryPrices.failWrite=false;
assert.equal(context._refreshFundValuations(ssFor(retrySheets),'2026-08-03','2026-08-03','F00002').saved,1,'재실행에서 저장 NAV로 가격이력 복구');
context._buildSnapshotRowsFromTradeAndPriceHistory=realBuild;

// 날짜 존재가 아닌 거래원장 기준 종목·값·충돌 정합성을 판정합니다.
const integrityExpected=[snap('2026-07-22','000001',100),snap('2026-07-22','000002',200),snap('2026-07-22','F00002',300,'FUND_NAV_CARRY')];
context._buildSnapshotRowsFromTradeAndPriceHistory=()=>clone(integrityExpected);
let integritySs=ssFor({'스냅샷':new Sheet([header,integrityExpected[0],integrityExpected[2]])});
let integrity=clone(context.diagnoseSnapshotIntegrity(integritySs,'2026-07-22'));
assert.equal(integrity.status,'PARTIAL');
assert.deepEqual(integrity.missingCodes,['000002'],'기대 보유 3종목 중 누락 1종목 탐지');
integritySs=ssFor({'스냅샷':new Sheet([header,integrityExpected[0],snap('2026-07-22','000002',201),integrityExpected[2]])});
integrity=clone(context.diagnoseSnapshotIntegrity(integritySs,'2026-07-22'));
assert.equal(integrity.status,'MISMATCH','행 수가 같아도 evalAmt 불일치 탐지');
integritySs=ssFor({'스냅샷':new Sheet([header,...integrityExpected])});
integrity=clone(context.diagnoseSnapshotIntegrity(integritySs,'2026-07-22'));
assert.equal(integrity.status,'VALID','NAV carry는 정합하면 Snapshot 완전성 VALID');
assert.equal(integrity.fundNavStates[0].temporary,true,'NAV 임시 평가 상태는 별도 유지');
const savedAtDuplicate=clone(integrityExpected[0]); savedAtDuplicate[11]='later';
integritySs=ssFor({'스냅샷':new Sheet([header,integrityExpected[0],savedAtDuplicate,integrityExpected[1],integrityExpected[2]])});
integrity=clone(context.diagnoseSnapshotIntegrity(integritySs,'2026-07-22'));
assert.deepEqual(integrity.duplicateKeys,['2026-07-22|000001'],'savedAt-only 중복 key 기록');
assert.deepEqual(integrity.conflictKeys,[],'savedAt-only exact duplicate는 false conflict 금지');
assert.equal(integrity.status,'PARTIAL','savedAt-only 중복은 자동 재작성 가능한 부분 상태');
let diagnosisDecision=clone(context._classifyRawSnapshotDuplicateGroups('2026-07-22',[integrityExpected[0],savedAtDuplicate],integrityExpected,''))[0];
assert.equal(diagnosisDecision.classification,'EXACT_DUPLICATE','진단과 cleanup의 savedAt-only 분류 일치');
const canonicalDuplicate=clone(integrityExpected[0]); canonicalDuplicate[3]=String(canonicalDuplicate[3]); canonicalDuplicate[10]=String(canonicalDuplicate[10]).toLowerCase();
diagnosisDecision=clone(context._classifyRawSnapshotDuplicateGroups('2026-07-22',[integrityExpected[0],canonicalDuplicate],integrityExpected,''))[0];
assert.equal(diagnosisDecision.classification,'EXACT_DUPLICATE','숫자 type/source 대소문자 canonical 중복');
const wrongExpectedCandidate=snap('2026-07-22','000001',101);
diagnosisDecision=clone(context._classifyRawSnapshotDuplicateGroups('2026-07-22',[integrityExpected[0],wrongExpectedCandidate],integrityExpected,''))[0];
assert.equal(diagnosisDecision.classification,'SINGLE_EXPECTED_MATCH','두 값 중 expected 단일 일치');
assert.equal(diagnosisDecision.autoResolvable,true,'expected 단일 일치는 자동 해결 가능');
integritySs=ssFor({'스냅샷':new Sheet([header,integrityExpected[0],wrongExpectedCandidate,integrityExpected[1],integrityExpected[2]])});
integrity=clone(context.diagnoseSnapshotIntegrity(integritySs,'2026-07-22'));
assert.deepEqual(integrity.conflictKeys,[],'expected 단일 일치는 conflict가 아님');
assert.equal(integrity.status,'PARTIAL','expected 단일 일치는 자동 재작성 가능한 부분 상태');
integritySs=ssFor({'스냅샷':new Sheet([header,snap('2026-07-22','000001',101),snap('2026-07-22','000001',102)])});
assert.equal(context.diagnoseSnapshotIntegrity(integritySs,'2026-07-22').status,'CONFLICT','expected와 일치하지 않는 동일 date+code 이값 충돌 탐지');
context._buildSnapshotRowsFromTradeAndPriceHistory=()=>{ throw new Error('확정 원자료 부족: FX_USD'); };
assert.equal(context.diagnoseSnapshotIntegrity(integritySs,'2026-07-22').status,'SOURCE_INCOMPLETE','과거 환율 부재 시 재작성 불가');
context._buildSnapshotRowsFromTradeAndPriceHistory=realBuild;

// 백업 진단은 같은 실행의 서명만 재사용하고 모든 시트의 참조는 계속 검사합니다.
{
  const backupName = '스냅샷_백업_20261006_120000_abcdef';
  const sheets = { '스냅샷': new Sheet([header]), [backupName]: new Sheet([header, snap('2026-01-01','000001',100)]), '참조시트': new Sheet([['수식']]) };
  const ss = ssFor(sheets), backup = sheets[backupName];
  const record = { name: backupName, source: '스냅샷', signature: context._sheetContentSignature(backup), status: 'COMPLETED', systemGenerated: true, operationId: 'diagnosis-test' };
  scriptProperties.set('system_backup_registry_v1', JSON.stringify([record]));
  context.getss = () => ss;
  let valuesReads = 0, formulaReads = 0;
  const getRange = backup.getRange.bind(backup);
  backup.getRange = (...args) => {
    const range = getRange(...args);
    if (args[2] === backup.getLastRow()) {
      const getValues = range.getValues, getFormulas = range.getFormulas;
      range.getValues = () => { valuesReads++; return getValues(); };
      range.getFormulas = () => { formulaReads++; return getFormulas(); };
    }
    return range;
  };
  const propertiesBefore = scriptProperties.get('system_backup_registry_v1');
  let plan = clone(context.maintainSystemBackups({ apply: false }));
  assert.equal(valuesReads, 1, '등록 백업 전체 값 읽기는 진단당 한 번');
  assert.equal(formulaReads, 2, '등록 백업 수식 읽기는 참조 스캔·서명 각 한 번');
  assert.equal(plan.backupSheets[0].autoCleanupEligible, true);
  assert.equal(scriptProperties.get('system_backup_registry_v1'), propertiesBefore, 'dry-run registry 변경 금지');
  assert(ss.getSheetByName(backupName), 'dry-run 시트 삭제 금지');
  sheets['참조시트'].formulaText = "='" + backupName + "'!A1";
  plan = clone(context.maintainSystemBackups({ apply: false }));
  assert.equal(plan.backupSheets[0].formulaReferenceCount, 1, '비백업 시트의 quoted 참조 보호');
  assert.equal(plan.backupSheets[0].autoCleanupEligible, false);
  sheets['참조시트'].formulaText = '=' + backupName + '!A1';
  assert.equal(context.maintainSystemBackups({ apply: false }).backupSheets[0].formulaReferenceCount, 1, 'plain 참조 보호');
  sheets['참조시트'].formulaText = '';
  backup.rows[1][6] = 999;
  plan = clone(context.maintainSystemBackups({ apply: false }));
  assert.equal(plan.backupSheets[0].signatureMatch, false, '다음 진단은 서명 새로 검증');
  assert.equal(plan.backupSheets[0].autoCleanupEligible, false, '손상 백업 보호');
  const applyResult = clone(context.maintainSystemBackups({ apply: true }));
  assert.deepEqual(applyResult.deletedSheetNames, [], '이전 dry-run 후보를 삭제에 재사용 금지');
  assert(ss.getSheetByName(backupName));
  const emptySs = ssFor({ '가격이력': new Sheet([['값']]) });
  emptySs.getSheetByName('가격이력').getRange = () => { throw new Error('백업 없는 진단의 수식 읽기'); };
  scriptProperties.set('system_backup_registry_v1', '[]');
  context.getss = () => emptySs;
  assert.equal(context.maintainSystemBackups({ apply: false }).beforeCount, 0, '백업 없으면 수식 읽기 생략');
  assert.deepEqual(clone(context._sheetFormulaReferenceCounts({ getSheets() { throw new Error('빈 대상 스캔'); } }, [])), {});
  const apiSs = ssFor({ '스냅샷': new Sheet([['값']]), '참조시트': new Sheet([['수식']]) });
  apiSs.getSheetByName('참조시트').formulaText = "='스냅샷'!A1";
  assert.equal(context._diagnoseWorkbookCells(apiSs, true).sheets.find(item => item.name === '스냅샷').formulaReferenceCount, 1, '일반 셀 진단의 비백업 참조 API 유지');
}

// 전체 함수 선언이 중복돼 엄격 오류 옵션을 덮어쓰는 회귀 차단.
const declarations=[...source.matchAll(/^function\s+(\w+)\s*\(/gm)].map(m=>m[1]);
assert.equal(new Set(declarations).size,declarations.length,'GAS 함수 중복 선언');
console.log('✅ 펀드 좌수·날짜·이월·중복실행·스냅샷/수동값 보존·쓰기 실패 회귀 검사 통과');
