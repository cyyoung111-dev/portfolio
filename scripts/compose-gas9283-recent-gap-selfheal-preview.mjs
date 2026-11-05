// Source-only preview: detect a recent missing internal trading day even
// when snapshot_last_success_date has already advanced to a newer date.
import {gasSourceBlobSha} from './deploy-gas.mjs';
import {composeGas9283SnapshotReadEfficiencyPreview} from './compose-gas9283-snapshot-read-efficiency-preview.mjs';

const target='_runPendingKrxBackfillWithLease_';
const anchor='        _seedMissingKrxCloseDates_(ss, sharedProps, runDate, getCodeItems(ss));';
const added='        _seedRecentMissingKrxSnapshotDays_(ss, sharedProps, runDate);';
const helper=`function _seedRecentMissingKrxSnapshotDays_(ss, props, runDate) {
  // Backfill worker only. A pending queue already has work and must not be
  // expanded while the worker is trying to clear an older verified date.
  if (_readPendingKrxCloseDates_(props).length) return {checked:false,reason:'PENDING_EXISTS'};
  var lastChecked=String(props.getProperty('portfolio_recent_gap_scan_date_v1')||'');
  if (lastChecked===runDate) return {checked:false,reason:'ALREADY_SCANNED'};
  var sh=ss.getSheetByName(CONFIG.SHEET_SNAPSHOT);
  if (!sh || sh.getLastRow()<2) return {checked:false,reason:'NO_HISTORY'};
  // Date column only: no valuation, trade, or fund data read into this scan.
  // A 7-calendar-day bound prevents historical onboarding from generating
  // an open-ended replay queue. A row of any kind is enough to exclude a day
  // from this *missing-day* scan; partial rows are handled by integrity checks.
  var lastRow=sh.getLastRow(), lookbackStart=_fundDateOffset(runDate,-7);
  var rowCount=Math.min(1000,lastRow-1);
  var first=lastRow-rowCount+1;
  var sample=sh.getRange(first,1,rowCount,1).getValues(),present={};
  sample.forEach(function(row) {
    var d=_normalizeDate(row[0]);
    if(d>=lookbackStart&&d<runDate) present[d]=true;
  });
  var items=getCodeItems(ss), candidates=[];
  for(var d=lookbackStart;d<runDate;d=_fundDateOffset(d,1)) {
    if(_krxCalendarStatus_(d)!=='OPEN'||present[d]) continue;
    if(!_hasKrxHoldingsForCloseDate_(ss,d,items)) continue;
    candidates.push(d);
  }
  if(candidates.length) {
    // If Snapshot rows were appended nonchronologically, the tail alone is
    // not a proof of absence. Confirm candidates against the *entire* date
    // column once, then queue only dates still fully absent.
    var all=sh.getRange(2,1,lastRow-1,1).getValues(),allDates={};
    all.forEach(function(row) { var d=_normalizeDate(row[0]);if(d)allDates[d]=true; });
    candidates=candidates.filter(function(d) {return !allDates[d];});
  }
  var queued=[];
  candidates.forEach(function(d) {
    if(_enqueuePendingKrxCloseDate_(props,d)) queued.push(d);
  });
  props.setProperty('portfolio_recent_gap_scan_date_v1',runDate);
  return {checked:true,candidateCount:candidates.length,queuedCount:queued.length};
}
`;
function extract(source,name){
 const marker='function '+name+'(';
 const begin=source.indexOf(marker),end=source.indexOf(String.fromCharCode(10)+'}',begin);
 if(begin<0||end<=begin||source.indexOf(marker,begin+marker.length)>=0)
   throw Error('GAP_FUNCTION_DRIFT:'+name);
 return source.slice(begin,end+2);
}
export function composeGas9283RecentGapSelfHealPreview(){
 const previous=composeGas9283SnapshotReadEfficiencyPreview();
 const original=previous.candidate;
 if(original.includes('function _seedRecentMissingKrxSnapshotDays_('))throw Error('GAP_ALREADY_PRESENT');
 const before=extract(original,target);
 if(before.split(anchor).length!==2)throw Error('GAP_HOOK_DRIFT');
 const after=before.replace(anchor,anchor+String.fromCharCode(10)+added);
 const candidate=original.replace(before,after)+String.fromCharCode(10)+helper;
 return {candidate,baseCandidate:original,manifest:{
   status:'SOURCE_PREVIEW_NOT_DEPLOYABLE',proposedVersion:'9.283',
   baseBlob:gasSourceBlobSha(original),candidateBlob:gasSourceBlobSha(candidate),
   functionsChanged:[target],functionsAdded:['_seedRecentMissingKrxSnapshotDays_'],
   recentCalendarDays:7,maxTailRows:1000,oneFullDateScanOnlyWhenNeeded:true,
   financialSheetWrite:false,productionGasChanged:false,
   releaseAllowlistApproved:false,deploymentApproved:false
 }};
}
