// Postflight for the existing protected KB/Hanwha collector. READ ONLY.
// Distinguishes official publication, exact persisted NAV/derived rows, and
// the independent GAS closeRun state. Never logs NAV amounts, units, holdings,
// private response bodies, access tokens or raw exception text.
import {pathToFileURL} from 'node:url';
import {runBackfillStatus} from './diagnose-backfill-status.mjs';
import {runPublicSourceOnly} from './collect-kb-fund-nav.mjs';
import {summarizeFundRows} from './diagnose-fund-valuation-readonly.mjs';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {describeFundCloseCheckpoint} from './assess-krx-overnight-health.mjs';

const DAY=/^\d{4}-\d{2}-\d{2}$/;
const isDay=d=>typeof d==='string'&&DAY.test(d)&&
 Number.isFinite(Date.parse(d+'T00:00:00Z'))&&
 new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const shift=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
// GAS closeRun tracks calendar days, whereas KB AQ018 public official NAV
// can legitimately stop at Friday over the weekend. Require Friday (not
// arbitrary stale Thursday) unless a newer Saturday/Sunday NAV is ACTUALLY
// present in the independently fetched official source. Weekday close still
// requires that weekday's exact publication.
export function expectedKbOfficialReferenceDate(closeDate,rows=[]) {
 if(!isDay(closeDate)||!Array.isArray(rows))return null;
 const dow=new Date(closeDate+'T00:00:00Z').getUTCDay();
 if(dow!==0&&dow!==6)return closeDate;
 const friday=shift(closeDate,dow===6?-1:-2);
 return rows.filter(x=>isDay(x?.date)&&x.date>=friday&&x.date<=closeDate)
   .map(x=>x.date).sort().at(-1)||friday;
}
const kstToday=now=>new Intl.DateTimeFormat('en-CA',{
 timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'
}).format(now);

export function assessKbNavPostflight({close,officialRows,fundRow,today,officialNavMatched}) {
 if(!isDay(today)||!close||!isDay(close.runDate)||close.runDate>today
   ||!['COMPLETE','INCOMPLETE','ERROR','NEVER_RUN'].includes(close.state)
   ||typeof close.priceOk!=='boolean'||typeof close.fundOk!=='boolean'
   ||!Array.isArray(officialRows)||officialRows.length>35
   ||officialRows.some(x=>!x||!isDay(x.date)||x.date>=today
     ||!Number.isFinite(x.nav)||x.nav<=0)
   ||new Set(officialRows.map(x=>x.date)).size!==officialRows.length)
   throw Error('KB_POSTFLIGHT_SCHEMA_UNVERIFIED');
 const date=close.runDate,referenceDate=expectedKbOfficialReferenceDate(date,officialRows);
 const latestPublishedDate=officialRows.map(x=>x.date).sort().at(-1)||'-';
 const officiallyPublished=officialRows.some(x=>x.date===referenceDate);
 // Do not substitute a Saturday carried valuation for Friday's confirmed NAV.
 const storedNavConfirmed=fundRow?.date===referenceDate&&fundRow?.navState==='EXISTING_CONFIRMED';
 const derivedConfirmed=fundRow?.date===referenceDate
   &&fundRow?.valuationRequired===true&&fundRow?.unitsApplied===true
   &&fundRow?.reconciled===true
   &&['EXISTING_VALID','NOT_REQUIRED'].includes(fundRow?.evaluationState)
   &&['EXISTING_VALID','NOT_REQUIRED'].includes(fundRow?.snapshotState);
 // GAS's expectedRunDate is a MINIMUM acceptable session, not exact:
 // before 21:00 KST it can still point to yesterday even after today's
 // 19:00 close has legitimately completed. Reject an older stored run while
 // permitting a newer, verified one; the independent stale flags must agree.
 const closeDateVerified=close.runStale===false&&close.snapshotStale===false
   &&isDay(close.expectedRunDate)&&close.expectedRunDate<=date
   &&isDay(close.expectedSnapshotDate)&&close.expectedSnapshotDate<=date;
 const closeComplete=closeDateVerified&&close.state==='COMPLETE'
   &&close.priceOk===true&&close.fundOk===true;
 let verdict,pass;
 if(!closeDateVerified) {
   verdict='CLOSE_DATE_STALE_OR_UNVERIFIED';pass=false;
 } else if(!officiallyPublished) {
   // No NAV can be imported before official publication, but an unrelated
   // incomplete GAS close must still fail the job rather than appear green.
   verdict=closeComplete?'OFFICIAL_NAV_NOT_YET_PUBLISHED'
     :'OFFICIAL_NAV_NOT_YET_PUBLISHED_CLOSE_INCOMPLETE';
   pass=closeComplete;
 } else if(!fundRow||!storedNavConfirmed) {
   verdict='OFFICIAL_NAV_NOT_IMPORTED';pass=false;
 } else if(officialNavMatched!==true) {
   // A self-consistent NAV/price/snapshot set is NOT proof of the exact
   // externally published class NAV. Confirm the value via GAS preview only.
   verdict='OFFICIAL_NAV_VALUE_MISMATCH_OR_UNVERIFIED';pass=false;
 } else if(!derivedConfirmed) {
   verdict='PUBLISHED_NAV_DERIVED_UNVERIFIED';pass=false;
 } else if(!closeComplete) {
   verdict='NAV_VERIFIED_CLOSE_INCOMPLETE';pass=false;
 } else {
   verdict='NAV_AND_CLOSE_VERIFIED';pass=true;
 }
 // The NAV collection job must not fail merely because its independent
 // GAS CLOSE is incomplete. Preserve 'pass' as the stricter full
 // NAV-and-CLOSE finality verdict for reporting; this separate result
 // verifies only the published source vs exact persisted NAV and valuation.
 // It never modifies CLOSE, retries a writer, or invents a publication.
 const navVerified=officiallyPublished&&latestPublishedDate===referenceDate
   &&storedNavConfirmed&&officialNavMatched===true&&derivedConfirmed;
 const publicationLagDays=latestPublishedDate==='-'?Infinity
   :(Date.parse(referenceDate+'T00:00:00Z')
     -Date.parse(latestPublishedDate+'T00:00:00Z'))/86400000;
 const navAwaitingPublication=!officiallyPublished&&officialRows.length>0
   &&publicationLagDays>0&&publicationLagDays<=7;
 const navWorkflowStatus=navVerified?'NAV_DATA_VERIFIED'
   :navAwaitingPublication?'OFFICIAL_NAV_AWAITING_PUBLICATION'
   :'NAV_INTEGRITY_UNVERIFIED';
 const navWorkflowPass=navVerified||navAwaitingPublication;
 return {kind:'KB_NAV_CLOSE_POSTFLIGHT_READ_ONLY',asOfKst:today,
   closeDate:date,officialReferenceDate:referenceDate,latestPublishedDate,officiallyPublished,
   storedNavConfirmed,derivedConfirmed,officialNavMatched:officialNavMatched===true,
   closeState:close.state,
   expectedRunDate:close.expectedRunDate||'-',
   expectedSnapshotDate:close.expectedSnapshotDate||'-',
   runStale:close.runStale,snapshotStale:close.snapshotStale,
   closeDateVerified,priceOk:close.priceOk,fundOk:close.fundOk,closeComplete,
   verdict,pass,navWorkflowStatus,navWorkflowPass,
   financialWrites:0,gasDeployments:0,telegramSends:0};
}

