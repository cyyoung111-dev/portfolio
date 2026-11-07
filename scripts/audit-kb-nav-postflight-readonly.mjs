// Postflight for the existing protected KB/Hanwha collector. READ ONLY.
// Distinguishes official publication, exact persisted NAV/derived rows, and
// the independent GAS closeRun state. Never logs NAV amounts, units, holdings,
// private response bodies, access tokens or raw exception text.
import {pathToFileURL} from 'node:url';
import {runBackfillStatus} from './diagnose-backfill-status.mjs';
import {runPublicSourceOnly} from './collect-kb-fund-nav.mjs';
import {summarizeFundRows} from './diagnose-fund-valuation-readonly.mjs';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

const DAY=/^\d{4}-\d{2}-\d{2}$/;
const isDay=d=>typeof d==='string'&&DAY.test(d)&&
 Number.isFinite(Date.parse(d+'T00:00:00Z'))&&
 new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const shift=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const kstToday=now=>new Intl.DateTimeFormat('en-CA',{
 timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'
}).format(now);

export function assessKbNavPostflight({close,officialRows,fundRow,today}) {
 if(!isDay(today)||!close||!isDay(close.runDate)||close.runDate>today
   ||!['COMPLETE','INCOMPLETE','ERROR','NEVER_RUN'].includes(close.state)
   ||typeof close.priceOk!=='boolean'||typeof close.fundOk!=='boolean'
   ||!Array.isArray(officialRows)||officialRows.length>35
   ||officialRows.some(x=>!x||!isDay(x.date)||x.date>=today)
   ||new Set(officialRows.map(x=>x.date)).size!==officialRows.length)
   throw Error('KB_POSTFLIGHT_SCHEMA_UNVERIFIED');
 const date=close.runDate,latestPublishedDate=officialRows.map(x=>x.date).sort().at(-1)||'-';
 const officiallyPublished=officialRows.some(x=>x.date===date);
 const storedNavConfirmed=fundRow?.navState==='EXISTING_CONFIRMED';
 const derivedConfirmed=fundRow?.valuationRequired===true&&fundRow?.unitsApplied===true
   &&fundRow?.reconciled===true
   &&['EXISTING_VALID','NOT_REQUIRED'].includes(fundRow?.evaluationState)
   &&['EXISTING_VALID','NOT_REQUIRED'].includes(fundRow?.snapshotState);
 const closeComplete=close.state==='COMPLETE'&&close.priceOk===true&&close.fundOk===true;
 let verdict,pass;
 if(!officiallyPublished) {
   // Do not pretend an as-yet unpublished NAV should have been imported.
   // The close may still be pending; report that separately.
   verdict='OFFICIAL_NAV_NOT_YET_PUBLISHED';pass=true;
 } else if(!fundRow||!storedNavConfirmed) {
   verdict='OFFICIAL_NAV_NOT_IMPORTED';pass=false;
 } else if(!derivedConfirmed) {
   verdict='PUBLISHED_NAV_DERIVED_UNVERIFIED';pass=false;
 } else if(!closeComplete) {
   verdict='NAV_VERIFIED_CLOSE_INCOMPLETE';pass=false;
 } else {
   verdict='NAV_AND_CLOSE_VERIFIED';pass=true;
 }
 return {kind:'KB_NAV_CLOSE_POSTFLIGHT_READ_ONLY',asOfKst:today,
   closeDate:date,latestPublishedDate,officiallyPublished,
   storedNavConfirmed,derivedConfirmed,closeState:close.state,
   priceOk:close.priceOk,fundOk:close.fundOk,closeComplete,
   verdict,pass,financialWrites:0,gasDeployments:0,telegramSends:0};
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

export async function auditKbNavPostflight({url,token,now=new Date(),
 statusReader=runBackfillStatus,sourceReader=runPublicSourceOnly,
 valuationReader=readKbValuation,fetchImpl=fetch}={}) {
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
 const matching=proof.fundResults.F00002.dates.filter(x=>x.date===close.runDate);
 if(matching.length>1)throw Error('KB_POSTFLIGHT_DUPLICATE_DATE');
 return assessKbNavPostflight({close,officialRows:source.rows,
   fundRow:matching[0]||null,today});
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
       +' · derived='+result.derivedConfirmed
       +' · close='+result.closeState+'\n');
   }
   if(!result.pass)process.exitCode=1;
 }catch(error){
   const code=String(error?.message||'');
   console.error(/^KB_POSTFLIGHT_[A-Z_]+$/.test(code)
     ?code:'KB_POSTFLIGHT_UNVERIFIED');
   process.exitCode=1;
 }
}
