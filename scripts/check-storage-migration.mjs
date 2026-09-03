import assert from 'node:assert/strict';
import schema from '../src/web/domain/migration/backup_schema.js';

const referenceAccounts = ['미래에셋','신한','LS','삼성','유진','우리','NH','미래에셋 (ISA)','우리 (연금)','미래에셋 (IRP)'];
const legacy = {
  version: 'pf_v6', ACCT_ORDER: referenceAccounts, ACCT_COLORS: {}, ACCT_TAX_TYPES: {},
  rawTrades: referenceAccounts.map((acct,index) => ({ id:`t${index}`, acct, name:'종목', qty:1, price:100 })),
  STOCK_CODE:{ 종목:'000001' }, EDITABLE_PRICES:[], savedPrices:{ 종목:100 }, savedPriceDates:{ 종목:'2026-08-28' },
  DIVDATA:{}, REAL_ESTATE:{ currentValue:1_100_000_000 }, LOAN:{ balance:354_702_682 }, LOAN_SCHEDULE:[], RE_VALUE_HIST:[],
  planSettings:{ retireYears:50, loanMode:'payoff' }, gsheetUrl:'https://invalid.example.test', accessToken:'fake-token', apiKey:'fake-key',
};
const migrated = schema.validate(legacy);
assert.equal(migrated.schemaVersion, 7);
assert.equal(migrated.accounts.filter(item => item.taxType === 'GENERAL').length, 7);
assert.equal(migrated.accounts.filter(item => item.taxType === 'ISA').length, 1);
assert.equal(migrated.accounts.filter(item => item.taxType === 'PENSION_SAVINGS').length, 1);
assert.equal(migrated.accounts.filter(item => item.taxType === 'IRP').length, 1);
assert.equal(migrated.accounts.filter(item => item.taxType === 'UNCLASSIFIED').length, 0);
assert.deepEqual(migrated.accounts.map(item => item.brokerCode), ['MIRAE_ASSET','SHINHAN','LS','SAMSUNG','EUGENE','WOORI','NH','MIRAE_ASSET','WOORI','MIRAE_ASSET']);
assert.ok(migrated.metadata.needsUserReview.length === 0);
assert.equal(migrated.transactions[0].accountId, migrated.accounts[0].id);
assert.equal(migrated.planSettings.retireYears, 50);
const idsBefore = Object.fromEntries(migrated.accounts.map(item => [item.displayName,item.id]));
const reordered = {...migrated, accounts:[...migrated.accounts].reverse().map(item => item.displayName === '미래에셋' ? {...item,displayName:'미래에셋 변경'} : item)};
assert.equal(reordered.accounts.find(item => item.displayName === '미래에셋 변경').id, idsBefore['미래에셋']);
assert.equal(schema.validate(reordered).accounts.find(item => item.displayName === '미래에셋 변경').brokerCode, 'MIRAE_ASSET');
const unknownLegacy = schema.migrateV6({...legacy,ACCT_ORDER:['새 계좌'],rawTrades:[{id:'u1',acct:'새 계좌'}]});
assert.equal(unknownLegacy.accounts[0].taxType, 'UNCLASSIFIED');
assert.equal(unknownLegacy.accounts[0].brokerCode, 'UNCLASSIFIED');
assert.ok(unknownLegacy.metadata.needsUserReview.includes(`accounts.${unknownLegacy.accounts[0].id}.brokerCode`));

const roundTrip = schema.createBackup({ ...migrated, schemaVersion: undefined, dataAsOf:'2026-08-28' });
assert.deepEqual(schema.parseAndValidate(JSON.stringify(roundTrip)), roundTrip);
assert.doesNotMatch(JSON.stringify(roundTrip), /gsheetUrl|accessToken|apiKey|authKey|secret/i);
assert.throws(() => schema.parseAndValidate('{'), /올바른 JSON/);
assert.throws(() => schema.validate({ schemaVersion:7 }), /필수 필드 누락/);
const { accounts: omittedAccounts, ...backupWithoutAccounts } = roundTrip;
assert.equal(omittedAccounts.length, roundTrip.accounts.length);
assert.throws(() => schema.validate(backupWithoutAccounts), /필수 필드 누락: accounts/);
assert.throws(() => schema.validate({ ...roundTrip, accounts:[...roundTrip.accounts, roundTrip.accounts[0]] }), /중복 account ID/);
assert.throws(() => schema.validate({ ...roundTrip, accounts:roundTrip.accounts.map((a,i) => i ? a : ({...a,taxType:'UNKNOWN'})) }), /알 수 없는 taxType/);
assert.equal(schema.validate({ ...roundTrip, accounts:roundTrip.accounts.map((a,i) => i ? a : ({...a,brokerCode:'UNKNOWN'})) }).accounts[0].brokerCode, 'UNCLASSIFIED');
assert.throws(() => schema.validate({ ...roundTrip, transactions:[{accountId:'missing'}] }), /참조가 없습니다/);
assert.throws(() => schema.validate({ ...roundTrip, isaAccounts:[{accountId:'missing'}] }), /참조가 없습니다/);

// 검증 실패 전에는 호출자 상태를 건드릴 이유가 없음을 원자 반영 adapter로 확인합니다.
const current = { transactions:[{id:'existing'}] };
assert.throws(() => { const valid = schema.parseAndValidate('{}'); current.transactions = valid.transactions; });
assert.deepEqual(current.transactions, [{id:'existing'}]);
let applied = { value:'before' };
const atomic = schema.applyAtomically(applied, {value:'after'}, next => { applied = next; if (next.value === 'after') throw new Error('의도적 적용 오류'); });
assert.equal(atomic.applied, false); assert.deepEqual(applied, {value:'before'});
console.log('JSON schema v7 증권사·세제유형 마이그레이션·ID 안정성·round trip·원자성·비밀정보 제외 검사 통과');
