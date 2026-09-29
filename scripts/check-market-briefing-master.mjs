import assert from 'node:assert/strict';
import master from '../src/web/domain/market/market_briefing_master.js';

const date = '2026-09-18';
let rows = [];
rows = master.upsertObservation(rows, { seriesId:'K200_NIGHT', tradingDate:date, value:550, market:'KRX', session:'NIGHT', source:'KIS', status:'FINAL', observedAt:`${date}T06:00:00+09:00`, receivedAt:`${date}T06:00:02+09:00` });
rows = master.upsertObservation(rows, { seriesId:'USDKRW', tradingDate:date, value:1390, market:'FX', session:'CONTINUOUS', source:'PRIMARY', status:'LIVE', observedAt:`${date}T07:29:50+09:00`, receivedAt:`${date}T07:29:51+09:00` });
rows = master.upsertObservation(rows, { seriesId:'USDKRW', tradingDate:date, value:1395, market:'FX', session:'CONTINUOUS', source:'PRIMARY', status:'LIVE', observedAt:`${date}T20:14:50+09:00`, receivedAt:`${date}T20:14:51+09:00` });
rows = master.upsertObservation(rows, { seriesId:'NQ', tradingDate:date, value:25000, market:'CME', session:'GLOBEX', source:'FREE_DELAYED', status:'DELAYED', observedAt:`${date}T20:05:00+09:00`, receivedAt:`${date}T20:15:00+09:00` });
rows = master.upsertObservation(rows, { seriesId:'RECEIVE_ONLY', tradingDate:date, value:1, receivedAt:`${date}T07:20:00+09:00` });

assert.equal(master.normalizeObservation({ seriesId:'X', tradingDate:date, value:1, receivedAt:`${date}T07:00:00+09:00` }).timestampQuality, 'RECEIVE_ONLY');
const metadata=master.normalizeObservation({seriesId:'X',tradingDate:date,value:1,currency:'KRW',sourceDate:'2026-09-17',fallback:true,receivedAt:`${date}T07:00:00+09:00`});
assert.equal(metadata.currency,'KRW'); assert.equal(metadata.sourceDate,'2026-09-17'); assert.equal(metadata.fallback,true);
assert.equal(master.checkpointForTime('07:29:59'),'NIGHT_FINAL'); assert.equal(master.checkpointForTime('07:30:00'),'MORNING');
assert.equal(master.checkpointForTime('15:30:00'),'KRX_FINAL'); assert.equal(master.checkpointForTime('20:00:00'),'AFTER_FINAL'); assert.equal(master.checkpointForTime('20:15:00'),'EVENING');
assert.throws(() => master.normalizeObservation({ seriesId:'X', tradingDate:date, value:1, observedAt:`${date}T07:00:01+09:00`, receivedAt:`${date}T07:00:00+09:00` }), /observedAt must not be after receivedAt/);
assert.equal(master.normalizeObservation({ seriesId:'X', tradingDate:date, value:1, observedAt:`${date}T07:00:00+09:00`, receivedAt:`${date}T07:00:01+09:00`, timestampQuality:'RECEIVE_ONLY', lagSeconds:999 }).lagSeconds, 1);
assert.equal(master.selectAt(rows, 'USDKRW', `${date}T07:30:00+09:00`).value, 1390, '07:30 must not look ahead to evening');
assert.equal(master.selectAt(rows, 'USDKRW', `${date}T20:15:00+09:00`).value, 1395);
assert.equal(master.selectAt(rows, 'NQ', `${date}T20:15:00+09:00`).status, 'DELAYED');
assert.equal(master.selectAt(rows, 'NQ', `${date}T20:15:00+09:00`).lagSeconds, 600);

const bridge = master.bridgeBriefings(rows, date, ['K200_NIGHT','USDKRW','NQ']);
assert.equal(bridge.morning.values.USDKRW.value, 1390);
assert.equal(bridge.evening.values.USDKRW.value, 1395);
assert.equal(bridge.morning.values.NQ, null, 'morning cannot use evening observation');
assert.equal(master.validateSnapshot(bridge.evening).ok, true);
assert.deepEqual(master.SERIES_POLICY.US_FUTURES_FREE, { morning:'DELAYED', evening:'DELAYED' });
assert.deepEqual(master.SERIES_POLICY.K200_NIGHT, { morning:'FINAL', evening:'LIVE' });

console.log('시장 브리핑 공통 MASTER 시점·지연·look-ahead 회귀검사 통과');
