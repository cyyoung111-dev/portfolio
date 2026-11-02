// ONE-DAY READ-ONLY AUDIT: does not send Telegram, write GAS, refresh OAuth,
// alter portfolio data, or create a new morning delivery claim.
// Run only via its dedicated one-off workflow and only on 2026-11-02 KST.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {krxSessionStatus} from './krx-session-calendar.mjs';
import {MORNING_SERIES,collectMorningSeries,hasExpectedMorningDate,expectedMorningDate}
 from './telegram-morning-report.mjs';
import {fetchDatedDaily,loadMorningDomesticDailyIndexes}
 from './telegram-morning-briefing.mjs';
import {NH_ONLY_INDEX_SYMBOLS,loadMorningMaster,mergeMorningSourceRows}
 from './telegram-morning-master.mjs';
import {readNhMorningIndexes} from './nh-morning-index-source.mjs';
import {readNhStoredMorningStocks} from './nh-morning-stock-history.mjs';
import {loadCapturedNight} from './nh-capture-artifact.mjs';

export const TEST_DATE='2026-11-02';
export const TEST_REPO='cyyoung111-dev/portfolio';
export const morningAsOf=new Date(TEST_DATE+'T07:40:00+09:00');
export function auditWindow(instant){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(instant).map(v=>[v.type,v.value]));
 const date=parts.year+'-'+parts.month+'-'+parts.day,
   m=Number(parts.hour)*60+Number(parts.minute);
 return {date,allowed:date===TEST_DATE&&m>=900&&m<1005};
}
export function summarizeMorningAudit(rows=[],reference=null){
 const seen=[];
 for(const item of MORNING_SERIES){
  const valid=rows.filter(row=>hasExpectedMorningDate(item,TEST_DATE,row,morningAsOf)
    &&(item.id!=='UST10Y'||(row.value>0&&row.value<20)));
  if(valid.length===1)seen.push({id:item.id,
    expectedDate:expectedMorningDate(item.id,TEST_DATE,morningAsOf),
    source:valid[0].source,status:'VERIFIED'});
  else seen.push({id:item.id,
    expectedDate:expectedMorningDate(item.id,TEST_DATE,morningAsOf),
    status:valid.length>1?'DUPLICATE':'NO_VERIFIED_ROW'});
 }
 const accepted=seen.filter(x=>x.status==='VERIFIED');
 const validNight=reference?.source==='NH'&&reference.tradingDate===TEST_DATE
   &&reference.kind==='REFERENCE'&&reference.officialClose===false
   &&reference.sourceUpdatedAt===TEST_DATE+'T06:00:00+09:00'
   &&Number.isFinite(reference.value)&&reference.value>0
   &&Number.isFinite(Date.parse(reference.receivedAt))
   &&Date.parse(reference.receivedAt)<=morningAsOf.getTime();
 return {schemaVersion:1,reportDate:TEST_DATE,asOfKst:'07:40',sourceAuditType:'POST_HOC_READ_ONLY',
  // Retesting at 15:00 does NOT establish data availability at 07:40.
  temporalAvailabilityVerified:false,verified:accepted.length,total:MORNING_SERIES.length,
  missing:seen.filter(x=>x.status!=='VERIFIED').map(x=>({id:x.id,expectedDate:x.expectedDate,reason:x.status})),
  verifiedDetails:accepted,nhNightReference:validNight?'VERIFIED':'NOT_VERIFIED'};
}
export async function collectTodayMorningAudit({now=()=>new Date(),fetchImpl=fetch,
  gasUrl=process.env.GAS_WEB_APP_URL,gasToken=process.env.GAS_ACCESS_TOKEN,
  githubToken=process.env.GITHUB_TOKEN,repository=process.env.GITHUB_REPOSITORY}={}){
 const first=auditWindow(now());
 if(!first.allowed)return {status:'OUTSIDE_ONE_DAY_AUDIT_WINDOW',date:first.date};
 if(krxSessionStatus(TEST_DATE)!=='OPEN')return {status:'MARKET_CLOSED'};
 const [master,nh,domestic,stocks,night]=await Promise.all([
  loadMorningMaster(TEST_DATE,{url:gasUrl,token:gasToken,fetchImpl,now:morningAsOf}).catch(()=>[]),
  readNhMorningIndexes(TEST_DATE,{url:gasUrl,token:gasToken,fetchImpl}).catch(()=>[]),
  loadMorningDomesticDailyIndexes(TEST_DATE,{fetchImpl,now:()=>morningAsOf}).catch(()=>[]),
  readNhStoredMorningStocks(TEST_DATE,{url:gasUrl,token:gasToken,fetchImpl}).catch(()=>[]),
  loadCapturedNight(TEST_DATE,{token:githubToken,repository,fetchImpl,now:()=>morningAsOf}).catch(()=>null)
 ]);
 const skipped=new Set([...NH_ONLY_INDEX_SYMBOLS,'^KS11','^KQ11','^KS200',
  ...nh.map(x=>x.symbol),...stocks.map(x=>x.symbol)]);
 const yahoo=await collectMorningSeries(TEST_DATE,{
  fetchDaily:fetchDatedDaily,fetchImpl,now:morningAsOf,skipSymbols:skipped});
 const combined=mergeMorningSourceRows(yahoo,master,nh,domestic,stocks);
 const checked=summarizeMorningAudit(combined,night);
 if(!auditWindow(now()).allowed)return {status:'ONE_DAY_AUDIT_EXPIRED'};
 return {status:'AUDITED',...checked,
  sourceCounts:{nhIndex:nh.length,nhStock:stocks.length,domestic:domestic.length,
    master:master.length,yahoo:yahoo.length},
  noTelegramSend:true};
}
function assertOneOffExecution(){
 if(process.env.GITHUB_EVENT_NAME!=='push'||process.env.GITHUB_REF!=='refs/heads/main'
  ||process.env.GITHUB_REPOSITORY!==TEST_REPO
  ||process.env.GITHUB_RUN_ATTEMPT!=='1')throw Error('MORNING_AUDIT_EVENT_REJECTED');
 const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
 if(event.ref!=='refs/heads/main'||event.repository?.full_name!==TEST_REPO
  ||event.deleted===true)throw Error('MORNING_AUDIT_EVENT_REJECTED');
 if(!auditWindow(new Date()).allowed)throw Error('MORNING_AUDIT_WINDOW_REJECTED');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  assertOneOffExecution();
  const r=await collectTodayMorningAudit();
  if(r.status!=='AUDITED')throw Error('MORNING_AUDIT_INCOMPLETE');
  fs.mkdirSync('.morning-audit-20261102',{recursive:true});
  fs.writeFileSync('.morning-audit-20261102/coverage.json',JSON.stringify(r));
  console.log(JSON.stringify(r));
 }catch(e){console.error(/^MORNING_AUDIT_[A-Z_]+$/.test(e?.message||'')
  ?e.message:'MORNING_AUDIT_FAILED');process.exitCode=1;}
}
