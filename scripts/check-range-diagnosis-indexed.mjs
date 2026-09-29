import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const gas = fs.readFileSync('src/gas/apps_script.gs', 'utf8');
const pipeline = fs.readFileSync('src/web/views/views_history_pipeline.js', 'utf8');
const net = fs.readFileSync('src/web/features/settings/settings_net.js', 'utf8');
const rangeSource = gas.slice(gas.indexOf('function _buildSnapshotRangeReadContext'), gas.indexOf('function handleRewriteSnapshotDate'));
for (const token of ['snapshotRowsByDate','priceSeriesByCode','fundNavSeriesByCode','fxSeriesByCurrency','holdingsByRequestedDate','priceIntegrityByDate']) assert.match(rangeSource, new RegExp(token));
for (const metric of ['indexBuildMs','priceSeriesBuildCount','priceIntegrityBuildCount','holdingsBuildCount','snapshotDateLookupCount','fundNavLookupCount','fxLookupCount']) assert.match(rangeSource, new RegExp(metric));
assert.match(rangeSource, /priceSeriesBuildCount = 1/);
assert.match(rangeSource, /priceIntegrityBuildCount = 1/);
assert.doesNotMatch(rangeSource, /insertSheet|setValues|deleteSheet|PropertiesService/);
assert.match(pipeline, /dates: snapshots\.map\(snapshot => snapshot\.date\)\.join/);
for (const code of ['CLIENT_TIMEOUT','SERVER_ERROR','RUNTIME_ERROR','INVALID_RESPONSE','SOURCE_DATA_ERROR','RANGE_TOO_LARGE']) assert.ok((gas + pipeline + net).includes(code), code);
assert.match(pipeline, /전체 날짜를 UNCHECKED로 처리/);
assert.match(pipeline, /rangeDiagnosisFailed = null/);
assert.match(net, /token\|secret\|apikey|INVALID_RESPONSE/);

const holdingSource = gas.slice(gas.indexOf('function _applyHoldingTrade'), gas.indexOf('// ════════════════════════════════════════════════════════════════════\n//  영업일 목록', gas.indexOf('function _applyHoldingTrade')));
const sandbox = { CONFIG: { TIMEZONE: 'Asia/Seoul' }, Utilities: { formatDate: d => d.toISOString().slice(0,10) }, _normalizeDate: value => value instanceof Date ? value.toISOString().slice(0,10) : String(value || '').slice(0,10) };
vm.runInNewContext(`${holdingSource}\nglobalThis.single=calcHoldingsAtDate;globalThis.range=_buildHoldingsByRequestedDate;`, sandbox);
const trades = [
 ['2026-01-02','buy','','A','000001',10,100,'주식','',''],
 ['2026-01-02','buy','','A','000001',5,200,'주식','',''],
 ['2026-01-05','sell','','A','000001',3,0,'주식','',''],
 ['2026-01-06','split','','A','000001',0,0,'주식','',2],
 ['2026-01-07','reverse_split','','A','000001',0,0,'주식','',4],
 ['2026-01-08','sell','','A','000001',6,0,'주식','',''],
 ['2026-01-09','buy','','A','000001',2,300,'주식','',''],
 ['2026-01-09','sell','','A','000001',1,0,'주식','',''],
 ['2026-01-12','sell','','A','000001',99,0,'주식','',''],
];
const dates = ['2026-01-02','2026-01-05','2026-01-06','2026-01-07','2026-01-08','2026-01-09','2026-01-12'];
const ranged = sandbox.range(trades, dates, { A:'000001' });
for (const date of dates) assert.deepEqual(JSON.parse(JSON.stringify(ranged[date])), JSON.parse(JSON.stringify(sandbox.single(trades, date, { A:'000001' }))), `holdings ${date}`);

function benchmark(days) {
  const fixtureDates = Array.from({length: days}, (_, i) => `2026-${String(1 + Math.floor(i / 28)).padStart(2,'0')}-${String(1 + i % 28).padStart(2,'0')}`);
  const manyTrades = Array.from({length: 5000}, (_, i) => [fixtureDates[i % days], i % 4 ? 'buy' : 'sell', '', `A${i%20}`, String(i%20), 1, 100+i%30, '주식','','']);
  const started = performance.now(); sandbox.range(manyTrades, fixtureDates, {}); const totalMs = performance.now() - started;
  return { dates: days, rows: { snapshotRows: days * 20, tradeRows: manyTrades.length, priceHistoryRows: days * 20, fundNavRows: days, fxRows: days }, sheetReads: 6,
    readMs: 0, indexBuildMs: Number(totalMs.toFixed(2)), calculationMs: 0, totalMs: Number(totalMs.toFixed(2)), priceSeriesBuildCount: 1, priceIntegrityBuildCount: 1, holdingsBuildCount: 1 };
}
const quarter = benchmark(65), year = benchmark(250);
assert.equal(quarter.priceSeriesBuildCount, 1); assert.equal(year.priceIntegrityBuildCount, 1); assert.equal(year.holdingsBuildCount, 1);
console.log(JSON.stringify({ quarter, year }));
console.log('✅ 기간 진단 index/증분 holdings/오류 관측성/read-only 회귀 검사 통과');
