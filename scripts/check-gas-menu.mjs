import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/gas/apps_script.gs', 'utf8');
function fixture() {
  const messages = [], menus = [], writes = [], calls = [], responses = [];
  const props = new Map();
  const properties = {
    getProperty: key => props.get(key) || null,
    setProperty: (key, value) => { writes.push(key); props.set(key, value); },
    deleteProperty: key => { writes.push(key); props.delete(key); },
  };
  const ui = {
    Button: { YES: 'YES', NO: 'NO', OK: 'OK', CANCEL: 'CANCEL' },
    ButtonSet: { YES_NO: 'YES_NO', YES_NO_CANCEL: 'YES_NO_CANCEL', OK_CANCEL: 'OK_CANCEL' },
    alert: (...args) => { messages.push(args); return responses.shift() || 'NO'; },
    prompt: (...args) => {
      messages.push(args);
      const [button, text] = responses.shift() || ['CANCEL', ''];
      return { getSelectedButton: () => button, getResponseText: () => text };
    },
    createMenu: name => {
      const menu = { name, items: [], children: [],
        addItem(label, handler) { this.items.push({ label, handler }); return this; },
        addSubMenu(child) { this.children.push(child); return this; },
        addSeparator() { return this; }, addToUi() { menus.push(this); return this; },
      };
      return menu;
    },
  };
  const sheet = {
    getLastRow: () => 3, getLastColumn: () => 12,
    getRange: () => ({ clearContent: () => calls.push('clearContent') }),
  };
  const ss = { getId: () => 'spreadsheet', getSheetByName: () => sheet };
  const ctx = vm.createContext({ console, Logger: { log() {} },
    SpreadsheetApp: { getUi: () => ui, getActiveSpreadsheet: () => ss },
    PropertiesService: { getScriptProperties: () => properties },
  });
  new vm.Script(source).runInContext(ctx);
  ctx.getss = () => ss;
  return { ctx, ui, props, writes, calls, responses, messages, menus };
}

// Construct the actual menus; all handlers resolve and main-menu actions occur once.
{
  const f = fixture(); f.ctx.onOpen({ source: { getId: () => 'spreadsheet' } });
  assert.equal(f.menus.length, 1);
  const root = f.menus[0];
  assert.equal(root.children.length, 6);
  const items = [...root.items, ...root.children.flatMap(m => m.items)];
  assert.equal(new Set(items.map(i => i.handler)).size, items.length);
  for (const item of items) assert.equal(typeof f.ctx[item.handler], 'function', item.handler);
  assert(!items.some(i => ['updatePrices', 'toggleManualKeepLatestOption', 'setupTrigger', 'initSheet'].includes(i.handler)));
  const dangerous = root.children.find(m => m.name.startsWith('⚠️'));
  assert.deepEqual(dangerous.items.map(i => i.handler), ['clearPriceAndSnapshotRows', 'clearTossOpenApiConfigPrompt', 'resetDailyTriggersPrompt']);
  assert(root.items[0].label.includes('버전업 필수 작업 아님'));
  f.ctx._addFallbackMenu(f.ui);
  assert(f.menus[1].children[0].name.startsWith('⚠️'));
}

// Diagnosis with missing triggers must not repair anything or save properties.
{
  const f = fixture();
  f.ctx._ensureDailyTriggers = fix => { assert.equal(fix, false); return {}; };
  f.ctx._getLatestDateInColumn = () => '-';
  f.ctx._getLatestLifecycleValidSnapshotDate = () => '-';
  f.ctx._getPrevTradingDay = () => '2026-10-05'; f.ctx.today = () => '2026-10-06';
  f.ctx.checkDailyAutomationStatus();
  assert.equal(f.writes.length, 0);
  assert(f.messages.at(-1)[0].includes('누락 자동 트리거 복구'));
  f.props.set(f.ctx.SNAPSHOT_REPAIR_STATE_KEY, JSON.stringify({ done: false }));
  f.ctx._hasSnapshotRepairContinuationTrigger = () => false;
  f.ctx._snapshotRepairStatusMessage = () => '진행 중';
  f.ctx._scheduleSnapshotRepairContinuation = () => assert.fail('조회가 트리거를 예약함');
  f.ctx.showSnapshotRepairProgress();
  assert.equal(f.writes.length, 0);
  f.ctx.showManualPriceHistoryPolicy(); assert.equal(f.writes.length, 0);
  f.ctx.maintainSystemBackups = options => {
    assert.equal(options.apply, false);
    return { bySource: {}, beforeCount: 0, totalCellsBefore: 100, remainingCellsBefore: 1000 };
  };
  f.ctx.showSystemBackupDiagnosis(); assert.equal(f.writes.length, 0);
}

// Cancel every new execution gate: downstream code must not run.
for (const [entry, downstream] of [
  ['repairMissingDailyTriggersPrompt', '_ensureDailyTriggers'],
  ['resetDailyTriggersPrompt', 'setupTrigger'], ['repairSheetStructurePrompt', 'initSheet'],
  ['resumeSnapshotRepairPrompt', 'showSnapshotConsistencyRepairStatus'],
  ['resumeBackfillPrompt', 'backfillResume'], ['runDailyPriceSnapshotNow', 'saveDailyPriceHistory'],
  ['runSnapshotConsistencyRepair', '_startSnapshotConsistencyRepair'], ['runDataCleanup', 'cleanDeadCodes'],
  ['migrateLegacyApiKeysPrompt', 'migrateLegacyApiKeysToScriptProperties'],
]) {
  const f = fixture(); f.ctx[downstream] = () => assert.fail(entry + ' executed after cancel');
  f.ctx[entry](); assert.equal(f.calls.length, 0);
}

