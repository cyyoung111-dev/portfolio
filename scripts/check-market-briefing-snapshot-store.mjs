import assert from 'node:assert/strict';
import snapshots from '../src/web/domain/market/market_briefing_snapshot_store.js';

const date = '2026-09-18';
const prior = '2026-09-17';
let store = [];
store = snapshots.appendSnapshot(store, { tradingDate:prior, checkpoint:'EVENING', asOf:`${prior}T20:15:00+09:00`, values:{ K200_NIGHT:{ value:545 } } }, { scenario:{ nextMorningBias:'NEUTRAL' } });
store = snapshots.appendSnapshot(store, { tradingDate:date, checkpoint:'NIGHT_FINAL', asOf:`${date}T06:00:00+09:00`, values:{ K200_NIGHT:{ value:550, status:'FINAL' } } });
const morning = { tradingDate:date, checkpoint:'MORNING', asOf:`${date}T07:30:00+09:00`, values:{ K200_NIGHT:{ value:550, status:'FINAL' }, USDKRW:{ value:1390 } } };
store = snapshots.appendSnapshot(store, morning, { scenario:{ bias:'RISK_ON', watch:['FOREIGN_NET','SKHY_ADR_GAP'] } });
const duplicate = snapshots.appendSnapshot(store, { ...morning, values:{ K200_NIGHT:{ value:999 } } }, { scenario:{ bias:'CHANGED' } });
assert.deepEqual(duplicate, store, 'same checkpoint must be immutable/idempotent');
assert.equal(snapshots.getSnapshot(store, date, 'MORNING').values.K200_NIGHT.value, 550);
assert.equal(snapshots.morningScenario(store, date).bias, 'RISK_ON');
assert.equal(snapshots.previousEveningContext(store, date).tradingDate, prior);

const evening = { tradingDate:date, checkpoint:'EVENING', asOf:`${date}T20:15:00+09:00`, values:{ K200_NIGHT:{ value:552, status:'LIVE' } } };
const postmortem = snapshots.eveningPostmortem(store, date, evening);
assert.equal(postmortem.formalHitRate, true);
assert.equal(postmortem.morningScenario.bias, 'RISK_ON');
assert.equal(snapshots.getSnapshot(postmortem.store, date, 'EVENING').scenario.morningScenario.bias, 'RISK_ON');

const missing = snapshots.eveningPostmortem([], date, evening);
assert.equal(missing.formalHitRate, false);
assert.equal(missing.evaluationStatus, 'UNCONFIRMED');
assert.equal(missing.morningScenario, null);

console.log('장전·마감 브리핑 불변 스냅샷·시나리오 연속성 회귀검사 통과');
