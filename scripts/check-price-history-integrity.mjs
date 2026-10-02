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
assert.match(gas, /function cleanupPriceHistoryDuplicates[\s\S]*setValues\(_normalizeCodeRows\(deduped[\s\S]*_touchSnapshotIntegritySourceRevision/, '가격 중복 정리는 실제 쓰기 성공 후 invalidate');
assert.match(gas, /function cleanupSnapshotDuplicates[\s\S]*setValues\(output\)[\s\S]*_touchSnapshotIntegritySourceRevision/, 'Snapshot 중복 정리는 실제 쓰기 성공 후 invalidate');
assert.match(gas, /function _repairKnownCodeColumns[\s\S]*range\.setValues\(values\)[\s\S]*_touchSnapshotIntegritySourceRevision/, '코드 복구는 실제 쓰기 성공 후 invalidate');
assert.match(pipeline, /미검증 날짜는 저장 Snapshot으로 표시/);
assert.match(view, /HISTORY_BLOCKING_INTEGRITY_STATUSES[^\n]*PARTIAL[^\n]*MISMATCH[^\n]*CONFLICT[^\n]*NO_SNAPSHOT/);
assert.match(view, /portfolioSnapshots[\s\S]*filter\(_isVerifiedHistoryPoint\)/);
assert.match(html, /views\/views_history\.js\?v=20260930-3/);
assert.match(sw, /views\/views_history\.js\?v=20260930-3/);
assert.match(sw, /portfolio-cache-20261002-6/);
assert.doesNotMatch(sw, /views\/views_history\.js\?v=20260917-2/);
console.log('✅ 가격이력 독립 진단·range read 재사용·미검증 Snapshot 성과 유지·복구/cache 회귀 검사 통과');
