// #860: SOURCE-ONLY watchdog recovery from persisted PRICE data after a
// Google Apps Script hard timeout. Never marks CLOSE or NAV COMPLETE on a
// date match and NEVER replays already persisted prices/snapshots.
// Intended for a separately reviewed next GAS version, not current v9.290.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {composeIssue860Gas9290Preview} from './compose-issue860-gas9290-preview.mjs';

const PARENT_SHA='fa12c26b6b6d5f85d6d0e9f17d650a8824d0316c';
const hash=s=>{const b=Buffer.from(s,'utf8');
 return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
function once(s,a,b,label){
 assert.equal(s.split(a).length,2,'ISSUE860_STORED_PRICE_ANCHOR:'+label);
 return s.replace(a,b);
}
function editFunction(s,name,edit){
 const i=s.indexOf('function '+name+'('),j=s.indexOf('\n}',i);
 assert(i>=0&&j>i,'ISSUE860_STORED_PRICE_FUNCTION_MISSING:'+name);
 const before=s.slice(i,j+2),after=edit(before);
 assert.notEqual(before,after,'ISSUE860_STORED_PRICE_UNCHANGED:'+name);
 return s.slice(0,i)+after+s.slice(j+2);
}
export function composeIssue860StoredPriceWatchdogPreview(){
 const old=composeIssue860Gas9290Preview();
 assert.equal(old.manifest.candidateSourceGitBlob,PARENT_SHA);
 assert.equal(hash(old.candidate),PARENT_SHA);
 let s=old.candidate;
 // Only strict single-owner recovery calls may create an async NAV
 // reservation from read-only proof. Historical callers are unchanged.
 s=editFunction(s,'_scheduleFundAfterFailedPortfolioPrice_',f=>
  once(f, '  return _portfolioFundAtomic_(function(props) {',
    [
     '  return _portfolioFundAtomic_(function(props) {',
     '    if(owner && owner.issue860VerifiedPriceRecovery === true) {',
     '      var expectedId = String(owner.runId || "");',
     '      var actualId = String(props.getProperty("portfolio_close_run_id") || "");',
     '      var actualDate = String(props.getProperty("portfolio_close_run_date") || "");',
     '      var actualStarted = Number(props.getProperty("portfolio_close_run_started_ms") || 0);',
     '      var actualStage = String(props.getProperty("portfolio_close_stage") || "");',
     '      if(!expectedId || actualId !== expectedId || actualDate !== owner.date',
     '        || !actualStarted || actualStarted !== Number(owner.startedMs)',
     '        || actualStage !== "PRICE")',
     '        throw new Error("ISSUE860_STORED_PRICE_OWNER_CHANGED");',
     '    }'
    ].join('\n'),'STRICT_OWNER'));
 const helper=`
function _issue860RecoverStoredPriceWatchdog_() {
  // A timed-out PRICE execution cannot reach catch/finally. Its actual
  // financial rows may nonetheless already be committed. Validate them
  // without any PRICE/NAV/Sheet replay, then reserve NAV under the SAME owner.
  var props=PropertiesService.getScriptProperties(),date=today();
  var runDate=String(props.getProperty('portfolio_close_run_date')||'');
  var stage=String(props.getProperty('portfolio_close_stage')||'');
  var runId=String(props.getProperty('portfolio_close_run_id')||'');
  var startedMs=Number(props.getProperty('portfolio_close_run_started_ms')||0);
  var age=Date.now()-startedMs;
  if(stage!=='PRICE'||runDate!==date||!runId||!startedMs||age<0)
    return null;
  if(age<15*60*1000)return {skipped:true,
    reason:'PRICE_OWNER_STILL_WITHIN_LEASE',runDate:date};
  var revision='';
  try{revision=_peekSnapshotIntegritySourceRevisionReadonly_();}
  catch(e){return {skipped:true,runDate:date,
    reason:'STORED_PRICE_REVISION_UNVERIFIED'};}
  var audit;
  try{audit=diagnoseSnapshotIntegrity(getss(),date);}
  catch(e){return {skipped:true,runDate:date,
    reason:'STORED_PRICE_AUDIT_UNVERIFIED'};}
  if(audit.status!=='VALID'||!(audit.storedRowCount>0)||
    audit.storedRowCount!==audit.expectedRowCount||
    (audit.duplicateKeys||[]).length||
    (audit.sourceDataErrors||[]).length||
    (audit.priceIntegrity||[]).some(function(row) {
      return ['VALID','MANUAL_PROTECTED'].indexOf(row.status) < 0;
    }))
    return audit.storedRowCount>0
      ?{skipped:true,runDate:date,reason:'STORED_PRICE_PRESENT_BUT_NOT_VALID'}
      :null; // Missing physical PRICE is eligible for the existing retry.
  var afterRevision='';
  try{afterRevision=_peekSnapshotIntegritySourceRevisionReadonly_();}
  catch(e){return {skipped:true,runDate:date,reason:'STORED_PRICE_REVISION_UNVERIFIED'};}
  if(afterRevision!==revision)
    return {skipped:true,runDate:date,reason:'STORED_PRICE_REVISION_CHANGED'};
  var reservation;
  try {
    reservation=_scheduleFundAfterFailedPortfolioPrice_({
      date:date,runId:runId,startedAt:String(props.getProperty('portfolio_close_run_started_at')||''),
      startedMs:startedMs,priceOk:true,priceDate:date,
      priceRows:audit.storedRowCount,fundPending:true,errors:[],
      issue860VerifiedPriceRecovery:true
    });
  } catch(e) {
    return {skipped:true,runDate:date,reason:'STORED_PRICE_OWNER_OR_LEASE_CHANGED'};
  }
  if(!reservation||!reservation.triggerId)
    return {skipped:true,runDate:date,reason:'STORED_PRICE_NAV_RESERVATION_MISSING'};
  return {runDate:date,priceOk:true,fundOk:false,fundPending:true,
    priceEvidence:'RAW_SNAPSHOT_VERIFIED',
    navReservationCreated:reservation.created===true,
    closeMarkedComplete:false,priceRows:audit.storedRowCount};
}
`;
 s=once(s,'function runPortfolioCloseWatchdog2030() {',
   helper+'\nfunction runPortfolioCloseWatchdog2030() {','INSERT_FUNCTION');
 s=editFunction(s,'runPortfolioCloseWatchdog2030',f=>
   once(f, '  var todayStr = today();',
     [
      '  var priceRecovery=_issue860RecoverStoredPriceWatchdog_();',
      '  if(priceRecovery)return priceRecovery;',
      '  var todayStr = today();'
     ].join('\n'),'WATCHDOG_FASTPATH'));
 return {source:s,parent:old.candidate,manifest:{
  parentVersion:'9.290',sourceOnly:true,
  parentGitBlob:PARENT_SHA,sourceGitBlob:hash(s),
  changes:['_scheduleFundAfterFailedPortfolioPrice_','runPortfolioCloseWatchdog2030',
   '_issue860RecoverStoredPriceWatchdog_'],
  rawSnapshotRecomputed:true,sourceRevisionGuard:true,
  strictOwnerGuard:true,priorPriceWriterReplayed:false,
  fundPendingNotComplete:true,deployable:false,financeWrites:0,
  gasDeployments:0
 }};
}
