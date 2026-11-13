// #734 GAS 9.294 SOURCE PREVIEW ONLY. Not authorized for deployment.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {composeIssue734Gas9293OrphanedClosePreview}
  from './compose-issue734-gas9293-orphaned-close-preview.mjs';

const PARENT_BLOB='f6f9d2b03410a01bb1fbede81ed9b70b52688507';
const blob=s=>{
  const bytes=Buffer.from(s,'utf8');
  return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
};
function once(text,oldValue,newValue,reason){
  assert.equal(text.split(oldValue).length,2,'ISSUE734_9294_SOURCE_DRIFT_'+reason);
  return text.replace(oldValue,newValue);
}
function rewriteFunction(source,signature,mutate){
  const start=source.indexOf(signature);
  assert(start>=0,'ISSUE734_9294_FUNCTION_NOT_FOUND');
  const end=source.indexOf('\n}',start);
  assert(end>start,'ISSUE734_9294_FUNCTION_BOUNDARY');
  const oldBlock=source.slice(start,end+2);
  return source.slice(0,start)+mutate(oldBlock)+source.slice(end+2);
}
export function composeIssue734Gas9294OwnerNavPreview(){
  const parent=composeIssue734Gas9293OrphanedClosePreview().source;
  assert.equal(blob(parent),PARENT_BLOB,'ISSUE734_9294_PARENT_DRIFT');
  // Proof-based selection only: exact date, current owner, time and phase.
  // A newer CLOSE summary and completed same-owner NAV are never replaced.
  const helper=[
    'function _issue734RecoveredCloseReservationOwner_(props, target, result) {',
    '  if (!result || String(result.date || "") !== target || !(Number(result.rows) > 0)) return null;',
    "  var runDate = String(props.getProperty('portfolio_close_run_date') || '');",
    "  var runId = String(props.getProperty('portfolio_close_run_id') || '');",
    "  var startedAt = String(props.getProperty('portfolio_close_run_started_at') || '');",
    "  var startedMs = Number(props.getProperty('portfolio_close_run_started_ms') || 0);",
    "  var stage = String(props.getProperty('portfolio_close_stage') || '');",
    '  var age = Date.now() - startedMs;',
    '  if (runDate !== target || !runId || !startedAt || !(startedMs > 0)',
    '      || !(age >= 15 * 60 * 1000 && age <= 7 * 86400000)',
    "      || ['PRICE','FUND','ERROR','FUND_PENDING'].indexOf(stage) < 0) return null;",
    "  var last = _portfolioFundState_(props,'portfolio_close_last_result');",
    '  if (last && last.runDate > target) return null;',
    '  if (last && last.runDate === target && last.runId === runId && last.fundOk === true) return null;',
    '  return {date:target,runId:runId,startedAt:startedAt,startedMs:startedMs,',
    '    priceOk:true,priceDate:target,priceRows:Number(result.rows),',
    '    krxCloseRequired:typeof result.krxCloseRequired === "boolean"',
    '      ?result.krxCloseRequired:null,',
    '    fundPending:true,errors:[]};',
    '}'
  ].join('\n');
  // The pre-replay prune normally clears a valid PRICE/Snapshot date.
  // That is unsafe when the exact CLOSE owner still awaits a NAV handoff.
  const pruneGuard=[
    'function _issue734PendingCloseOwnerRequiresNav_(props, date) {',
    "  if (String(props.getProperty('portfolio_close_run_date') || '') !== date) return false;",
    "  var runId = String(props.getProperty('portfolio_close_run_id') || '');",
    "  var stage = String(props.getProperty('portfolio_close_stage') || '');",
    "  var last = _portfolioFundState_(props,'portfolio_close_last_result');",
    '  return !(runId && stage === "COMPLETE" && last',
    '    && last.runDate === date && last.runId === runId',
    '    && last.priceOk === true && last.fundOk === true',
    '    && !(last.errors && last.errors.length));',
    '}'
  ].join('\n');
  let source=once(parent,'function _retryOnePendingKrxClose_(',
    helper+'\n'+pruneGuard+'\nfunction _retryOnePendingKrxClose_(','HELPER_INSERT');
  // Exact orphaned owner, even with 39 verified rows and an empty queue.
  const verifiedOrphanSeed="function _issue734SeedOrphanedCurrentClose_(ss, props, runDate) {\n  // A verified-but-orphaned Snapshot does not itself prove CLOSE COMPLETE.\n  var ownerDate = String(props.getProperty('portfolio_close_run_date') || '');\n  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(ownerDate) || ownerDate > runDate)\n    return {queued:false,reason:'NO_STALE_OWNER_DATE'};\n  if (_krxCalendarStatus_(ownerDate) !== 'OPEN')\n    return {queued:false,reason:'NON_KRX_SESSION'};\n  var stage = String(props.getProperty('portfolio_close_stage') || '');\n  if (['PRICE','FUND','ERROR','FUND_PENDING'].indexOf(stage) < 0)\n    return {queued:false,reason:'NOT_ORPHANED_PHASE'};\n  var startedMs = Number(props.getProperty('portfolio_close_run_started_ms') || 0);\n  var ageMs = Date.now() - startedMs;\n  if (!(startedMs > 0 && ageMs > 45 * 60 * 1000 && ageMs < 7 * 86400000))\n    return {queued:false,reason:'NOT_STALE'};\n  var runId = String(props.getProperty('portfolio_close_run_id') || '');\n  var startedAt = String(props.getProperty('portfolio_close_run_started_at') || '');\n  if (!runId || !startedAt) return {queued:false,reason:'OWNER_ID_UNVERIFIED'};\n  var last = _portfolioFundState_(props,'portfolio_close_last_result');\n  if (last && last.runDate > ownerDate)\n    return {queued:false,reason:'NEWER_SUMMARY'};\n  if (last && last.runDate === ownerDate && last.runId === runId\n      && last.priceOk === true && last.fundOk === true\n      && !(last.errors && last.errors.length))\n    return {queued:false,reason:'SAME_OWNER_ALREADY_COMPLETE'};\n  var stored = _readRawSnapshotRowsByDate(ss,ownerDate);\n  if (stored && stored.length) {\n    var verified = _verifyCompletedKrxPendingDate_(ss,ownerDate);\n    if (!verified || verified.ok !== true || !verified.snapshotProof\n        || !(Number(verified.snapshotProof.storedRowCount) > 0))\n      return {queued:false,reason:'PARTIAL_SNAPSHOT_PRESERVED'};\n  } else if (ownerDate !== runDate) {\n    return {queued:false,reason:'HISTORICAL_PRICE_ABSENT'};\n  }\n  if (!_hasKrxHoldingsForCloseDate_(ss,ownerDate,getCodeItems(ss)))\n    return {queued:false,reason:'NO_KRX_HOLDINGS'};\n  var queued = _enqueuePendingKrxCloseDate_(props,ownerDate,true,true);\n  return {queued:queued===true,reason:queued\n    ?(stored&&stored.length?'VERIFIED_SNAPSHOT_OWNER_QUEUED':'ORPHANED_DAY_QUEUED')\n    :'QUEUE_NOT_SAVED'};\n}";
  source=rewriteFunction(source,'function _issue734SeedOrphanedCurrentClose_(',
    ()=>verifiedOrphanSeed);
  source=rewriteFunction(source,'function _retryOnePendingKrxClose_(',block=>{
    block=once(block,
      "    var result = saveDailyPriceHistory(target, saveOptions);",
      "    var result = null;\n    if (String(props.getProperty('portfolio_close_run_date') || '') === target\n        && _krxCalendarStatus_(target) === 'OPEN') {\n      // Only the exact stale CLOSE owner can reuse a stored Snapshot.\n      // An unrelated queued date keeps the original backed-up writer.\n      result = _portfolioFundAtomic_(function(sharedProps) {\n        var candidate = _issue734RecoveredCloseReservationOwner_(\n          sharedProps,target,{date:target,rows:1,krxCloseRequired:true});\n        if (!candidate) return null;\n        var verified = _verifyCompletedKrxPendingDate_(getss(),target);\n        if (!verified || verified.ok !== true || !verified.snapshotProof)\n          return null;\n        var rows = Number(verified.snapshotProof.storedRowCount);\n        if (!(rows > 0) || rows !== Number(verified.snapshotProof.expectedRowCount))\n          return null;\n        return {ok:true,date:target,rows:rows,krxCloseRequired:true};\n      });\n    }\n    if (!result) result = saveDailyPriceHistory(target, saveOptions);",'VERIFIED_SNAPSHOT_FAST_PATH');
    block=once(block,
      '    _portfolioFundAtomic_(function(sharedProps) {\n      var ss = getss();',
      '    var recoveredOwner = null;\n    _portfolioFundAtomic_(function(sharedProps) {\n      var ss = getss();',
      'OWNER_DECLARATION');
    block=once(block,
      "      var policy = target === currentDate && includeToday ? 'CREATE' : 'CLEAN';\n"+
      "      if (!_reconcileRecoveredPortfolioPrice_(sharedProps, target, result, policy))\n"+
      "        throw new Error('BACKFILL_RECONCILIATION_FAILED');\n"+
      "      _completePendingKrxCloseDate_(sharedProps, target);",
      "      recoveredOwner = _issue734RecoveredCloseReservationOwner_(sharedProps,target,result);\n"+
      "      var policy = (target === currentDate && includeToday) || recoveredOwner ? 'CREATE' : 'CLEAN';\n"+
      "      if (!_reconcileRecoveredPortfolioPrice_(sharedProps, target, result, policy))\n"+
      "        throw new Error('BACKFILL_RECONCILIATION_FAILED');\n"+
      "      if (!recoveredOwner) _completePendingKrxCloseDate_(sharedProps, target);",
      'RECONCILE_POLICY');
    const reserve=[
      '    });',
      '    if (recoveredOwner) {',
      '      var reservation = null;',
      '      try { reservation = _scheduleFundAfterFailedPortfolioPrice_(recoveredOwner); }',
      '      catch (scheduleError) { throw new Error("BACKFILL_NAV_RESERVATION_UNVERIFIED"); }',
      '      if (!reservation || !reservation.triggerId)',
      '        throw new Error("BACKFILL_NAV_RESERVATION_UNVERIFIED");',
      '      _portfolioFundAtomic_(function(sharedProps) {',
      "        var last = _portfolioFundState_(sharedProps,'portfolio_close_last_result');",
      '        var rosterRoot = _portfolioFundState_(sharedProps,PORTFOLIO_FUND_SCHEDULE_KEY);',
      '        var roster = rosterRoot ? [rosterRoot].concat(rosterRoot.additional || []) : [];',
      "        var sameOwner = sharedProps.getProperty('portfolio_close_run_date') === target",
      "          && sharedProps.getProperty('portfolio_close_run_id') === recoveredOwner.runId;",
      '        var reserved = roster.some(function(entry) {',
      '          return entry && entry.date === target && entry.triggerId === reservation.triggerId',
      '            && entry.owner && entry.owner.runId === recoveredOwner.runId;',
      '        });',
      '        if (!sameOwner || !last || last.runDate !== target',
      '            || last.runId !== recoveredOwner.runId || last.priceOk !== true',
      '            || last.priceDate !== target || !reserved)',
      '          throw new Error("BACKFILL_NAV_OWNER_READBACK_UNVERIFIED");',
      '        _completePendingKrxCloseDate_(sharedProps, target);',
      '      });',
      '    }',
      "    _appendPortfolioCloseSyncLog('BACKFILL_OK', target,"
    ].join('\n');
    block=once(block,
      "    });\n    _appendPortfolioCloseSyncLog('BACKFILL_OK', target,",
      reserve,'NAV_RESERVATION_BEFORE_QUEUE_CLEAR');
    return block;
  });
  source=rewriteFunction(source,'function _pruneVerifiedHistoricalKrxPending_(',block=>{
    return once(block,
      '      try {\n        var proof=_verifyCompletedKrxPendingDate_(ss,date);',
      '      // Never prune an exact CLOSE owner while NAV reservation/finality is unverified.\n'+
      '      if (_issue734PendingCloseOwnerRequiresNav_(sharedProps,date)) return;\n'+
      '      try {\n        var proof=_verifyCompletedKrxPendingDate_(ss,date);',
      'PRUNE_NAV_OWNER_GUARD');
  });
  source=once(source,
    '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.293',
    '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.294','VERSION_BANNER');
  const count=source.split("gasVersion: '9.293'").length-1;
  assert(count>=5&&count<=24,'ISSUE734_9294_VERSION_COUNT_'+count);
  source=source.replaceAll("gasVersion: '9.293'","gasVersion: '9.294'");
  source=once(source,"var ISSUE507_GATE_API_VERSION='9.293'",
    "var ISSUE507_GATE_API_VERSION='9.294'",'GATE_VERSION');
  return {parent,source,manifest:{
    parentVersion:'9.293',candidateVersion:'9.294',
    parentGitBlob:PARENT_BLOB,candidateGitBlob:blob(source),
    changedFunctions:['_issue734RecoveredCloseReservationOwner_',
      '_issue734PendingCloseOwnerRequiresNav_',
      '_retryOnePendingKrxClose_','_pruneVerifiedHistoricalKrxPending_',
      '_issue734SeedOrphanedCurrentClose_'],noChangeToPriceWriter:true,
    verifiedSnapshotWithoutPriceReplay:true,seedsEmptyQueueOrphan:true,
    requiresExactDateOwner:true,queuedUntilReservationReadback:true,
    independentNavFinality:true,deployable:false,sourceOnly:true,
    manualReleaseRequired:true,financeWrites:0,gasDeployments:0
  }};
}