export async function readKbValuation({url,token,from,to,fetchImpl=fetch}) {
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||!token.trim()||!isDay(from)||!isDay(to)||from>to)
   throw Error('KB_POSTFLIGHT_CONFIG');
 let response;
 try{
   response=await fetchImpl(endpoint,{method:'POST',redirect:'follow',
     headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
     body:new URLSearchParams({action:'getFundValuationStatus',from,to,
       code:'F00002',accessToken:token}),signal:AbortSignal.timeout(90000)});
 }catch{throw Error('KB_POSTFLIGHT_GAS_NETWORK_UNVERIFIED');}
 if(!response?.ok)throw Error('KB_POSTFLIGHT_GAS_HTTP_UNVERIFIED');
 try{return await response.json();}
 catch{throw Error('KB_POSTFLIGHT_GAS_JSON_UNVERIFIED');}
}


// The audited source can be published after the private collector finishes.
// A stored NAV + matching derived amount is only internally consistent; this
// exact-value GAS preview independently compares it with the public class NAV.
// Preview is read-only. No NAV values/response bodies are written to logs.
export function verifyKbOfficialNavPreview(date,nav,payload) {
 return isDay(date)&&Number.isFinite(nav)&&nav>0
   &&payload?.status==='ok'&&payload.code==='F00002'
   &&['candidates','updates','warnings','errors','duplicates','zeroUnits']
     .every(key=>Array.isArray(payload[key])&&payload[key].length===0)
   &&Array.isArray(payload.identical)&&payload.identical.length===1
   &&payload.identical[0]?.date===date
   &&Number(payload.identical[0].existingNav)===nav
   &&Number(payload.identical[0].uploadedNav)===nav;
}
export async function readKbExactNavPreview({url,token,date,nav,fetchImpl=fetch}) {
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||!token.trim()||!isDay(date)
   ||!Number.isFinite(nav)||nav<=0)throw Error('KB_POSTFLIGHT_PREVIEW_CONFIG');
 const input={code:'F00002',provider:'KB_VALUE_ST',classCode:'AQ018',
   appendOnly:true,ackWarnings:true,
   sourceText:'KR5223AQ0185 AQ018 S-T OFFICIAL_READ_ONLY',
   rows:[{date,nav}]};
 let response;
 try{
   response=await fetchImpl(endpoint,{method:'POST',redirect:'follow',
     headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
     body:new URLSearchParams({action:'previewFundNavImport',
       data:JSON.stringify(input),accessToken:token}),
     signal:AbortSignal.timeout(90000)});
 }catch{throw Error('KB_POSTFLIGHT_PREVIEW_NETWORK_UNVERIFIED');}
 if(!response?.ok)throw Error('KB_POSTFLIGHT_PREVIEW_HTTP_UNVERIFIED');
 try{return await response.json();}
 catch{throw Error('KB_POSTFLIGHT_PREVIEW_JSON_UNVERIFIED');}
}

