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
  let source=once(parent,'function _retryOnePendingKrxClose_(',
    helper+'\nfunction _retryOnePendingKrxClose_(','HELPER');
  source=rewriteFunction(source,'function _retryOnePendingKrxClose_(',block=>{
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
      '_retryOnePendingKrxClose_'],noChangeToPriceWriter:true,
    requiresExactDateOwner:true,queuedUntilReservationReadback:true,
    independentNavFinality:true,deployable:false,sourceOnly:true,
    manualReleaseRequired:true,financeWrites:0,gasDeployments:0
  }};
}
