import assert from 'node:assert/strict';
import {
  buildNightReference, upsertNightReference, nightTelegramReference, formatNightTelegramLine
} from './nhplug-k200-night-contract.mjs';

const target = '2026-10-29'; // Synthetic example; do not treat contract code as a verified NH master symbol.
const base = {
  source: 'NH_PLUG', market: 'KRX', session: 'NIGHT', instrument: 'KOSPI200_FUTURE',
  tradingDate: target, contract: '101Z6', contractMonth: '2026-12',
  contractVerified: true, priceType: 'LAST_TRADE', officialClose: false,
  value: '350.25', observedAt: '2026-10-29T05:58:22+09:00',
  receivedAt: '2026-10-29T06:05:11+09:00',
};
const expectReject = (updates, code) => assert.throws(
  () => buildNightReference({ ...base, ...updates }),
  new RegExp('NHPLUG_NIGHT_' + code)
);

const record = buildNightReference(base);
assert.equal(record.value, 350.25);
assert.equal(record.status, 'REFERENCE');
assert.equal(record.finality, null);
assert.equal(record.officialClose, false);
assert.equal(record.sourceDate, target);
assert.equal(record.observedAt, '2026-10-28T20:58:22.000Z');
assert.equal(record.receivedAt, '2026-10-28T21:05:11.000Z');
assert.match(formatNightTelegramLine(record, target), /공식 종가·정산가 미확인/);
assert.doesNotMatch(formatNightTelegramLine(record, target), /확정 종가/);

expectReject({ tradingDate: '2026-10-28' }, 'WRONG_NIGHT_SESSION');
expectReject({ tradingDate: '2026-02-30' }, 'IDENTITY_UNVERIFIED');
expectReject({ instrument: 'KOSDAQ150_FUTURE' }, 'IDENTITY_UNVERIFIED');
expectReject({ session: 'REGULAR' }, 'IDENTITY_UNVERIFIED');
expectReject({ market: 'NXT' }, 'IDENTITY_UNVERIFIED');
expectReject({ contractVerified: false }, 'CONTRACT_UNVERIFIED');
expectReject({ contract: '' }, 'CONTRACT_UNVERIFIED');
expectReject({ contractMonth: '2026-01' }, 'CONTRACT_UNVERIFIED');
expectReject({ value: 0 }, 'PRICE_INVALID');
expectReject({ value: -3 }, 'PRICE_INVALID');
expectReject({ value: 350.27 }, 'PRICE_INVALID');
expectReject({ priceType: 'SETTLEMENT' }, 'PRICE_TYPE_UNVERIFIED');
expectReject({ source: 'KRX_OFFICIAL' }, 'SOURCE_OR_FINALITY_INVALID');
expectReject({ officialClose: true }, 'SOURCE_OR_FINALITY_INVALID');
expectReject({ officialClose: undefined }, 'SOURCE_OR_FINALITY_INVALID');
expectReject({ observedAt: '2026-10-28T17:59:59+09:00' }, 'WRONG_NIGHT_SESSION');
expectReject({ observedAt: '2026-10-29T06:00:01+09:00' }, 'WRONG_NIGHT_SESSION');
expectReject({ observedAt: '2026-10-29T05:59:58' }, 'TIMESTAMP_INVALID');
expectReject({ observedAt: '2026-10-29T08:00:00+09:00' }, 'TIMESTAMP_INVALID');
expectReject({ receivedAt: '2026-10-29T05:59:59+09:00' }, 'RECEIPT_OUTSIDE_CUTOFF');
expectReject({ receivedAt: '2026-10-29T08:10:00+09:00' }, 'RECEIPT_OUTSIDE_CUTOFF');

assert.equal(buildNightReference({ ...base, observedAt: '2026-10-28T18:00:00+09:00' }).status, 'REFERENCE');
assert.equal(buildNightReference({ ...base, observedAt: '2026-10-29T06:00:00+09:00' }).status, 'REFERENCE');
assert.equal(buildNightReference({ ...base, receivedAt: '2026-10-29T07:39:59+09:00' }).status, 'REFERENCE');
assert.equal(buildNightReference({ ...base, receivedAt: '2026-10-29T08:09:59+09:00' }).status, 'REFERENCE');
const retryCapture = buildNightReference({ ...base, receivedAt: '2026-10-29T08:05:00+09:00' });
assert.equal(nightTelegramReference([retryCapture],target,new Date('2026-10-29T07:40:00+09:00')), null);
assert.equal(nightTelegramReference([retryCapture],target,new Date('2026-10-29T08:06:00+09:00')).value, 350.25);
assert.match(formatNightTelegramLine(retryCapture,target,new Date('2026-10-29T07:40:00+09:00')), /미확보/);
assert.match(formatNightTelegramLine(retryCapture,target,new Date('2026-10-29T08:06:00+09:00')), /350.25pt/);
assert.throws(() => nightTelegramReference([record],target,'2026-10-29T07:40:00'), /AS_OF_INVALID/);

const initial = upsertNightReference([], record);
assert.equal(initial.outcome, 'INSERTED');
assert.equal(initial.rows.length, 1);
assert.equal(upsertNightReference(initial.rows, record).outcome, 'DUPLICATE_IGNORED');
assert.throws(() => upsertNightReference([record,record], record), /DUPLICATE_STORED_KEY/);

const older = buildNightReference({ ...base, receivedAt: '2026-10-29T06:03:00+09:00' });
assert.equal(upsertNightReference(initial.rows, older).outcome, 'STALE_IGNORED');
const staleTrade = buildNightReference({ ...base, observedAt:'2026-10-29T05:57:00+09:00', receivedAt:'2026-10-29T06:15:00+09:00' });
assert.equal(upsertNightReference(initial.rows, staleTrade).outcome, 'STALE_IGNORED');
const newer = buildNightReference({
  ...base, value: '350.30', observedAt: '2026-10-29T05:59:59+09:00',
  receivedAt: '2026-10-29T06:10:00+09:00'
});
const update = upsertNightReference(initial.rows, newer);
assert.equal(update.outcome, 'UPDATED');
assert.equal(update.rows.length, 1);
assert.equal(update.rows[0].value, 350.30);
assert.equal(initial.rows[0].value, 350.25); // immutable planning function

const conflict = buildNightReference({
  ...base, value: '350.35', receivedAt: record.receivedAt
});
assert.throws(() => upsertNightReference(initial.rows, conflict), /CONFLICTING_SAME_RECEIPT/);
const conflictingTrade = buildNightReference({ ...base, value:'350.35', receivedAt:'2026-10-29T06:15:00+09:00' });
assert.throws(() => upsertNightReference(initial.rows, conflictingTrade), /CONFLICTING_SAME_TRADE/);
assert.equal(initial.rows[0].value, 350.25);

assert.equal(nightTelegramReference(update.rows, target).value, 350.30);
assert.equal(nightTelegramReference(update.rows, '2026-10-30'), null);
const secondContract = buildNightReference({ ...base, contract: '101H7', contractMonth: '2027-03' });
assert.equal(nightTelegramReference([record,secondContract], target), null);
assert.equal(nightTelegramReference([{ ...record, source:'KRX_OFFICIAL' }], target), null);
assert.match(formatNightTelegramLine(null, target), /미확보/);

console.log('NH PLUG KOSPI200 night persistence contract: synthetic tests passed');

