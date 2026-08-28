// 포트폴리오 JSON 백업 스키마 — DOM·localStorage와 분리된 검증/마이그레이션 모듈입니다.
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BackupSchema = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const SCHEMA_VERSION = 7;
  const TAX_TYPES = Object.freeze(['GENERAL', 'ISA', 'PENSION_SAVINGS', 'IRP', 'UNCLASSIFIED']);
  const SECRET_KEYS = /(?:gsheet(?:api)?url|access[_-]?token|api[_-]?key|auth[_-]?key|secret|credential|password)/i;
  const REFERENCE_20260828_TAX_TYPES = Object.freeze({ '미래에셋':'GENERAL', '신한':'GENERAL', 'LS':'GENERAL', '삼성':'GENERAL', '유진':'GENERAL', '우리':'GENERAL', 'NH':'GENERAL', '미래에셋 (ISA)':'ISA', '우리 (연금)':'PENSION_SAVINGS', '미래에셋 (IRP)':'IRP' });

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function accountId(name, index) {
    const slug = String(name || '').normalize('NFKC').trim().toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '');
    return `acct-${slug || index + 1}`;
  }
  function legacyTaxType(name, explicit, referenceProfile = null) {
    const mapped = String(explicit || '').trim();
    if (mapped === '일반' || mapped === 'GENERAL') return 'GENERAL';
    if (mapped === 'ISA') return 'ISA';
    if (mapped === '연금' || mapped === '연금저축' || mapped === 'PENSION_SAVINGS') return 'PENSION_SAVINGS';
    if (mapped === 'IRP') return 'IRP';
    if (referenceProfile && referenceProfile[name]) return referenceProfile[name];
    const label = String(name || '');
    if (label === '미래에셋 (ISA)') return 'ISA';
    if (label === '우리 (연금)') return 'PENSION_SAVINGS';
    if (label === '미래에셋 (IRP)') return 'IRP';
    return 'UNCLASSIFIED';
  }
  function stripSecrets(value) {
    if (Array.isArray(value)) return value.map(stripSecrets);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !SECRET_KEYS.test(key))
      .map(([key, item]) => [key, stripSecrets(item)]));
  }
  function migrateV6(source) {
    const data = clone(source || {});
    const names = [...new Set([...(Array.isArray(data.ACCT_ORDER) ? data.ACCT_ORDER : []),
      ...(Array.isArray(data.rawTrades) ? data.rawTrades.map(item => item?.acct) : [])].filter(Boolean))];
    const referenceNames = Object.keys(REFERENCE_20260828_TAX_TYPES);
    const isReferenceProfile = names.length === referenceNames.length && referenceNames.every(name => names.includes(name));
    const referenceProfile = isReferenceProfile ? REFERENCE_20260828_TAX_TYPES : null;
    const accounts = names.map((displayName, index) => ({
      id: accountId(displayName, index), displayName, broker: '',
      taxType: legacyTaxType(displayName, data.ACCT_TAX_TYPES?.[displayName], referenceProfile), active: true,
      color: data.ACCT_COLORS?.[displayName] || '', sortOrder: index,
    }));
    const idByName = Object.fromEntries(accounts.map(item => [item.displayName, item.id]));
    return stripSecrets({
      schemaVersion: SCHEMA_VERSION,
      metadata: { migratedFrom: 'pf_v6', needsUserReview: accounts.filter(item => item.taxType === 'UNCLASSIFIED').map(item => `accounts.${item.id}.taxType`) },
      accounts,
      transactions: (data.rawTrades || []).map(item => ({ ...item, accountId: idByName[item.acct] || null })),
      portfolio: { stockCodes: data.STOCK_CODE || {}, editablePrices: data.EDITABLE_PRICES || [], prices: data.savedPrices || {}, priceDates: data.savedPriceDates || {}, lastUpdated: data.lastUpdated || null, sectorColors: data.SECTOR_COLORS || {}, fundDirect: data.fundDirect || {}, holdings: data.rawHoldings || [] },
      dividends: data.DIVDATA || {}, realEstate: data.REAL_ESTATE || {}, loan: data.LOAN || {}, loanSchedule: data.LOAN_SCHEDULE || [], realEstateValueHistory: data.RE_VALUE_HIST || [],
      planSettings: data.planSettings || {}, isaAccounts: data.isaAccounts || [], targets: data.targets || {}, stockSettings: data.stockSettings || {},
    });
  }
  function normalize(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('백업 최상위 값은 객체여야 합니다.');
    if (source.version === 'pf_v6') return migrateV6(source);
    if (source.schemaVersion !== SCHEMA_VERSION) throw new Error(`지원하지 않는 schemaVersion: ${source.schemaVersion ?? '?'}`);
    return stripSecrets(clone(source));
  }
  function validate(source) {
    const data = normalize(source);
    const required = ['accounts', 'transactions', 'portfolio', 'dividends', 'realEstate', 'loan', 'loanSchedule', 'planSettings', 'isaAccounts'];
    required.forEach(key => { if (data[key] === undefined) throw new Error(`필수 필드 누락: ${key}`); });
    if (!Array.isArray(data.accounts) || !Array.isArray(data.transactions) || !Array.isArray(data.loanSchedule) || !Array.isArray(data.isaAccounts)) throw new Error('목록 필드 형식이 올바르지 않습니다.');
    const ids = new Set();
    data.accounts.forEach((account, index) => {
      if (!account || typeof account.id !== 'string' || !account.id.trim()) throw new Error(`accounts[${index}].id가 필요합니다.`);
      if (ids.has(account.id)) throw new Error(`중복 account ID: ${account.id}`);
      ids.add(account.id);
      if (!TAX_TYPES.includes(account.taxType)) throw new Error(`알 수 없는 taxType: ${account.taxType}`);
    });
    data.transactions.forEach((item, index) => {
      if (!item.accountId) throw new Error(`transactions[${index}].accountId가 필요합니다.`);
      if (!ids.has(item.accountId)) throw new Error(`transactions[${index}]의 accountId 참조가 없습니다.`);
    });
    data.isaAccounts.forEach((item, index) => { if (!ids.has(item.accountId)) throw new Error(`isaAccounts[${index}]의 accountId 참조가 없습니다.`); });
    const serialized = JSON.stringify(data);
    if (SECRET_KEYS.test(serialized)) throw new Error('백업에 연결정보 또는 비밀정보가 포함되어 있습니다.');
    return data;
  }
  function createBackup(state) {
    return validate(stripSecrets({ schemaVersion: SCHEMA_VERSION, metadata: { dataAsOf: state?.dataAsOf || null, snapshot: true }, ...clone(state || {}) }));
  }
  function parseAndValidate(text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { throw new Error('올바른 JSON 파일이 아닙니다.'); }
    return validate(parsed);
  }
  function applyAtomically(currentState, nextState, apply) {
    const before = clone(currentState);
    try { apply(clone(nextState)); return { applied:true }; }
    catch (error) { apply(before); return { applied:false, error }; }
  }
  return { SCHEMA_VERSION, TAX_TYPES, SECRET_KEYS, REFERENCE_20260828_TAX_TYPES, stripSecrets, legacyTaxType, migrateV6, normalize, validate, createBackup, parseAndValidate, applyAtomically };
});
