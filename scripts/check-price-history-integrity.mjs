import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const gas = fs.readFileSync('src/gas/apps_script.gs', 'utf8');
const view = fs.readFileSync('src/web/views/views_history.js', 'utf8');
const pipeline = fs.readFileSync('src/web/views/views_history_pipeline.js', 'utf8');
const html = fs.readFileSync('src/web/index.html', 'utf8');
const sw = fs.readFileSync('src/web/sw.js', 'utf8');
const start = gas.indexOf('var PRICE_HISTORY_UNVERIFIED_SOURCES');
const end = gas.indexOf('function diagnosePriceHistoryIntegrity', start);
const source = gas.slice(start, end);
const context = {
  _normalizeDate: String,
  _normalizeDatetime: String,
  _cleanCode: value => String(value || '').trim(),
};
vm.runInNewContext(`${source}\nglobalThis.classify=_priceIntegrityRows;`, context);
const make = (prices, sourceName = 'KRX_CONFIRMED_CLOSE', extra = {}) => ({
  priceRows: prices.map(([date, price]) => [date, '005930', '삼성전자', price, `${date}T16:00:00`, sourceName]),
  tradeRows: extra.tradeRows || [], fxRows: extra.fxRows || [], navRows: [],
  byCode: { '005930': { code: '005930', name: '삼성전자', currency: extra.currency || 'KRW' } }, codeItems: [],
});
let rows = context.classify(make([['2026-09-23',200000],['2026-09-24',2000],['2026-09-25',201000]]), ['2026-09-24'], []);
assert.equal(rows[0].status, 'SUSPICIOUS_DROP');
rows = context.classify(make([['2026-09-23',200000],['2026-09-24',20000000],['2026-09-25',201000]]), ['2026-09-24'], []);
assert.equal(rows[0].status, 'SUSPICIOUS_SPIKE');
rows = context.classify(make([['2026-09-23',200000],['2026-09-24',2000],['2026-09-25',201000]], 'KRX_CONFIRMED_CLOSE', { tradeRows:[['2026-09-24','','','','005930']] }), ['2026-09-24'], []);
assert.equal(rows[0].status, 'CORPORATE_ACTION_REVIEW');
rows = context.classify(make([['2026-09-23',200000],['2026-09-24',2000],['2026-09-25',201000]], 'MANUAL'), ['2026-09-24'], []);
assert.equal(rows[0].status, 'MANUAL_PROTECTED');
rows = context.classify(make([['2026-09-24',100]], 'KRX_CONFIRMED_CLOSE', { currency:'USD', fxRows:[['2026-09-24','USD',0]] }), ['2026-09-24'], []);
assert.equal(rows[0].status, 'FX_MISSING');
rows = context.classify(make([['2026-09-24',100]], 'TOSS_DAILY_CANDLE_UNVERIFIED_CLOSE'), ['2026-09-24'], []);
assert.equal(rows[0].status, 'SOURCE_INVALID');
assert.match(gas, /result\.status === 'VALID'[\s\S]*PRICE_SUSPICIOUS/);
assert.match(gas, /_buildSnapshotRangeReadContext[\s\S]*sheetReads: names\.length/);
for (const metric of ['totalMs','readMs','calculationMs','checkedDates','priceHistoryRows','snapshotRows','tradeRows','fundNavRows','fxRows']) assert.match(gas, new RegExp(metric));
assert.match(gas, /handlePreviewPriceHistoryRepair/);
assert.match(gas, /handleApplyPriceHistoryRepair/);
assert.match(gas, /MANUAL 가격은 자동 교정할 수 없습니다/);
assert.match(pipeline, /rangeDiagnosisFailed = \{/);
assert.match(gas, /handleApplyPriceHistoryRepair[\s\S]*_touchSnapshotIntegritySourceRevision\(\)/, '가격이력 교정은 정합성 cache revision을 갱신해야 합니다.');
assert.match(gas, /_isSnapshotIntegritySourceSheet[\s\S]*SHEET_TRADES[\s\S]*SHEET_PH[\s\S]*FUND_NAV_SHEET[\s\S]*환율이력/, '거래·가격·펀드 NAV·환율 원자료를 revision 대상에 포함해야 합니다.');
assert.match(gas, /_isSnapshotIntegritySourceSheet[\s\S]*SHEET_SNAPSHOT/, 'Snapshot 상세행 변경도 cache revision 대상이어야 합니다.');
assert.match(gas, /function writeSnapshotRows[\s\S]*_touchSnapshotIntegritySourceRevision\(\)/, 'rewrite를 포함한 Snapshot 저장은 cache revision을 갱신해야 합니다.');
assert.doesNotMatch(gas.match(/function _backupSheetBeforeWrite[\s\S]*?\n}/)?.[0] || '', /_touchSnapshotIntegritySourceRevision/, '백업 생성 단계에서 실제 쓰기보다 먼저 revision을 갱신하면 안 됩니다.');
const priceDuplicateCleanupFn = gas.match(/function _cleanupPriceHistoryDuplicatesLocked\([\s\S]*?\n}/)?.[0] || '';
assert.match(priceDuplicateCleanupFn, /range\.setValues\(\[emptyRow\]\)[\s\S]*_touchSnapshotIntegritySourceRevision/, '가격 중복 정리는 제거 대상 물리행 쓰기 이후 revision 갱신');
assert.doesNotMatch(priceDuplicateCleanupFn, /ph\.clearContents\(\)|setValues\(_normalizeCodeRows\(deduped/, '가격이력 중복 정리의 전체행 초기화·재배열 금지');
const scopedSnapshotCleanupBody = gas.match(/function _cleanupSnapshotDuplicatesLocked\([\s\S]*?\n}/)?.[0] || '';
assert.match(scopedSnapshotCleanupBody, /range\.setValues\(\[blank\(fullWidth\)\]\)[\s\S]*_touchSnapshotIntegritySourceRevision/, 'Snapshot 중복 정리는 검증된 대상 물리행 쓰기 후에만 revision 갱신');
assert.doesNotMatch(scopedSnapshotCleanupBody, /setValues\(output\)/, '전체 Snapshot 행압축 재기록 금지');
const codeRepairFn=gas.match(/function _repairKnownCodeColumns\([\s\S]*?\n}/)?.[0] || '';
assert.match(codeRepairFn, /cell\.setValues\(\[\[plan\.desired\]\]\)[\s\S]*_touchSnapshotIntegritySourceRevision/, '코드 복구는 변경 대상 셀 기록 성공 후 invalidate');
assert.doesNotMatch(codeRepairFn, /range\.setValues\(values\)|_setCodeColumnText\(sheet,\s*column\)/, '코드 복구의 전체 열 재기록/무변경 서식 변경 금지');
assert.match(pipeline, /미검증 날짜는 저장 Snapshot으로 표시/);
assert.match(view, /HISTORY_BLOCKING_INTEGRITY_STATUSES[^\n]*PARTIAL[^\n]*MISMATCH[^\n]*CONFLICT[^\n]*NO_SNAPSHOT/);
assert.match(view, /portfolioSnapshots[\s\S]*filter\(_isVerifiedHistoryPoint\)/);
assert.match(html, /views\/views_history\.js\?v=20261012-2/);
assert.match(sw, /views\/views_history\.js\?v=20261012-2/);
const viewerScriptVersion=html.match(/views\/views_portfolio\.js\?v=(\d{8}-\d+)/);
const systemScriptVersion=html.match(/views\/views_system\.js\?v=(\d{8}-\d+)/);
const cacheVersion=sw.match(/const CACHE_NAME\s*=\s*'portfolio-cache-(\d{8}-\d+)'/);
assert.ok(viewerScriptVersion && systemScriptVersion && cacheVersion,
  'combined viewer must have versioned URLs and cache');
assert.ok(sw.includes('./views/views_portfolio.js?v='+viewerScriptVersion[1]),
  'portfolio cache and PWA precache viewer revisions must match');
assert.ok(sw.includes('./views/views_system.js?v='+systemScriptVersion[1]),
  'outer view cache and PWA precache viewer revisions must match');
assert.ok(html.includes("serviceWorker.register('sw.js?v="+cacheVersion[1]+"'"),
  'PWA registration and precache must be the same release');

assert.match(sw, /portfolio-cache-\d{8}-\d+/);
assert.doesNotMatch(sw, /views\/views_history\.js\?v=20260917-2/);
console.log('✅ 가격이력 독립 진단·range read 재사용·미검증 Snapshot 성과 유지·복구/cache 회귀 검사 통과');


// The batched KRX writer must fail before the first write when a single
// payload contains duplicate (date, code) keys. Never append duplicate rows.
{
 const start=gas.indexOf('function batchUpsertPriceHistory(');
 const end=gas.indexOf('function upsertPriceHistory(',start);
 assert.ok(start>=0&&end>start,'batch writer present');
 const source=gas.slice(start,end);
 const stored=[['날짜','종목코드','종목명','가격','입력일시','가격소스']];
 const mockSheet={
  getLastRow:()=>stored.length,getLastColumn:()=>6,
  getRange:(r,c,n=1,w=1)=>({
   getValues:()=>stored.slice(r-1,r-1+n).map(row=>row.slice(c-1,c-1+w)),
   setValues:arr=>{arr.forEach((row,i)=>{const pos=r-1+i;while(stored.length<=pos)stored.push([]);
    row.forEach((v,j)=>{stored[pos][c-1+j]=v;});});}
  })
 };
 let revisions=0, formatWrites=0, sheetReads=0;
 const ctx={CONFIG:{SHEET_PH:'가격이력'},
  _normalizeDate:x=>String(x),_cleanCode:x=>String(x||'').trim(),
  _setCodeColumnText:()=>{formatWrites++;},_normalizeCodeRows:x=>x,
  _touchSnapshotIntegritySourceRevision:()=>{revisions++;},
  SpreadsheetApp:{flush:()=>{}},Logger:{log:()=>{}}
 };
 vm.runInNewContext(source,ctx);
 const ss={getSheetByName:()=>{sheetReads++;return mockSheet;}};
 const row={code:'005930',name:'삼성전자',price:123,source:'KRX'};
 assert.throws(()=>ctx.batchUpsertPriceHistory(ss,'2026-10-08',[row,{...row}]),
  /동일 날짜·종목 중복 입력/);
 assert.equal(stored.length,1,'failed duplicate batch must not touch data');
 assert.equal(revisions,0,'failed duplicate batch must not modify revision');
 assert.equal(formatWrites,0,'failed duplicate batch must not touch code-column formatting');
 assert.equal(sheetReads,0,'failed duplicate batch must not even read/create price sheet');
 ctx.batchUpsertPriceHistory(ss,'2026-10-08',[row]);
 assert.equal(stored.length,2);
 ctx.batchUpsertPriceHistory(ss,'2026-10-08',[{...row,price:124}]);
 assert.equal(stored.length,2,'retried official close must update rather than append');
 assert.equal(stored[1][3],124);
}
console.log('✅ 동일 날짜·코드 중복 배치 입력 차단 및 재시도 업서트 멱등성 통과');
