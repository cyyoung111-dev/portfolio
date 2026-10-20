import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  buildUpdatedFiles,
  deploymentIdFromWebAppUrl,
  extractExpectedGasVersion,
  assertGasReleaseReady,
  assertGasProjectFileSet,
  assertGasCreatedVersionReady,
  gasSourceBlobSha,
  parseClaspCredentials,
  sanitizeFiles,
  selectServerFile,
  verifyDeploymentVersionWithRetry,
} from './deploy-gas.mjs';

assert.equal(deploymentIdFromWebAppUrl('https://script.google.com/macros/s/AKfycb-example/exec'), 'AKfycb-example');
assert.throws(() => deploymentIdFromWebAppUrl('https://example.com/not-gas'), /deployment ID/);

// A successfully published Apps Script deployment can report the previous
// version briefly. Retry the read on the same ID instead of creating 292+
let readAttempts=0,delayCount=0;
const confirmed=await verifyDeploymentVersionWithRetry({
  readDeployment:async()=>({deploymentConfig:{versionNumber:++readAttempts>=3?291:290}}),
  expectedVersion:291,pause:async ms=>{delayCount++;assert.ok(ms>=1500)},maxChecks:5,
});
assert.equal(confirmed.deploymentConfig.versionNumber,291);
assert.equal(readAttempts,3);
assert.equal(delayCount,2);
readAttempts=0;delayCount=0;
await assert.rejects(()=>verifyDeploymentVersionWithRetry({
  readDeployment:async()=>{readAttempts++;return {deploymentConfig:{versionNumber:290}};},
  expectedVersion:291,pause:async()=>{delayCount++},maxChecks:4,
}),/deployment version 검증 실패: expected=291, observed=290/);
assert.equal(readAttempts,4);
assert.equal(delayCount,3);
await assert.rejects(()=>verifyDeploymentVersionWithRetry({
  readDeployment:async()=>({deploymentConfig:{versionNumber:291}}),
  expectedVersion:291,pause:async()=>{},maxChecks:0,
}),/GAS_DEPLOYMENT_READBACK_INVALID/);

const source = `// Google Apps Script  v9.160
function handle(){ return { gasVersion: '9.160' }; }
const x = { gasVersion: '9.160' };`;
assert.equal(extractExpectedGasVersion(source), '9.160');
assert.throws(() => extractExpectedGasVersion(`// Google Apps Script  v9.160\nconst x={gasVersion:'9.159'};`), /버전 불일치/);

assert.equal(gasSourceBlobSha('hello'), 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0',
  'hashing must match Git blob format, not a plain-file digest');
assert.throws(() => assertGasReleaseReady(source),
  /GAS_RELEASE_UNREVIEWED_VERSION/, 'unreviewed old versions and rollbacks must fail closed');

const partialRelease = source.replaceAll('9.160', '9.193');
assert.throws(() => assertGasReleaseReady(partialRelease),
  /GAS_RELEASE_SOURCE_NOT_APPROVED/, 'partial 9.193 must never be deployed');
const fakeFullRelease = partialRelease + `
function _getKrxAuthKeySlots_(){}
const found = { fundAttempt: {} };
let snapshotValidatedNoOp=0; snapshotValidatedNoOp++;
var authDeniedMarkets=[];
var missingItems = items.filter(() => true);
// 종가원천일
`;
assert.throws(() => assertGasReleaseReady(fakeFullRelease),
  /GAS_RELEASE_SOURCE_NOT_APPROVED/, 'dummy implementation and comments cannot bypass the gate');

const bumpedVersion = partialRelease.replaceAll('9.193', '9.252');
assert.throws(() => assertGasReleaseReady(bumpedVersion),
  /GAS_RELEASE_UNREVIEWED_VERSION/, 'unreviewed future version must fail closed');
assert.throws(() => assertGasReleaseReady(bumpedVersion.replaceAll('9.252','10.0')),
  /GAS_RELEASE_UNREVIEWED_VERSION/, 'major version bumps must also fail closed');

const currentGasSource = fs.readFileSync('src/gas/apps_script.gs','utf8');

