import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/web/domain/market/market_briefing_qc.js', 'utf8');
const context = vm.createContext({ console, Date, Number, String, Array, Object, Math, isFinite, module: { exports: {} } });
new vm.Script(source, { filename: 'market_briefing_qc.js' }).runInContext(context);
const q = context.module.exports;

function assert(condition, message) { if (!condition) throw new Error(message); }

const delayed = q.classifyObservation({ value: 100, observedAt: '2026-09-18T20:05:00+09:00', receivedAt: '2026-09-18T20:15:00+09:00' }, { maxAcceptableLagMs: 5 * 60 * 1000 }, '2026-09-18T20:15:00+09:00');
assert(delayed.status === 'DELAYED' && delayed.lagMs === 600000, '지연 관측값 판정 실패');
const holiday = q.classifyObservation({ value: 2600, receivedAt: '2026-09-19T07:30:00+09:00', requestedDate: '2026-09-19', observationDate: '2026-09-18' }, {}, '2026-09-19T07:30:00+09:00');
assert(holiday.status === 'PARTIAL' && holiday.errors.includes('HOLIDAY_FALLBACK'), '휴장일 전일값 오표기 방지 실패');
const receiveOnly = q.classifyObservation({ value: 1, receivedAt: '2026-09-18T20:15:00+09:00' }, {}, '2026-09-18T20:15:00+09:00');
assert(receiveOnly.timestampQuality === 'RECEIVE_ONLY', '관측시각 없는 값의 timestamp 품질 실패');

const registry = { H0STCNT0: { fieldCounts: [46, 47] } };
const validFrame = `0|H0STCNT0|1|${Array.from({ length: 46 }, (_, i) => i).join('^')}`;
assert(q.validateKisRawFrame(validFrame, registry).ok === true, 'KIS known schema 허용 실패');
const changedFrame = `0|H0STCNT0|1|${Array.from({ length: 48 }, (_, i) => i).join('^')}`;
const quarantined = q.validateKisRawFrame(changedFrame, registry);
assert(quarantined.status === 'QUARANTINED' && quarantined.reason === 'FIELD_COUNT_MISMATCH', 'KIS schema 변경 quarantine 실패');
assert(q.validateKisRawFrame('bad', registry).status === 'QUARANTINED', 'KIS malformed frame quarantine 실패');

const breadth = q.aggregateBreadth([
  { open: 100, high: 110, low: 99, volume: 10, turnover: 1000, changePct: 1 },
  { open: 100, high: 101, low: 90, volume: 10, turnover: 1000, changePct: -2 },
  { open: 100, high: 100, low: 100, volume: 1, turnover: 100, changePct: 0 },
  { open: 0, high: 0, low: 0, volume: 0, turnover: 0, changePct: 0 }
], 5);
assert(breadth.ADVANCE === 1 && breadth.DECLINE === 1 && breadth.UNCHANGED === 1 && breadth.NON_TRADING === 1 && breadth.MISSING === 1, 'Breadth 상태 분류 실패');
assert(breadth.qcOk && breadth.dataCoverage === 0.8 && breadth.tradingParticipation === 0.6, 'Breadth coverage/QC 실패');

const gap = q.adrMorningGap({ skhyPrice: 180, usdKrw: 1400, krClose: 1750000, ordPerDr: 0.1 });
assert(Math.abs(gap.impliedOrdinaryKrw - 2520000) < 1e-9 && gap.semantic === 'MORNING_ADR_GAP', 'SKHY Morning ADR Gap 계산 실패');
const sync = q.synchronizedAdrPremium({ skhyPrice: 180, usdKrw: 1400, krClose: 1750000, ordPerDr: 0.1, skhyObservedAt: '2026-09-18T05:00:00+09:00', fxObservedAt: '2026-09-18T05:02:00+09:00', krObservedAt: '2026-09-18T05:01:00+09:00', maxGapSeconds: 300 });
assert(sync.status === 'LIVE' && sync.observationGapSeconds === 120, '동시점 ADR premium 시간 정렬 실패');
const nonsync = q.synchronizedAdrPremium({ skhyPrice: 180, usdKrw: 1400, krClose: 1750000, ordPerDr: 0.1, skhyObservedAt: '2026-09-18T05:00:00+09:00', fxObservedAt: '2026-09-18T05:20:00+09:00', krObservedAt: '2026-09-18T05:01:00+09:00', maxGapSeconds: 300 });
assert(nonsync.status === 'PARTIAL', '비동시 ADR premium 차단 실패');

assert(q.programAdditivity(100, 20, 120, 0).ok === true, '프로그램 J+NX=UN 검산 성공 케이스 실패');
const nonAdd = q.programAdditivity(100, 20, 119, 0);
assert(nonAdd.ok === false && nonAdd.diff === 1, '프로그램 additivity 차이 보존 실패');

console.log('✅ 시장 브리핑 QC: 지연/휴장/schema quarantine/Breadth/ADR/프로그램 검산 통과');
