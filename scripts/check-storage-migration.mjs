import assert from 'node:assert/strict';
import schema from '../src/web/domain/migration/backup_schema.js';

const legacy = {
  version: 'pf_v6', ACCT_ORDER: ['미래에셋 (ISA)', '새 계좌'], ACCT_COLORS: {}, ACCT_TAX_TYPES: {},
  rawTrades: [{ id:'t1', acct:'미래에셋 (ISA)', name:'종목', qty:1, price:100 }],
  STOCK_CODE:{ 종목:'000001' }, EDITABLE_PRICES:[], savedPrices:{ 종목:100 }, savedPriceDates:{ 종목:'2026-08-28' },
  DIVDATA:{}, REAL_ESTATE:{ currentValue:1_100_000_000 }, LOAN:{ balance:354_702_682 }, LOAN_SCHEDULE:[], RE_VALUE_HIST:[],
  planSettings:{ retireYears:50, loanMode:'payoff' }, gsheetUrl:'https://invalid.example.test', accessToken:'fake-token', apiKey:'fake-key',
};
const migrated = schema.validate(legacy);
assert.equal(migrated.schemaVersion, 7);
assert.equal(migrated.accounts[0].taxType, 'ISA');
assert.equal(migrated.accounts[1].taxType, 'UNCLASSIFIED');
assert.ok(migrated.metadata.needsUserReview.length === 1);
assert.equal(migrated.transactions[0].accountId, migrated.accounts[0].id);
assert.equal(migrated.planSettings.retireYears, 50);

const roundTrip = schema.createBackup({ ...migrated, schemaVersion: undefined, dataAsOf:'2026-08-28' });
assert.deepEqual(schema.parseAndValidate(JSON.stringify(roundTrip)), roundTrip);
assert.doesNotMatch(JSON.stringify(roundTrip), /gsheetUrl|accessToken|apiKey|authKey|secret/i);
assert.throws(() => schema.parseAndValidate('{'), /올바른 JSON/);
assert.throws(() => schema.validate({ schemaVersion:7 }), /필수 필드 누락/);
assert.throws(() => schema.validate({ ...roundTrip, accounts:[...roundTrip.accounts, roundTrip.accounts[0]] }), /중복 account ID/);
assert.throws(() => schema.validate({ ...roundTrip, accounts:roundTrip.accounts.map((a,i) => i ? a : ({...a,taxType:'UNKNOWN'})) }), /알 수 없는 taxType/);
assert.throws(() => schema.validate({ ...roundTrip, transactions:[{accountId:'missing'}] }), /참조가 없습니다/);
assert.throws(() => schema.validate({ ...roundTrip, isaAccounts:[{accountId:'missing'}] }), /참조가 없습니다/);

// 검증 실패 전에는 호출자 상태를 건드릴 이유가 없음을 원자 반영 adapter로 확인합니다.
const current = { transactions:[{id:'existing'}] };
assert.throws(() => { const valid = schema.parseAndValidate('{}'); current.transactions = valid.transactions; });
assert.deepEqual(current.transactions, [{id:'existing'}]);
console.log('JSON schema v7 마이그레이션·round trip·비밀정보 제외 검사 통과 (12개)');