// Review-before-request release gate: a green GAS build must not conceal a
// version mismatch or a stale release note (both occurred during PR #505).
const activeGasVersion = extractExpectedGasVersion(currentGasSource);
const webSettings = fs.readFileSync('src/web/features/settings/settings_fetch.js', 'utf8');
const webVersionDeclarations = [...webSettings.matchAll(
  /\bconst\s+EXPECTED_GAS_VERSION\s*=\s*['"](\d+\.\d+)['"]/g,
)];
assert.equal(webVersionDeclarations.length, 1, 'web EXPECTED_GAS_VERSION must have exactly one declaration');
assert.equal(webVersionDeclarations[0][1], activeGasVersion,
  'GAS header, API responses and web EXPECTED_GAS_VERSION must agree before Codex review');
const deploymentNotes = fs.readFileSync('DEPLOYMENT.md', 'utf8');
const latestReleaseHeading = deploymentNotes.match(/^## GAS v(\d+\.\d+)\b/m);
assert.equal(latestReleaseHeading?.[1], activeGasVersion,
  'DEPLOYMENT.md must document the latest GAS release at the top before review');
const latestReleaseNotes = deploymentNotes.slice(
  latestReleaseHeading.index,
  deploymentNotes.indexOf('\n---', latestReleaseHeading.index) < 0
    ? undefined : deploymentNotes.indexOf('\n---', latestReleaseHeading.index),
);
assert.match(latestReleaseNotes, /배포 상태/, 'latest GAS release needs a separate deployment state');
assert.match(latestReleaseNotes, /배포 후/, 'latest GAS release needs a post-deployment verification step');
assert.ok(!latestReleaseNotes.includes('## GAS v9.228'),
  'newest GAS release must end before historical v9.228 section');
assert.ok(latestReleaseNotes.includes('gasVersion=9.251') && latestReleaseNotes.includes('Snapshot'),
  'latest release must document post-deployment source integrity and Snapshot verification');

// Execute the *actual trigger-registration functions*, not copies of their
// scheduling expressions. These checks would catch PR #505's 00:10/00:30
// midnight boundary, a missing registration, and duplicate trigger repair.
function triggerDefinition(name) {
  const begin = currentGasSource.indexOf('function ' + name + '(');
  assert.ok(begin >= 0, 'missing production trigger function: ' + name);
  const end = currentGasSource.indexOf('\n}', begin);
  assert.ok(end > begin, 'unterminated production trigger function: ' + name);
  return currentGasSource.slice(begin, end + 2);
}
function verifyTriggerRegistration(name, handler, expectedHour, expectedMinute, definition = triggerDefinition(name)) {
  const installed = [], created = [], deleted = [];
  const app = {
    getProjectTriggers: () => installed.slice(),
    newTrigger: actualHandler => {
      const clock = {handler:actualHandler};
      return {
        timeBased() { clock.timeBased = true; return this; },
        everyDays(days) { clock.days = days; return this; },
        inTimezone(tz) { clock.timezone = tz; return this; },
        atHour(hour) { clock.hour = hour; return this; },
        nearMinute(minute) { clock.minute = minute; return this; },
        create() {
          created.push(clock);
          installed.push({getHandlerFunction:() => actualHandler});
        },
      };
    },
    deleteTrigger: t => {
      deleted.push(t);
      const index = installed.indexOf(t);
      if (index >= 0) installed.splice(index, 1);
    },
  };
  const context = vm.createContext({ScriptApp:app, CONFIG:{TIMEZONE:'Asia/Seoul'}});
  new vm.Script(definition, {filename:'src/gas/apps_script.gs'}).runInContext(context);
  assert.equal(context[name](false), false, name + ': absent trigger must be reported');
  assert.equal(created.length, 0, name + ': read-only health check must not create a trigger');
  assert.equal(context[name](true), true, name + ': repair must install missing trigger');
  assert.deepEqual(created[0], {
    handler, timeBased:true, days:1, timezone:'Asia/Seoul',
    hour:expectedHour, minute:expectedMinute,
  }, name + ': daily schedule drift; check lease windows and midnight rollover');
  // Repeated repair must be idempotent, and must remove duplicates.
  assert.equal(context[name](true), true);
  assert.equal(created.length, 1, name + ': existing trigger must not be recreated');
  installed.push({getHandlerFunction:() => handler});
  assert.equal(context[name](true), true);
  assert.equal(installed.length, 1, name + ': duplicate triggers must be removed');
  assert.equal(deleted.length, 1, name + ': duplicate cleanup must be idempotent');
  assert.equal(context[name](false), true, name + ': read-only health check must detect the installed trigger');
}
verifyTriggerRegistration('_ensurePortfolioCloseBackfillTrigger',
  'runPortfolioCloseBackfill2210', 22, 10);
verifyTriggerRegistration('_ensurePortfolioHistoricalBackfillTrigger',
  'runPortfolioHistoricalBackfill2240', 23, 10);
verifyTriggerRegistration('_ensurePortfolioHistoricalBackfill0010Trigger',
  'runPortfolioHistoricalBackfill0010', 0, 30);
verifyTriggerRegistration('_ensurePortfolioMorningKrxBackfillTrigger',
  'runPortfolioMorningKrxBackfill0845', 8, 45);
// Mutation guard: a pre-midnight 00:10 registration must fail this test.
const midnightRegistration = triggerDefinition('_ensurePortfolioHistoricalBackfill0010Trigger');
assert.ok(midnightRegistration.includes('nearMinute(30)'), '00:30 source setup missing');
assert.throws(() => verifyTriggerRegistration(
  '_ensurePortfolioHistoricalBackfill0010Trigger',
  'runPortfolioHistoricalBackfill0010', 0, 30,
  midnightRegistration.replace('nearMinute(30)', 'nearMinute(10)'),
), /daily schedule drift/, 'pre-midnight-capable 00:10 registration must be rejected');
for (const label of ['22:10', '23:10', '00:30', '08:45']) {
  assert.ok(latestReleaseNotes.includes(label),
    'release note must name the actual operational trigger schedule: ' + label);
}
// A correct installed clock is not enough if API/menu diagnostics call it by
// an obsolete name or report the wrong time to the operator.
const setupTriggerSource = triggerDefinition('setupTrigger');
const diagnosisSource = triggerDefinition('checkDailyAutomationStatus');
const statusApiSource = triggerDefinition('_getAutomationStatusData');
const operationalLabels = [
  ['runPortfolioCloseBackfill2210', '22:10'],
  ['runPortfolioHistoricalBackfill2240', '23:10'],
  ['runPortfolioHistoricalBackfill0010', '00:30'],
  ['runPortfolioMorningKrxBackfill0845', '08:45'],
];
for (const [handler, label] of operationalLabels) {
  assert.ok(setupTriggerSource.includes(label),
    'setupTrigger must show the installed schedule ' + handler + ' (' + label + ')');
  assert.ok(diagnosisSource.includes(handler + '(' + label + ')'),
    'daily menu diagnostic must display the actual clock ' + handler + ' (' + label + ')');
}
for (const field of [
  'hasBackfill', 'hasHistoricalBackfill', 'hasMidnightBackfill',
  'hasDuplicateBackfillTriggers', 'hasDuplicateHistoricalBackfillTriggers',
  'hasDuplicateMidnightBackfillTriggers',
  'hasMorningBackfill','hasDuplicateMorningBackfillTriggers',
]) {
  assert.ok(statusApiSource.includes(field),
    'getAutomationStatus must distinguish missing/duplicate nightly worker: ' + field);
}

// P2 regression group: run the production Settings response contract.
// Checking unrelated gasVersion literals in a full file can miss the
// actual getSettings handler silently omitting its version.
function verifyRealSettingsVersion(source = triggerDefinition('handleGetSettings')) {
  const ctx = vm.createContext({
    getss: () => ({}),
    _settlePendingCodeDeleteForRead_: () => {},
    _readSettingsMap: () => ({EDITABLE_PRICES:[]}),
    _removeSecretsFromSettings: () => {},
    _getApiKeyStatus: () => ({}),
    jsonOk: result => result,
    jsonError: message => { throw Error('getSettings runtime failed: ' + message); },
  });
  new vm.Script(source).runInContext(ctx);
  const response = ctx.handleGetSettings();
  assert.equal(response.gasVersion, activeGasVersion,
    'actual handleGetSettings must return the approved GAS version');
  assert.ok(response.settings && typeof response.settings === 'object',
    'getSettings must return a settings object');
}
verifyRealSettingsVersion();
const correctSettingsFunction = triggerDefinition('handleGetSettings');
const missingSettingsVersion = correctSettingsFunction.replace(
  /gasVersion:\s*['"]\d+\.\d+['"]/, 'version: "unversioned"');
assert.notEqual(missingSettingsVersion, correctSettingsFunction);
assert.throws(() => verifyRealSettingsVersion(missingSettingsVersion),
  /actual handleGetSettings/, 'omitted getSettings gasVersion must fail independently of bootstrap');

// Use the true production CONFIG object for schedule testing, not a fixture
// that unconditionally supplies KST even after a production timezone change.
const productionConfigMatch = currentGasSource.match(/\bvar\s+CONFIG\s*=\s*\{[\s\S]*?\n\};/);
assert.ok(productionConfigMatch, 'production CONFIG literal must be available');
const productionConfigSource = productionConfigMatch[0];
function verifyProductionTimezone(source = productionConfigSource) {
  const ctx = vm.createContext({});
  new vm.Script(source).runInContext(ctx);
  assert.equal(ctx.CONFIG.TIMEZONE, 'Asia/Seoul',
    'production CONFIG.TIMEZONE must be Asia/Seoul for KST midnight triggers');
  return ctx.CONFIG.TIMEZONE;
}
const productionTimezone = verifyProductionTimezone();
const driftedTimezone = productionConfigSource.replace(
  /TIMEZONE:\s*['"]Asia\/Seoul['"]/, "TIMEZONE: 'UTC'");
assert.notEqual(driftedTimezone, productionConfigSource);
assert.throws(() => verifyProductionTimezone(driftedTimezone),
  /production CONFIG.TIMEZONE/, 'UTC regression must be rejected before review');

// Run actual production trigger discovery + API/menu diagnostics against
// missing, duplicate, and healthy trigger sets. All reads must be side-effect
// free. Only external data readers are mocked; inspected handlers are real.
const statusFunctions = [
  '_ensureSnapshotIntegrityChangeTrigger',
  '_ensureSnapshotIntegrityEditTrigger',
  '_ensurePendingTradeSnapshotRebuildTrigger',
  '_readPendingTradeSnapshotRebuild',
  '_readTradeSnapshotDeferredState_',
  '_tradeLedgerWriteUnverified_',
  '_ensureDailyTriggers',
  '_getTradeSnapshotWorkerTriggerAudit_',
  '_getAutomationStatusData',
  'checkDailyAutomationStatus',
];
const requiredHandlers = [
  'runCodeNormalize1550', 'syncMortgageFromSchedule',
  'runDailyPortfolioClose1900', 'runPortfolioCloseWatchdog2030',
  'runPortfolioCloseBackfill2210', 'runPortfolioHistoricalBackfill2240',
  'runPortfolioHistoricalBackfill0010', 'runPortfolioMorningKrxBackfill0845',
  'handleSnapshotIntegritySheetChange',
  'handleSnapshotIntegritySheetEdit', 'runPendingTradeSnapshotRebuild',
];
function runRealDiagnostics({
  missing = [], duplicate = '', overridden = {}, pendingTradeFrom = '', unverifiedTrade = false,
  deferredDates = [],
} = {}) {
  const calls = [], alerts = [], logs = [];
  const handlerNames = requiredHandlers.filter(x => !missing.includes(x));
  if (duplicate) handlerNames.push(duplicate);
  const installed = handlerNames.map(name => ({
    getHandlerFunction: () => name,
    getTriggerSourceId: () => 'unit-test-spreadsheet',
  }));
  const blockedMutation = name => {
    calls.push(name);
    throw Error('read-only diagnostic attempted mutation: ' + name);
  };
  const props = new Map([['portfolio_close_last_result', JSON.stringify({
    runDate:'2026-10-14', priceDate:'2026-10-14',
    priceOk:true, fundOk:true, errors:[],
  })]]);
  if(pendingTradeFrom)props.set('trade_snapshot_rebuild_pending_v1',JSON.stringify({from:pendingTradeFrom}));
  if(unverifiedTrade)props.set('trade_ledger_write_unverified_v1',JSON.stringify({state:'WRITING'}));
  if(deferredDates.length) props.set('trade_snapshot_rebuild_deferred_v1',
    JSON.stringify({dates:deferredDates,cursor:''}));
  const ctx = vm.createContext({
    TRADE_SNAPSHOT_REBUILD_PENDING_KEY: 'trade_snapshot_rebuild_pending_v1',
    TRADE_SNAPSHOT_DEFERRED_DATES_KEY: 'trade_snapshot_rebuild_deferred_v1',
    TRADE_SNAPSHOT_WORKER_LAST_KEY: 'trade_snapshot_worker_last_v1',
    TRADE_SNAPSHOT_WORKER_BUSY_KEY: 'trade_snapshot_worker_busy_v1',
    TRADE_LEDGER_WRITE_JOURNAL_KEY: 'trade_ledger_write_unverified_v1',
    ScriptApp: {
      getProjectTriggers: () => installed.slice(),
      newTrigger: () => blockedMutation('newTrigger'),
      deleteTrigger: () => blockedMutation('deleteTrigger'),
    },
    getss: () => ({
      getId: () => 'unit-test-spreadsheet',
      getSheetByName: () => ({}),
    }),
    PropertiesService: {getScriptProperties: () => ({
      getProperty: key => props.get(key) ?? null,
      setProperty: () => blockedMutation('setProperty'),
      deleteProperty: () => blockedMutation('deleteProperty'),
    })},
    LockService: {getScriptLock: () => blockedMutation('getScriptLock')},
    Logger: {log: message => logs.push(String(message))},
    SpreadsheetApp: {getUi: () => ({alert: message => alerts.push(String(message))})},
    Utilities: {formatDate: () => '2026-10-14 23:00:00'},
    _getLatestLifecycleValidSnapshotDate: () => '2026-10-14',
    _getLatestDateInColumn: () => '2026-10-14',
    _getOfficialKrxPriceHistoryLastDate: () => '2026-10-14',
    _portfolioCloseRunState: () => ({state:'COMPLETE'}),
    _fundAttemptDiagnosticState_: () => null,
    _expectedConfirmedSnapshotDate: () => '2026-10-14',
    _expectedPortfolioCloseRunDate: () => '2026-10-14',
    _isPortfolioCloseRunStale: () => false,
    _readPendingKrxCloseDates_: () => [],
    _normalizeDate:value=>String(value||''),
  });
  new vm.Script(productionConfigSource).runInContext(ctx);
  assert.equal(ctx.CONFIG.TIMEZONE, productionTimezone);
  for (const fn of statusFunctions) {
    new vm.Script(overridden[fn] ?? triggerDefinition(fn)).runInContext(ctx);
  }
  const data = JSON.parse(JSON.stringify(ctx._getAutomationStatusData()));
  ctx.checkDailyAutomationStatus();
  assert.equal(alerts.length, 1, 'diagnostic menu must render one status alert');
  assert.equal(calls.length, 0, 'diagnostic API and menu must never mutate triggers or properties');
  assert.equal(data.gasVersion, activeGasVersion);
  assert.ok(data.trigger && typeof data.trigger === 'object');
  return {data, message:alerts[0], logs, calls};
}
const pendingLedgerDiagnostics=runRealDiagnostics({pendingTradeFrom:'2026-06-05'});
assert.equal(pendingLedgerDiagnostics.data.overallStatus,'WARNING',
  'P1: unfinished ledger-based revaluation must never appear NORMAL');
assert.equal(pendingLedgerDiagnostics.data.pendingTradeSnapshotRebuildFrom,'2026-06-05');
const deferredDiagnostics=runRealDiagnostics({deferredDates:['2025-12-31']});
assert.equal(deferredDiagnostics.data.tradeSnapshotDeferredCount,1);
assert.equal(deferredDiagnostics.data.tradeSnapshotDeferredOldestDate,'2025-12-31');
assert.equal(deferredDiagnostics.data.overallStatus,'WARNING',
  'known unresolved historical dates must never appear NORMAL');
const incompleteJournal=runRealDiagnostics({unverifiedTrade:true});
assert.equal(incompleteJournal.data.overallStatus,'WARNING','unverified trade sheet must never appear NORMAL');
assert.equal(incompleteJournal.data.tradeLedgerWriteUnverified,true);
const normalDiagnostics = runRealDiagnostics();
assert.equal(normalDiagnostics.data.overallStatus, 'NORMAL');
assert.equal(normalDiagnostics.data.trigger.hasMidnightBackfill, true);
assert.equal(normalDiagnostics.data.trigger.hasIntegrityEdit, true);
assert.equal(normalDiagnostics.data.trigger.hasLedgerRebuild, true);
for (const [handler,flag] of [
  ['handleSnapshotIntegritySheetEdit','hasIntegrityEdit'],
  ['runPendingTradeSnapshotRebuild','hasLedgerRebuild'],
]) {
  const absent=runRealDiagnostics({missing:[handler]});
  assert.equal(absent.data.overallStatus,'ERROR',handler+' missing must fail health');
  assert.equal(absent.data.trigger[flag],false);
  assert.match(absent.message,/트리거 상태 이상/);
}
assert.equal(normalDiagnostics.data.trigger.midnightBackfillCount, 1);
assert.match(normalDiagnostics.message, /트리거는 정상 집합/);
for (const [handler, flag, dupFlag, countKey, label] of [
  ['runPortfolioCloseBackfill2210','hasBackfill','hasDuplicateBackfillTriggers','backfillCount','22:10'],
  ['runPortfolioHistoricalBackfill2240','hasHistoricalBackfill','hasDuplicateHistoricalBackfillTriggers','historicalBackfillCount','23:10'],
  ['runPortfolioHistoricalBackfill0010','hasMidnightBackfill','hasDuplicateMidnightBackfillTriggers','midnightBackfillCount','00:30'],
  ['runPortfolioMorningKrxBackfill0845','hasMorningBackfill','hasDuplicateMorningBackfillTriggers','morningBackfillCount','08:45'],
]) {
  const absent = runRealDiagnostics({missing:[handler]});
  assert.equal(absent.data.overallStatus,'ERROR',handler + ' missing must report ERROR');
  assert.equal(absent.data.trigger[flag],false,handler + ' missing status must be false');
  assert.equal(absent.data.trigger[countKey],0);
  assert.ok(absent.message.includes(handler + '(' + label + ')')
    && absent.message.includes('트리거 상태 이상')
    && absent.message.includes(handler + '(' + label + ')')
      && absent.message.slice(absent.message.indexOf(handler + '(' + label + ')')).includes('없음'),
    handler + ' missing must be visible in the menu');
  const doubled = runRealDiagnostics({duplicate:handler});
  assert.equal(doubled.data.overallStatus,'ERROR',handler + ' duplicate must report ERROR');
  assert.equal(doubled.data.trigger[dupFlag],true);
  assert.equal(doubled.data.trigger[countKey],2);
  assert.ok(doubled.message.includes(handler + '(' + label + ')')
    && doubled.message.includes('중복 2개'),handler + ' duplicate must be visible');
}
// Representative mutation: a diagnostic reporting midnight registration as
// always true must fail while the real installed fixture has no such trigger.
const apiOriginal = triggerDefinition('_getAutomationStatusData');
const apiRegressed = apiOriginal.replace(
  'hasMidnightBackfill: !!trig.hasMidnightBackfill',
  'hasMidnightBackfill: true');
assert.notEqual(apiOriginal,apiRegressed);
const broken = runRealDiagnostics({
  missing:['runPortfolioHistoricalBackfill0010'],
  overridden:{_getAutomationStatusData:apiRegressed},
});
assert.equal(broken.data.trigger.hasMidnightBackfill,true);
assert.notEqual(broken.data.trigger.hasMidnightBackfill,
  runRealDiagnostics({missing:['runPortfolioHistoricalBackfill0010']}).data.trigger.hasMidnightBackfill,
  'mutation must be distinguishable from correct production diagnostic');
assert.throws(() => assert.equal(broken.data.trigger.hasMidnightBackfill,false),
  /true !== false/, 'diagnostic always-true regression must be caught by fixture assertion');

// setupTrigger is intentionally state-changing. Exercise its production
// registration path separately from the read-only diagnostics fixtures.
function verifyRealTriggerSetup() {
  const installed=[], deleted=[], created=[], alerts=[];
  const fakeSpreadsheet={getId:()=> 'unit-test-spreadsheet'};
  let ownsLock=false, locksAcquired=0;
  function makeEntry(name,sourceId='') {
    return {
      getHandlerFunction:()=>name,
      getTriggerSourceId:()=>sourceId,
    };
  }
  for (const handler of [
    'runPortfolioCloseBackfill2210','runPortfolioCloseBackfill2210',
    'runPortfolioHistoricalBackfill2240','runPortfolioHistoricalBackfill0010',
    'runEvalPriceUpdate1620'
  ]) installed.push(makeEntry(handler));
  const app={
    getProjectTriggers:()=> installed.slice(),
    deleteTrigger:t=>{
      deleted.push(t.getHandlerFunction());
      const i=installed.indexOf(t);
      assert.ok(i>=0, 'setup may only delete installed triggers');
      installed.splice(i,1);
    },
    newTrigger:handler=>{
      const clock={handler};
      return {
        timeBased(){clock.mode='time';return this;},
        everyDays(days){clock.days=days;return this;},
        everyHours(hours){clock.hours=hours;return this;},
        inTimezone(tz){clock.timezone=tz;return this;},
        atHour(h){clock.hour=h;return this;},
        nearMinute(m){clock.minute=m;return this;},
        forSpreadsheet(ss){assert.equal(ss,fakeSpreadsheet);clock.mode='sheet';return this;},
        onChange(){clock.change=true;return this;},
        onEdit(){clock.edit=true;return this;},
        create(){
          created.push(clock);
          installed.push(makeEntry(handler,clock.mode==='sheet'?'unit-test-spreadsheet':''));
        },
      };
    },
  };
  const ctx=vm.createContext({
    ScriptApp:app,
    getss:()=>fakeSpreadsheet,
    _cleanupBenchmarkTempSheets:()=>{},
    onOpen:()=>{},
    Logger:{log:()=>{}},
    SpreadsheetApp:{getUi:()=>({alert:msg=>alerts.push(String(msg))})},
    LockService:{getScriptLock:()=>({
      hasLock:()=>ownsLock,
      waitLock:()=>{locksAcquired++;ownsLock=true;},
      releaseLock:()=>{ownsLock=false;},
    })},
  });
  new vm.Script(productionConfigSource).runInContext(ctx);
  for(const name of [
    '_ensurePortfolioCloseDailyTrigger','_ensurePortfolioCloseWatchdogTrigger',
    '_ensurePortfolioCloseBackfillTrigger','_ensurePortfolioHistoricalBackfillTrigger',
    '_ensurePortfolioHistoricalBackfill0010Trigger',
    '_ensurePortfolioMorningKrxBackfillTrigger',
    '_ensureSnapshotIntegrityChangeTrigger',
    '_ensureSnapshotIntegrityEditTrigger','_ensurePendingTradeSnapshotRebuildTrigger',
    'setupTrigger',
  ]) new vm.Script(triggerDefinition(name)).runInContext(ctx);
  ctx.setupTrigger();
  for(const [handler,hour,minute] of [
    ['runCodeNormalize1550',15,50],['syncMortgageFromSchedule',1,10],
    ['runPortfolioCloseBackfill2210',22,10],
    ['runPortfolioHistoricalBackfill2240',23,10],
    ['runPortfolioHistoricalBackfill0010',0,30],
    ['runPortfolioMorningKrxBackfill0845',8,45],
  ]) {
    const jobs=created.filter(c=>c.handler===handler);
    assert.equal(jobs.length,1,'setupTrigger must install exactly one '+handler);
    assert.equal(jobs[0].hour,hour,'setupTrigger hour regression: '+handler);
    assert.equal(jobs[0].minute,minute,'setupTrigger minute regression: '+handler);
    assert.equal(jobs[0].timezone,productionTimezone,'setupTrigger timezone regression: '+handler);
  }
  for(const handler of [
    'runDailyPortfolioClose1900','runPortfolioCloseWatchdog2030',
    'handleSnapshotIntegritySheetChange',
    'handleSnapshotIntegritySheetEdit', 'runPendingTradeSnapshotRebuild',
  ]) assert.equal(created.filter(c=>c.handler===handler).length,1,
    'setupTrigger must install required operational trigger: '+handler);
  assert.equal(installed.filter(t=>t.getHandlerFunction()==='runEvalPriceUpdate1620').length,0,
    'obsolete split price trigger must be removed');
  assert.ok(deleted.filter(s=>s==='runPortfolioCloseBackfill2210').length===2,
    'setupTrigger must remove both previous same-day triggers before reinstalling one');
  assert.equal(locksAcquired,1,'sheet integrity trigger registration must obtain a lock');
  assert.equal(ownsLock,false,'sheet integrity registration must release its lock');
  assert.ok(alerts.some(s=>s.includes('22:10')&&s.includes('23:10')&&s.includes('00:30')),
    'setupTrigger user notice must match the installed clock');
  assert.equal(installed.filter(t=>t.getHandlerFunction()==='runPortfolioHistoricalBackfill0010').length,1);
}
verifyRealTriggerSetup();

// The production web app is a standalone script: editor repairs cannot use
// SpreadsheetApp.getUi(). Install only the two missing historical workers.
function standaloneHistoricalInstall(initial = [], failHandler = '') {
  let held = false;
  const jobs = initial.map(handler => ({getHandlerFunction:()=>handler}));
  const created = [];
  const ctx = vm.createContext({
    CONFIG:{TIMEZONE:productionTimezone},
    SpreadsheetApp:new Proxy({}, {get(){throw new Error('SHEET_ACCESS_FORBIDDEN');}}),
    PropertiesService:new Proxy({}, {get(){throw new Error('PROPERTY_ACCESS_FORBIDDEN');}}),
    LockService:{getScriptLock:()=>({
      waitLock(){assert.equal(held,false);held=true;},
      releaseLock(){assert.equal(held,true);held=false;}
    })},
    ScriptApp:{
      getProjectTriggers:()=>{assert.equal(held,true,'trigger discovery must be inside ScriptLock');return jobs;},
      deleteTrigger(){throw new Error('TRIGGER_DELETE_FORBIDDEN');},
      newTrigger(handler){
        assert.equal(held,true,'standalone installation must hold ScriptLock');
        const spec={handler};
        const builder={timeBased(){return this;},everyDays(n){spec.days=n;return this;},
          inTimezone(tz){spec.timezone=tz;return this;},atHour(h){spec.hour=h;return this;},
          nearMinute(m){spec.minute=m;return this;},create(){
            if(handler===failHandler)throw new Error('INSTALL_FAILED');
            created.push(spec);jobs.push({getHandlerFunction:()=>handler});return {};
          }};
        return builder;
      }
    },
    Logger:{log(){}},
  });
  for(const name of ['installMissingHistoricalBackfillTriggers'])
    vm.runInContext(triggerDefinition(name),ctx);
  return {created,jobs,run:()=>ctx.installMissingHistoricalBackfillTriggers(),
    held:()=>held};
}
const historicalHandlers=['runPortfolioHistoricalBackfill2240','runPortfolioHistoricalBackfill0010'];
const standalonePrompt=vm.createContext({SpreadsheetApp:{getUi(){throw new Error('NO_UI_CONTEXT');}}});
for(const name of ['_confirmPortfolioMenuAction','repairMissingDailyTriggersPrompt'])
  vm.runInContext(triggerDefinition(name),standalonePrompt);
assert.throws(()=>standalonePrompt.repairMissingDailyTriggersPrompt(),/NO_UI_CONTEXT/,
  'the bound-sheet prompt cannot be the standalone editor recovery entry point');
const freshInstall=standaloneHistoricalInstall(['runPortfolioCloseBackfill2210']);
assert.deepEqual(JSON.parse(JSON.stringify(freshInstall.run())),{
  mode:'TRIGGER_INSTALL_ONLY',created:2,historicalBackfillCount:1,midnightBackfillCount:1
});
assert.deepEqual(freshInstall.created.map(x=>[x.handler,x.hour,x.minute,x.timezone,x.days]),[
  [historicalHandlers[0],23,10,productionTimezone,1],
  [historicalHandlers[1],0,30,productionTimezone,1]
]);
assert.equal(freshInstall.run().created,0,'repeated editor execution must be idempotent');
assert.equal(freshInstall.created.length,2);
assert.equal(freshInstall.held(),false);
const duplicateInstall=standaloneHistoricalInstall([...historicalHandlers,historicalHandlers[0]]);
assert.equal(duplicateInstall.run().historicalBackfillCount,2,'existing duplicates are reported, never deleted');
assert.equal(duplicateInstall.created.length,0);
const partialInstall=standaloneHistoricalInstall([],historicalHandlers[1]);
assert.throws(()=>partialInstall.run(),/INSTALL_FAILED/);
assert.equal(partialInstall.created.length,1,'preserve the first successful install on partial failure');
assert.equal(partialInstall.held(),false,'failure must release ScriptLock');
const retryInstall=standaloneHistoricalInstall(partialInstall.jobs.map(x=>x.getHandlerFunction()));
assert.equal(retryInstall.run().created,1,'retry installs only the still missing worker');
assert.equal(retryInstall.created[0].handler,historicalHandlers[1]);
console.log('✅ standalone 과거 백필 설치: UI/시트/Properties 무접근·중복 보존·재시도·KST 일정 검증');

console.log('✅ Codex P2 동작 검증: 실제 getSettings 반환·CONFIG KST·운영 진단 VM/누락·중복·무변경·변이 통과');

console.log('✅ 사전 리뷰 게이트: GAS/웹/배포 문서 버전, 실제 백필 트리거 생성·중복 복구·자정 변이 검사 통과');
const approvedFullSourceBlob='1af4df97bb467389c6ea60f71a6033cc7dc81483';
const actualSourceBlob=gasSourceBlobSha(currentGasSource);
const headerV237=currentGasSource.indexOf('//  v9.237 변경사항');
const headerV236=currentGasSource.indexOf('//  v9.236 변경사항');
const headerV235=currentGasSource.indexOf('//  v9.235 변경사항');
const headerV234=currentGasSource.indexOf('//  v9.234 변경사항');
const headerV233=currentGasSource.indexOf('//  v9.233 변경사항');
const headerV232=currentGasSource.indexOf('//  v9.232 변경사항');
const headerV231=currentGasSource.indexOf('//  v9.231 변경사항');
const headerV230=currentGasSource.indexOf('//  v9.230 변경사항');
const headerV229=currentGasSource.indexOf('//  v9.229 변경사항');
const headerV228=currentGasSource.indexOf('//  v9.228 변경사항');
const headerV227=currentGasSource.indexOf('//  v9.227 변경사항');
const headerV226=currentGasSource.indexOf('//  v9.226 변경사항');
const headerV225=currentGasSource.indexOf('//  v9.225 변경사항');
assert.ok(headerV237>=0 && headerV236>headerV237 && headerV235>headerV236 && headerV234>headerV235 && headerV233>headerV234 && headerV232>headerV233 && headerV231>headerV232 && headerV230>headerV231 && headerV229>headerV230 && headerV228>headerV229 && headerV227>headerV228 && headerV226>headerV227 && headerV225>headerV226,
  'v9.237/v9.236/v9.235/v9.234/v9.233/v9.232/v9.231/v9.230/v9.229/v9.228/v9.227/v9.226/v9.225 release history must be newest-first');
assert.ok(currentGasSource.slice(headerV237,headerV236).includes('거래원장'), 'v9.237 must document ledger-authoritative Snapshot rebuild');
assert.ok(currentGasSource.slice(headerV236,headerV235).includes('checkpoint'),
  'v9.236 must document independent historical checkpoint');
assert.ok(currentGasSource.slice(headerV235,headerV234).includes('KRX'),
  'v9.235 must document morning KRX backfill');
assert.ok(currentGasSource.slice(headerV234,headerV233).includes('Toss'),
  'v9.234 must document opt-in Toss relay');
assert.ok(currentGasSource.slice(headerV233,headerV232).includes('KRX'),
  'v9.233 must document proof cursor starvation protection');
assert.ok(currentGasSource.slice(headerV232,headerV231).includes('Snapshot'),
  'v9.232 must document the indexed Snapshot source-only diagnostic parity');
assert.ok(currentGasSource.slice(headerV231,headerV230).includes('ScriptLock'),
  'v9.231 must explicitly guard source-only Snapshot changes within ScriptLock');
assert.ok(currentGasSource.slice(headerV230,headerV229).includes('Snapshot'),
  'v9.230 must describe nontrading-day pending selection without bypassing Snapshot verification');
assert.ok(currentGasSource.slice(headerV229,headerV228).includes('Snapshot'),
  'v9.229 must describe persisted Snapshot proof');
assert.ok(currentGasSource.slice(headerV228,headerV227).includes('Toss 시세 API 403'),
  'v9.228 must independently describe Toss 403 classification');
assert.ok(currentGasSource.slice(headerV227,headerV226).includes('TARGET_FOREIGN_DATE_CONFLICT'),
  'v9.227 must independently describe its foreign-holdings preflight fix');
assert.ok(currentGasSource.slice(headerV226,headerV225).includes('미완료 과거일 한 날짜'),
  'v9.226 historical release must not be overwritten by the v9.227 header');
const hasStackedKrxRecovery = currentGasSource.includes('function _getKrxAuthKeySlots_(');
if (hasStackedKrxRecovery) {
  assert.equal(actualSourceBlob, approvedFullSourceBlob,
    'a fully stacked PR #481 implementation must match the reviewed full-source blob');
  assert.equal(assertGasReleaseReady(currentGasSource),'9.251',
    'the exact pinned full GAS release source must pass validation');
  assert.throws(() => assertGasReleaseReady(currentGasSource + '\\n// unexpected edit'),
    /GAS_RELEASE_SOURCE_NOT_APPROVED/, 'even a benign post-review edit must be separately approved');
} else {
  assert.throws(() => assertGasReleaseReady(currentGasSource),
    /GAS_RELEASE_SOURCE_NOT_APPROVED|GAS_RELEASE_UNREVIEWED_VERSION/,
    'partial stacked source should not pass the production readiness gate');
}

const deployScript = fs.readFileSync('scripts/deploy-gas.mjs', 'utf8');
assert.match(deployScript, /dryRun\s*\?\s*extractExpectedGasVersion\(source\)\s*:\s*assertGasReleaseReady\(source\)/,
  'production preflight must run before GAS credentials and API writes');
assert.ok(
  deployScript.indexOf('const expectedVersion = dryRun ?') <
  deployScript.indexOf('const accessToken = await getAccessToken()'),
  'reviewed source must be validated before obtaining OAuth credentials');


const claspV3 = {
  tokens: {
    default: {
      type: 'authorized_user',
      client_id: 'clasp-client-id',
      client_secret: 'clasp-client-secret',
      refresh_token: 'clasp-refresh-token',
      access_token: 'expired-access-token',
    },
  },
};
assert.deepEqual(parseClaspCredentials(JSON.stringify(claspV3)), {
  clientId: 'clasp-client-id',
  clientSecret: 'clasp-client-secret',
  refreshToken: 'clasp-refresh-token',
});
assert.deepEqual(parseClaspCredentials(JSON.stringify({
  token: { refresh_token: 'legacy-refresh-token' },
  oauth2ClientSettings: { clientId: 'legacy-id', clientSecret: 'legacy-secret' },
})), {
  clientId: 'legacy-id',
  clientSecret: 'legacy-secret',
  refreshToken: 'legacy-refresh-token',
});
assert.throws(() => parseClaspCredentials(''), /CLASPRC_JSON/);
assert.throws(() => parseClaspCredentials('{bad-json'), /올바른 JSON/);
assert.throws(() => parseClaspCredentials(JSON.stringify({ tokens: {
  one: { client_id: '1', client_secret: 's1', refresh_token: 'r1' },
  two: { client_id: '2', client_secret: 's2', refresh_token: 'r2' },
} })), /여러 clasp 사용자 토큰/);

const files = [
  { name: 'appsscript', type: 'JSON', source: '{"timeZone":"Asia/Seoul"}', updateTime: 'ignored' },
  { name: 'helpers', type: 'SERVER_JS', source: 'function helper(){}', lastModifyUser: { email: 'ignored' } },
  { name: 'apps_script', type: 'SERVER_JS', source: 'old source', functionSet: { values: [] } },
  { name: 'page', type: 'HTML', source: '<b>keep</b>' },
];

assert.equal(selectServerFile(files).name, 'apps_script');
assert.equal(selectServerFile(files, 'helpers').name, 'helpers');
assert.throws(() => selectServerFile([
  { name: 'one', type: 'SERVER_JS', source: '' },
  { name: 'two', type: 'SERVER_JS', source: '' },
]), /하나로 결정할 수 없습니다/);

const clean = sanitizeFiles(files);
assert.deepEqual(Object.keys(clean[0]), ['name', 'type', 'source']);

const updated = buildUpdatedFiles(files, 'apps_script', 'new source');
assert.equal(updated.find(file => file.name === 'apps_script').source, 'new source');
assert.equal(updated.find(file => file.name === 'helpers').source, 'function helper(){}');
assert.equal(updated.find(file => file.name === 'page').source, '<b>keep</b>');
assert.equal(updated.find(file => file.name === 'appsscript').source, '{"timeZone":"Asia/Seoul"}');
assert.throws(() => buildUpdatedFiles(files.filter(file => file.name !== 'appsscript'), 'apps_script', 'new source'), /manifest/);

const approvedProjectFiles = files.filter(f => f.name === 'appsscript' || f.name === 'apps_script');
assert.equal(assertGasProjectFileSet(approvedProjectFiles,'apps_script',approvedProjectFiles),true,
  'pinned sole GAS server and stable deployed manifest must pass');
assert.throws(() => assertGasProjectFileSet(files,'apps_script',approvedProjectFiles),
  /GAS_PROJECT_UNREVIEWED_FILES/, 'extra SERVER_JS/HTML must be rejected even when approved server matches');
assert.throws(() => assertGasProjectFileSet([...approvedProjectFiles, {
  name:'evil',type:'SERVER_JS',source:'function doGet() { return false; }'
}], 'apps_script',approvedProjectFiles), /GAS_PROJECT_UNREVIEWED_FILES/,
  'unexpected extra top-level code must never deploy');
assert.throws(() => assertGasProjectFileSet(approvedProjectFiles,'apps_script',
  [...approvedProjectFiles,{name:'extra',type:'SERVER_JS',source:'function legacy(){}'}]),
  /GAS_PROJECT_UNREVIEWED_FILES/, 'deployed versions with extra executable code also fail closed');
assert.throws(() => assertGasProjectFileSet(approvedProjectFiles.map(f =>
  f.name==='appsscript'?{...f,source:'{"timeZone":"America/New_York"}'}:f),
  'apps_script',approvedProjectFiles), /GAS_PROJECT_MANIFEST_DRIFT/,
  'manifest drift must be blocked before first write');
assert.throws(() => assertGasProjectFileSet(approvedProjectFiles.map(f =>
  f.name==='appsscript'?{...f,source:'not-json'}:f),
  'apps_script',approvedProjectFiles), /GAS_PROJECT_MANIFEST_DRIFT|GAS_PROJECT_MANIFEST_INVALID/);
const validateOrder = fs.readFileSync('scripts/deploy-gas.mjs','utf8');
assert.ok(validateOrder.indexOf('assertGasProjectFileSet(currentContent.files') <
          validateOrder.indexOf('if (alreadyDeployed) {'),
  'all-file validation must precede already-deployed fast path');
assert.ok(validateOrder.indexOf('assertGasProjectFileSet(currentContent.files') <
          validateOrder.indexOf("method: 'PUT'"),
  'all-file validation must precede any GAS write');

const versionFiles = approvedProjectFiles.map(f => f.name==='apps_script'
  ? {...f,source:'new approved GAS source'} : f);
assert.equal(assertGasCreatedVersionReady(versionFiles, 'apps_script',
  'new approved GAS source',approvedProjectFiles),true);
assert.throws(() => assertGasCreatedVersionReady(versionFiles,'apps_script',
  'unreviewed different code',approvedProjectFiles),
  /GAS_CREATED_VERSION_SOURCE_DRIFT/, 'concurrent GAS HEAD modification after POST must fail');
assert.throws(() => assertGasCreatedVersionReady([...versionFiles,
  {name:'other',type:'SERVER_JS',source:'function doGet() {}'}],
  'apps_script','new approved GAS source',approvedProjectFiles),
  /GAS_PROJECT_UNREVIEWED_FILES/, 'created version must not inherit unreviewed handlers');
assert.throws(() => assertGasCreatedVersionReady(versionFiles.map(f =>
  f.name==='appsscript'?{...f,source:'{"timeZone":"UTC"}'}:f),
  'apps_script','new approved GAS source',approvedProjectFiles),
  /GAS_PROJECT_MANIFEST_DRIFT/, 'created version manifest cannot change');
const versionValidationPos=validateOrder.indexOf('assertGasCreatedVersionReady(createdVersionContent.files');
const publishPos=validateOrder.indexOf('versionNumber: newVersionNumber,');
assert.ok(versionValidationPos > 0 && publishPos > versionValidationPos,
  'created immutable version must be verified before production deployment update');



const workflow = fs.readFileSync('.github/workflows/gas-deploy.yml', 'utf8');
assert.match(workflow, /push:\s*[\s\S]*branches:\s*\[\s*main\s*\][\s\S]*src\/gas\/apps_script\.gs/);
assert.match(workflow, /pull_request:/);
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /npm run check:gas/);
assert.match(workflow, /CLASPRC_JSON/);
assert.doesNotMatch(workflow, /GOOGLE_OAUTH_CLIENT_ID|GOOGLE_OAUTH_CLIENT_SECRET|GOOGLE_OAUTH_REFRESH_TOKEN/);
assert.match(workflow, /GAS_SCRIPT_ID/);
assert.match(workflow, /GAS_WEB_APP_URL/);
assert.match(workflow, /deploy:\s*\n\s*# #507:[^\n]*\n\s*# [^\n]*\n\s*if:\s*github\.event_name == 'workflow_dispatch'/, 'main push must not invoke live GAS deployment');
assert.doesNotMatch(workflow, /github\.event_name == 'push' && vars\.GAS_AUTO_DEPLOY_ENABLED/, 'auto production deployment on push is forbidden');
assert.match(workflow, /deploy:\s*[\s\S]*concurrency:/);
assert.match(workflow, /gas-deploy-dry-run/);
assert.match(workflow, /gas-production-deploy/);
assert.doesNotMatch(workflow.split('jobs:')[0], /concurrency:/);
const deploySource = fs.readFileSync('scripts/deploy-gas.mjs', 'utf8');
assert.match(deploySource, /if \(alreadyDeployed\) \{[\s\S]*verifyWebApp\(/);
assert.match(deploySource, /parseClaspCredentials/);
assert.doesNotMatch(workflow, /service[_ -]?account/i);

const workflowPaths = [
  '.github/workflows/gas-deploy.yml',
  '.github/workflows/web-check.yml',
  '.github/workflows/cache_busting.yml',
  '.github/workflows/market-briefing-headless.yml',
];
for (const path of workflowPaths) {
  const source = fs.readFileSync(path, 'utf8');
  assert.doesNotMatch(source, /actions\/checkout@v4/, `${path}: checkout@v4 잔존`);
  assert.doesNotMatch(source, /actions\/setup-node@v4/, `${path}: setup-node@v4 잔존`);
  assert.doesNotMatch(source, /node-version:\s*['"]20['"]/, `${path}: Node 20 잔존`);
}
assert.match(fs.readFileSync('.github/workflows/gas-deploy.yml', 'utf8'), /actions\/checkout@v7[\s\S]*actions\/setup-node@v7[\s\S]*node-version:\s*['"]24['"]/);
assert.match(fs.readFileSync('.github/workflows/web-check.yml', 'utf8'), /actions\/checkout@v7[\s\S]*actions\/setup-node@v7[\s\S]*node-version:\s*['"]24['"]/);
assert.match(fs.readFileSync('.github/workflows/market-briefing-headless.yml', 'utf8'), /actions\/checkout@v7[\s\S]*actions\/setup-node@v7[\s\S]*node-version:\s*['"]24['"]/);

console.log('✅ GAS clasp 인증·Node 24 자동배포 구성 회귀 검사 통과');
