// Issue #860: source-only observability, NOT a deployable GAS release.
// Append stage/duration logs inside reviewed financial functions without
// skipping integrity checks, changing writer order, or altering lock admission.
import assert from 'node:assert/strict';

function editFunction(source,name,edit) {
 const start=source.indexOf('function '+name+'(');
 assert(start>=0,'ISSUE860_MISSING_FUNCTION:'+name);
 const end=source.indexOf('\n}',start);
 assert(end>start,'ISSUE860_BAD_FUNCTION_BOUNDARY:'+name);
 const before=source.slice(start,end+2);
 const after=edit(before);
 assert.notEqual(after,before,'ISSUE860_NO_INSTRUMENTATION:'+name);
 return source.slice(0,start)+after+source.slice(end+2);
}
function once(source,anchor,replacement,label) {
 assert.equal(source.split(anchor).length,2,'ISSUE860_ANCHOR_DRIFT:'+label);
 return source.replace(anchor,replacement);
}
const closeInit=[
 '  // #860 log only stage labels and milliseconds, never financial data.',
 '  var issue860CloseAtMs = Date.now();',
 '  var issue860CloseMark = function(stage) {',
 '    var now = Date.now();',
 "    try { Logger.log('[ISSUE860_CLOSE_STAGE] '+JSON.stringify({stage:stage,elapsedMs:now-issue860CloseAtMs})); }",
 '    catch (ignored) {}',
 '    issue860CloseAtMs = now;',
 '  };'
].join('\n');
const fundInit=[
 '  // #860 log only NAV stage labels and milliseconds.',
 '  var issue860FundAtMs = Date.now();',
 '  var issue860FundMark = function(stage) {',
 '    var now = Date.now();',
 "    try { Logger.log('[ISSUE860_FUND_STAGE] '+JSON.stringify({stage:stage,elapsedMs:now-issue860FundAtMs})); }",
 '    catch (ignored) {}',
 '    issue860FundAtMs = now;',
 '  };'
].join('\n');
const closeEdits=[
 ['  var deferQueueCompletion = !!(options && options.deferQueueCompletion === true);',
  '  var deferQueueCompletion = !!(options && options.deferQueueCompletion === true);\n'+closeInit,'INIT_CLOSE'],
 ['      var expected = _buildSnapshotRowsFromTradeAndPriceHistory(ss, snapshotDate);',
  "      issue860CloseMark('BUILD_START');\n      var expected = _buildSnapshotRowsFromTradeAndPriceHistory(ss, snapshotDate);\n      issue860CloseMark('BUILD_DONE');",'BUILD'],
 ['      var dailyRewritePlan = _snapshotRewritePlan(ss, snapshotDate, expected);',
  "      issue860CloseMark('PLAN_START');\n      var dailyRewritePlan = _snapshotRewritePlan(ss, snapshotDate, expected);\n      issue860CloseMark('PLAN_DONE');",'PLAN'],
 ['        writeSnapshotRows(ss, snapshotDate, expected, true);',
  "        issue860CloseMark('WRITE_START');\n        writeSnapshotRows(ss, snapshotDate, expected, true);\n        issue860CloseMark('WRITE_DONE');",'WRITE'],
 ['      var savedIntegrity = diagnoseSnapshotIntegrity(ss, snapshotDate);',
  "      issue860CloseMark('INTEGRITY_START');\n      var savedIntegrity = diagnoseSnapshotIntegrity(ss, snapshotDate);\n      issue860CloseMark('INTEGRITY_DONE');",'INTEGRITY']
];
const fundEdits=[
 ['  var props = PropertiesService.getScriptProperties();',
  '  var props = PropertiesService.getScriptProperties();\n'+fundInit,'INIT_FUND'],
 ['    var result = _refreshFundValuations(getss(), _fundDateOffset(runDate, -31), runDate, undefined, false, recoveryDiagnostic || null, 1, {FUNETF:true});',
  "    issue860FundMark('VALUATION_START');\n    var result = _refreshFundValuations(getss(), _fundDateOffset(runDate, -31), runDate, undefined, false, recoveryDiagnostic || null, 1, {FUNETF:true});\n    issue860FundMark('VALUATION_DONE');",'VALUATION']
];
export function composeIssue860CloseStageTimingPreview(source) {
 assert.equal(typeof source,'string');
 assert(!source.includes('[ISSUE860_CLOSE_STAGE]'),'ISSUE860_DOUBLE_INSTRUMENT_CLOSE');
 assert(!source.includes('[ISSUE860_FUND_STAGE]'),'ISSUE860_DOUBLE_INSTRUMENT_FUND');
 let next=editFunction(source,'saveDailyPriceHistory',old=>
   closeEdits.reduce((s,[before,after,label])=>once(s,before,after,label),old));
 next=editFunction(next,'runDailyFundValuations',old=>
   fundEdits.reduce((s,[before,after,label])=>once(s,before,after,label),old));
 return {source:next,original:source,changedFunctions:['saveDailyPriceHistory','runDailyFundValuations'],
  closeStages:['BUILD_START','BUILD_DONE','PLAN_START','PLAN_DONE','WRITE_START','WRITE_DONE','INTEGRITY_START','INTEGRITY_DONE'],
  fundStages:['VALUATION_START','VALUATION_DONE'],
  label:'SOURCE_ONLY_NOT_REVIEWED_FOR_DEPLOY',
  financeWrites:0,gasDeployments:0,telegramSends:0};
}