export async function auditKbNavPostflight({url,token,now=new Date(),
 statusReader=runBackfillStatus,sourceReader=runPublicSourceOnly,
 valuationReader=readKbValuation,previewReader=readKbExactNavPreview,
 fetchImpl=fetch}={}) {
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))
   throw Error('KB_POSTFLIGHT_CLOCK');
 const today=kstToday(now),from=shift(today,-6);
 const status=await statusReader({url,token,fetchImpl});
 const close=status?.close;
 if(!close||!isDay(close.runDate)||close.runDate<from||close.runDate>today)
   throw Error('KB_POSTFLIGHT_CLOSE_DATE_UNVERIFIED');
 const source=await sourceReader({now,fetchImpl});
 if(source?.writerInvoked!==false||!Array.isArray(source.rows))
   throw Error('KB_POSTFLIGHT_SOURCE_UNVERIFIED');
 const proof=await valuationReader({url,token,from,to:today,fetchImpl});
 // Reuse the existing date-scoped, read-only GAS response validator.
 summarizeFundRows(proof,'F00002',from,today);
 const referenceDate=expectedKbOfficialReferenceDate(close.runDate,source.rows);
 if(!isDay(referenceDate))throw Error('KB_POSTFLIGHT_REFERENCE_DATE_UNVERIFIED');
 const matching=proof.fundResults.F00002.dates.filter(x=>x.date===referenceDate);
 if(matching.length>1)throw Error('KB_POSTFLIGHT_DUPLICATE_DATE');
 const official=source.rows.find(x=>x.date===referenceDate);
 const officialNavMatched=official?verifyKbOfficialNavPreview(referenceDate,
   official.nav,await previewReader({url,token,date:referenceDate,
     nav:official.nav,fetchImpl})):false;
 // Expose only allow-listed GAS checkpoint enums. This is persisted runtime
 // evidence, not independent Apps Script Executions / successful close proof.
 return {...assessKbNavPostflight({close,officialRows:source.rows,
   fundRow:matching[0]||null,today,officialNavMatched}),
   fundCloseCheckpointEvidence:describeFundCloseCheckpoint(status)};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 try{
   const result=await auditKbNavPostflight({
     url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN});
   console.log(JSON.stringify(result));
   if(process.env.GITHUB_STEP_SUMMARY) {
     const {appendFileSync}=await import('node:fs');
     appendFileSync(process.env.GITHUB_STEP_SUMMARY,
       'KB NAV postflight: **'+result.verdict+'**'
       +' · published='+result.officiallyPublished
       +' · NAV='+result.storedNavConfirmed
       +' · exactOfficialNAV='+result.officialNavMatched
       +' · derived='+result.derivedConfirmed
       +' · NAV-only='+result.navWorkflowStatus
       +' · close='+result.closeState
       +' · stage='+result.fundCloseCheckpointEvidence.closeStage
       +' · fundAttempt='+result.fundCloseCheckpointEvidence.fundAttemptState
       +' · fundFailure='+result.fundCloseCheckpointEvidence.fundFailureClass
       +' · lastFundWork='+result.fundCloseCheckpointEvidence.fundWorkStage+'\n');
   }
   // Close finality remains separately INCOMPLETE and visible in the
   // postflight verdict. Only NAV integrity/unpublished status determines
   // whether this optional audit fails the NAV collector workflow.
   if(!result.navWorkflowPass)process.exitCode=1;
 }catch(error){
   const code=String(error?.message||'');
   console.error(/^KB_POSTFLIGHT_[A-Z_]+$/.test(code)
     ?code:'KB_POSTFLIGHT_UNVERIFIED');
   process.exitCode=1;
 }
}