// Closing the KRX choice must not silently take the NO/save-output route.
for (const answer of ['CANCEL', 'CLOSE', 'NO', 'YES']) {
  const f = fixture(); f.responses.push(['OK', '20261001~20261006'], answer);
  f.ctx._buildWantedByMarketFromCodeSheet = () => ({});
  f.ctx.Utilities = { formatDate: () => '20261006' };
  f.ctx._runKrxImport = (...args) => f.calls.push(args[3]);
  f.ctx.importKrxClosesPrompt();
  assert.deepEqual(f.calls, answer === 'YES' ? [true] : answer === 'NO' ? [false] : []);
}

// Removing authentication requires an extra confirmation; cancellation keeps the token.
{
  const f = fixture(); f.props.set('access_token', 'existing-token');
  f.responses.push(['OK', '-'], 'NO'); f.ctx.configureAccessTokenPrompt();
  assert.equal(f.props.get('access_token'), 'existing-token'); assert.equal(f.writes.length, 0);
}

// Confirmed wrappers continue the existing operational route exactly once.
for (const [entry, downstream] of [
  ['resetDailyTriggersPrompt', 'setupTrigger'], ['repairSheetStructurePrompt', 'initSheet'],
  ['resumeSnapshotRepairPrompt', 'showSnapshotConsistencyRepairStatus'], ['resumeBackfillPrompt', 'backfillResume'],
  ['runDailyPriceSnapshotNow', 'saveDailyPriceHistory'], ['runSnapshotConsistencyRepair', '_startSnapshotConsistencyRepair'],
]) {
  const f = fixture(); f.responses.push('YES');
  f.ctx[downstream] = () => { f.calls.push(downstream); return { done: true, date: '2026-10-05', rows: 1 }; };
  f.ctx._snapshotRepairStatusMessage = () => '완료'; f.ctx[entry]();
  assert.deepEqual(f.calls, [downstream]);
}
{
  const f = fixture(); f.responses.push('YES');
  f.ctx._ensureDailyTriggers = fix => { assert.equal(fix, true); f.calls.push('missing'); };
  f.ctx.checkDailyAutomationStatus = () => f.calls.push('status');
  f.ctx.repairMissingDailyTriggersPrompt(); assert.deepEqual(f.calls, ['missing', 'status']);
}

// Full deletion requires YES and the exact phrase; close/cancel/typo cannot delete.
for (const [first, second, deleted] of [
  ['NO', ['OK', '가격이력·스냅샷 삭제'], false],
  ['YES', ['CANCEL', '가격이력·스냅샷 삭제'], false],
  ['YES', ['OK', '삭제'], false], ['YES', ['OK', '가격이력·스냅샷 삭제'], true],
]) {
  const f = fixture(); f.responses.push(first, second);
  f.ctx._touchSnapshotIntegritySourceRevision = () => f.calls.push('revision');
  f.ctx.clearPriceAndSnapshotRows();
  assert.deepEqual(f.calls, deleted ? ['clearContent', 'clearContent', 'revision'] : []);
}

// Backfill validates months/order and only starts after explicit confirmation.
for (const [from, to, answer, started] of [
  ['2026-00', '2026-10', 'YES', false], ['2026-01', '2026-13', 'YES', false],
  ['2026-10', '2026-01', 'YES', false], ['2026-01', '2026-10', 'NO', false],
  ['2026-1', '2026-10', 'YES', true],
]) {
  const f = fixture(); f.responses.push(['OK', from], ['OK', to], answer);
  f.ctx.backfillRange = () => f.calls.push('start'); f.ctx.backfillRangePrompt();
  assert.equal(f.calls.length, started ? 1 : 0);
  assert.equal(f.writes.length, 0);
}

// Anomaly read-only mode cannot reach the price/snapshot write path.
{
  const f = fixture(); f.responses.push(['OK', '2026-10-05~2026-10-05'], ['OK', '8']);
  f.ctx._listPriceHistoryDatesInRange = () => ['2026-10-05'];
  f.ctx.detectPriceAnomalyForDate = () => ({ anomalies: [{ date: '2026-10-05', code: '005930', gf: 100 }] });
  f.ctx.batchUpsertPriceHistory = () => assert.fail('진단이 가격을 저장함');
  f.ctx.repairPriceAndSnapshotForDate = () => assert.fail('진단이 스냅샷을 저장함');
  f.ctx.runPriceAnomalyDiagnosis(); assert.equal(f.calls.length, 0);
}

// Strict calendar input and result/error reporting delegate to the existing range diagnosis.
for (const input of ['2026-02-30~2026-03-01', '2026-10-06~2026-10-01', 'invalid']) {
  const f = fixture(); f.responses.push(['OK', input]);
  f.ctx.handleDiagnoseSnapshotIntegrityRange = () => assert.fail('잘못된 날짜가 진단에 전달됨');
  f.ctx.showPortfolioIntegrityDiagnosisPrompt();
}
{
  const f = fixture(); f.responses.push(['OK', '2026-10-01~2026-10-06']);
  f.ctx.handleDiagnoseSnapshotIntegrityRange = (...args) => {
    assert.deepEqual(args, ['2026-10-01', '2026-10-06', '', '']);
    return { getContent: () => JSON.stringify({ status: 'ok', diagnostics: [{ status: 'VALID' }], checkedDates: ['2026-10-01'], priceIntegrity: { counts: { VALID: 1 } } }) };
  };
  f.ctx.showPortfolioIntegrityDiagnosisPrompt(); assert.equal(f.writes.length, 0);
  assert(f.messages.at(-1)[0].includes('정상: 1'));
}
console.log('✅ GAS 메뉴 실행·진단 분리, 취소 시 무변경, 초기화 이중 확인 회귀 검사 통과');
