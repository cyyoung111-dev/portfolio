// #734: PREVIEW ONLY. Never publish this 9.293 candidate by a push or
// by reusing the pinned 9.292 deployment workflow.
// A hard-killed 19:00/20:30 PRICE run can leave Snapshot absent and the
// 22:10 worker's historical-only seeding cannot discover TODAY.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {composeIssue860Gas9292CloseStatePreview} from './compose-issue860-gas9292-close-state-preview.mjs';

const PARENT_BLOB='a1fc71cd26616be250b4e07cceacbc73995be98e';
const blob=s=>{
 const bytes=Buffer.from(s,'utf8');
 return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
};
function once(source,before,after,label){
 assert.equal(source.split(before).length,2,'ISSUE734_9293_SOURCE_DRIFT_'+label);
 return source.replace(before,after);
}

export function composeIssue734Gas9293OrphanedClosePreview(){
 const parent=composeIssue860Gas9292CloseStatePreview().source;
 assert.equal(blob(parent),PARENT_BLOB,'ISSUE734_9293_PARENT_DRIFT');
 let source=parent;
 const target='function _runPendingKrxBackfillWithLease_(';
 const helper=`
function _issue734SeedOrphanedCurrentClose_(ss, props, runDate) {
  // Only the already leased 22:10 worker calls this under ScriptLock.
  // A live 19:00 execution must never be stolen or treated as completed.
  if (_krxCalendarStatus_(runDate) !== 'OPEN')
    return { queued:false, reason:'NON_KRX_SESSION' };
  if (_normalizeDate(props.getProperty('portfolio_close_run_date') || '') !== runDate)
    return { queued:false, reason:'NO_SAME_DAY_OWNER' };
  var stage = String(props.getProperty('portfolio_close_stage') || '');
  if (stage !== 'PRICE' && stage !== 'FUND')
    return { queued:false, reason:'NOT_ORPHANED_PHASE' };
  var startedMs = Number(props.getProperty('portfolio_close_run_started_ms') || 0);
  var ageMs = Date.now() - startedMs;
  // Exceed the published Gate's 45-minute expiration before seeding; this is
  // queue admission, not an assertion of producer completion.
  if (!(startedMs > 0 && ageMs > 45 * 60 * 1000 && ageMs < 24 * 60 * 60 * 1000))
    return { queued:false, reason:'NOT_STALE' };
  // Never overwrite a partially stored day (including manual rows) via this
  // emergency path; normal date-scoped integrity review must resolve it.
  if (_readRawSnapshotRowsByDate(ss, runDate).length)
    return { queued:false, reason:'SNAPSHOT_PRESENT_OR_PARTIAL' };
  var catalog = getCodeItems(ss);
  if (!_hasKrxHoldingsForCloseDate_(ss, runDate, catalog))
    return { queued:false, reason:'NO_KRX_HOLDINGS' };
  // Only enqueue: saveDailyPriceHistory() must subsequently re-fetch exact
  // official closes, independently build 39 rows, backup, CAS-verify and
  // fail closed on mismatches. No success or NAV marker is fabricated here.
  var saved = _enqueuePendingKrxCloseDate_(props, runDate, true, true);
  return { queued:saved === true, reason:saved ? 'ORPHANED_DAY_QUEUED':'QUEUE_NOT_SAVED' };
}
`;
 source=once(source,target,helper+'\n'+target,'HELPER_INSERT');
 source=once(source,
  '        _seedRecentMissingKrxSnapshotDays_(ss, sharedProps, runDate);',
  '        _seedRecentMissingKrxSnapshotDays_(ss, sharedProps, runDate);\n' +
  '        _issue734SeedOrphanedCurrentClose_(ss, sharedProps, runDate);',
  'LEASED_CURRENT_DAY_ADMISSION');
 source=once(source,
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.292',
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.293',
  'VERSION_BANNER');
 const versions=source.split("gasVersion: '9.292'").length-1;
 assert(versions>=5&&versions<=20,'ISSUE734_9293_VERSION_COUNT_'+versions);
 source=source.replaceAll("gasVersion: '9.292'","gasVersion: '9.293'");
 source=once(source,"var ISSUE507_GATE_API_VERSION='9.292'",
  "var ISSUE507_GATE_API_VERSION='9.293'",'GATE_API_VERSION');
 return {parent,source,manifest:{
  parentVersion:'9.292',candidateVersion:'9.293',parentGitBlob:PARENT_BLOB,
  candidateGitBlob:blob(source),changedFunctions:[
   '_issue734SeedOrphanedCurrentClose_','_runPendingKrxBackfillWithLease_'],
  addsOnlyCurrentDayQueueSeed:true,requiresLeasedWorker:true,
  requiresOlderThan45Minutes:true,partialSnapshotAutoRebuild:false,
  preservesFinancialWriterBody:true,deployable:false,sourceOnly:true,
  financeWrites:0,gasDeployments:0,manualReleaseRequired:true
 }};
}
