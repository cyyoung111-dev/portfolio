import assert from 'node:assert/strict';
import continuity from '../src/web/domain/market/market_briefing_continuity.js';

const { CHECKPOINT, appendObservation, buildTransition, storeMorningScenario, eveningPostmortem, validateContinuity } = continuity;

let history = [];
history = appendObservation(history, { seriesId: 'K200', tradingDate: '2026-09-18', checkpoint: CHECKPOINT.NIGHT_FINAL, observedAt: '2026-09-18T06:00:00+09:00', value: 550, status: 'FINAL', session: 'K200_NIGHT' });
history = appendObservation(history, { seriesId: 'K200', tradingDate: '2026-09-18', checkpoint: CHECKPOINT.MORNING, observedAt: '2026-09-18T07:30:00+09:00', value: 550, status: 'FINAL', session: 'K200_NIGHT' });
history = appendObservation(history, { seriesId: 'K200', tradingDate: '2026-09-18', checkpoint: CHECKPOINT.KRX_FINAL, observedAt: '2026-09-18T15:30:00+09:00', value: 553, status: 'FINAL', session: 'KRX_REGULAR' });
history = appendObservation(history, { seriesId: 'K200', tradingDate: '2026-09-18', checkpoint: CHECKPOINT.EVENING, observedAt: '2026-09-18T20:15:00+09:00', value: 555, status: 'LIVE', session: 'K200_NIGHT' });
assert.equal(history.length, 4);

const duplicate = appendObservation(history, history[0]);
assert.equal(duplicate.length, 4, 'same checkpoint/timestamp must be idempotent');

const transition = buildTransition(history, 'K200', '2026-09-18');
assert.deepEqual(transition.map((row) => row.checkpoint), ['NIGHT_FINAL', 'MORNING', 'KRX_FINAL', 'EVENING']);
assert.equal(transition[3].status, 'LIVE', '20:15 night futures must not be mislabeled FINAL');

let scenarios = {};
scenarios = storeMorningScenario(scenarios, {
  tradingDate: '2026-09-18',
  createdAt: '2026-09-18T07:30:00+09:00',
  regime: 'NEUTRAL',
  scenarios: { bullish: { condition: 'A' }, neutral: { condition: 'B' }, bearish: { condition: 'C' } },
});
assert.throws(() => storeMorningScenario(scenarios, { tradingDate: '2026-09-18', createdAt: '2026-09-18T08:00:00+09:00', scenarios: {} }), /immutable/);

const postmortem = eveningPostmortem(scenarios, '2026-09-18', { kospiReturnPct: 0.5 });
assert.equal(postmortem.status, 'READY');
assert.equal(postmortem.morning.createdAt, '2026-09-18T07:30:00+09:00');
const missing = eveningPostmortem({}, '2026-09-18', {});
assert.equal(missing.status, 'UNCONFIRMED');
assert.equal(missing.formalHitRate, null);

const qc = validateContinuity(history, '2026-09-18');
assert.equal(qc.ok, true);
assert.equal(qc.rowCount, 4);

console.log('시장 브리핑 연속성 검사 통과');
