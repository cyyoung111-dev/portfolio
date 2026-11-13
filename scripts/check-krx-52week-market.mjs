import assert from 'node:assert/strict';
import {MARKETS,SOURCE,WINDOW,sessionStatus,expectedSessions,
 completedSession,parseOfficialStockDay,validMarketDay,verifyArchive,
 appendArchive,countNewHighsAndLows,updateSummary,render52WeekMarketCounts}
 from './krx-52week-market.mjs';
import {fetchOfficialMarketPair,collectHistory} from './collect-krx-52week-history.mjs';
const TARGET='2026-11-13';
const dates=expectedSessions(TARGET);
assert.equal(dates.length,252);
assert.equal(dates.at(-1),TARGET);
assert.ok(dates[0]<TARGET);
assert.ok(dates[0]>='2025-10-01');
assert.ok(!dates.includes('2025-12-25')&&!dates.includes('2025-12-31'));
assert.ok(!dates.includes('2026-09-25'));
assert.equal(sessionStatus('2025-12-31'),'CLOSED');
assert.equal(sessionStatus('2025-10-01'),'OPEN');
assert.equal(sessionStatus('2025-08-07'),'UNKNOWN');
// KRX OPEN API does not publish the current-day OHLC at 17:00. Friday's
// session becomes release-eligible only next KRX open day (Monday) after 08:15.
assert.equal(completedSession(new Date(TARGET+'T19:15:00+09:00')),'2026-11-12');
assert.equal(completedSession(new Date(TARGET+'T07:00:00+09:00')),'2026-11-11');
assert.equal(completedSession(new Date(TARGET+'T08:14:00+09:00')),'2026-11-11');
assert.equal(completedSession(new Date(TARGET+'T08:15:00+09:00')),'2026-11-12');
assert.equal(completedSession(new Date('2026-11-14T23:30:00+09:00')),'2026-11-12');
assert.equal(completedSession(new Date('2026-11-15T23:30:00+09:00')),'2026-11-12');
assert.equal(completedSession(new Date('2026-11-16T08:14:00+09:00')),'2026-11-12');
assert.equal(completedSession(new Date('2026-11-16T08:15:00+09:00')),TARGET);
assert.equal(completedSession(new Date('2026-11-16T18:40:00+09:00')),TARGET);
assert.equal(completedSession(new Date('2026-11-17T07:40:00+09:00')),TARGET);
assert.equal(completedSession(new Date('2026-11-17T09:00:00+09:00')),'2026-11-16');
assert.throws(()=>expectedSessions('2025-07-04'),/SESSION_UNVERIFIED/);
const raw=(day,market,special=false)=>{
 const min=MARKETS[market].min;
 const prefix=market==='KOSPI'?'KR':'KQ';
 const OutBlock_1=Array.from({length:min+5},(_,i)=>{
  const code=prefix+String(i).padStart(6,'0');
  let hi=120,lo=80,close=100;
  if(special&&i===0){hi=201;lo=80;close=130;}
  if(special&&i===1){hi=120;lo=59;close=100;}
  if(special&&i===2){hi=222;lo=42;close=100;}
  if(special&&i===3){hi=120;lo=80;close=100;}
  if(special&&i===4){hi=0;lo=0;close=100;}
  return {BAS_DD:day.replaceAll('-',''),ISU_CD:code,
   TDD_HGPRC:String(hi),TDD_LWPRC:String(lo),
   TDD_CLSPRC:String(close)};
 });
 return {OutBlock_1};
};
const first=dates[0];
const parsed=parseOfficialStockDay(first,'KOSPI',raw(first,'KOSPI'));
assert.equal(parsed.rows.length,405);
assert.equal(parsed.excludedRows,0);
assert.ok(validMarketDay(parsed,first,'KOSPI'));
const suspended=parseOfficialStockDay(TARGET,'KOSPI',raw(TARGET,'KOSPI',true));
assert.equal(suspended.rows.length,404);
assert.equal(suspended.excludedRows,1);
assert.ok(validMarketDay(suspended,TARGET,'KOSPI'));
const invalidDay=raw(first,'KOSPI');invalidDay.OutBlock_1[0].BAS_DD='20261112';
assert.throws(()=>parseOfficialStockDay(first,'KOSPI',invalidDay),/SCHEMA_UNVERIFIED/);
const duplicate=raw(first,'KOSPI');duplicate.OutBlock_1[1].ISU_CD=duplicate.OutBlock_1[0].ISU_CD;
assert.throws(()=>parseOfficialStockDay(first,'KOSPI',duplicate),/SCHEMA_UNVERIFIED/);
assert.throws(()=>parseOfficialStockDay(first,'KOSPI',{OutBlock_1:[]}),/ROWS_UNVERIFIED/);
const invalidPrice=raw(first,'KOSPI');invalidPrice.OutBlock_1[0].TDD_HGPRC='-1';
const excluded=parseOfficialStockDay(first,'KOSPI',invalidPrice);
assert.equal(excluded.excludedRows,1);
let p=raw(first,'KOSPI');p.OutBlock_1[0].TDD_HGPRC='100';
p.OutBlock_1[0].TDD_LWPRC='110';
assert.equal(parseOfficialStockDay(first,'KOSPI',p).excludedRows,1);
assert.equal(render52WeekMarketCounts({status:'HISTORY_INCOMPLETE'}),'');
// A complete 252-session history is mandatory before publishing counts.
let archive=verifyArchive(null);
const pair=(date,special=false)=>({date,markets:{
 KOSPI:parseOfficialStockDay(date,'KOSPI',raw(date,'KOSPI',special)),
 KOSDAQ:parseOfficialStockDay(date,'KOSDAQ',raw(date,'KOSDAQ',special))
}});
archive=appendArchive(archive,dates,pair(dates[0]));
assert.equal(archive.sessions.length,1);
assert.equal(countNewHighsAndLows(archive,dates).status,'HISTORY_INCOMPLETE');
assert.throws(()=>appendArchive(archive,dates,{...pair(dates[0]),
 markets:{KOSPI:pair(dates[0]).markets.KOSPI}}),/PAIR_UNVERIFIED/);
assert.throws(()=>appendArchive(archive,dates,pair(dates[0],true)),
 /EXISTING_DAY_CONFLICT/);
const complete={version:1,source:SOURCE,
 sessions:dates.map((d,i)=>pair(d,i===dates.length-1)),summaries:[]};
const count=countNewHighsAndLows(complete,dates);
assert.equal(count.status,'VERIFIED_RAW_UNADJUSTED_REFERENCE');
assert.equal(count.window,252);
for(const market of ['KOSPI','KOSDAQ']){
 assert.equal(count.markets[market].highs,2);
 assert.equal(count.markets[market].lows,2);
 assert.equal(count.markets[market].net,0);
 assert.equal(count.markets[market].shortHistory,0,
  'suspended today is absent, not reclassified as a new 52-week high');
}
assert.match(render52WeekMarketCounts(count),/52주 신규 고가 2 \/ 신규 저가 2/);
assert.match(render52WeekMarketCounts(count),/분할 미보정/);
const snapshot=updateSummary(complete,count);
assert.equal(snapshot.summaries.length,1);
assert.equal(updateSummary(snapshot,count).summaries.length,1);
assert.equal(countNewHighsAndLows({...complete,sessions:complete.sessions.slice(1)},dates).status,
 'HISTORY_INCOMPLETE');
assert.throws(()=>verifyArchive({...complete,
 sessions:[...complete.sessions.slice(1),complete.sessions[0]]}),/ARCHIVE_DAY_UNVERIFIED/);
const broken=structuredClone(complete);
broken.sessions[1].markets.KOSPI.rows[0][1]=-1;
assert.throws(()=>verifyArchive(broken),/ARCHIVE_DAY_UNVERIFIED/);
// A recently listed instrument cannot be counted as a 252-session extreme.
const newList=structuredClone(complete);
newList.sessions.at(-1).markets.KOSPI.rows[10][0]='KRNEW001';
newList.sessions.at(-1).markets.KOSPI.rows.sort((a,b)=>a[0].localeCompare(b[0],'en'));
assert.equal(countNewHighsAndLows(newList,dates).markets.KOSPI.shortHistory,1);
const mock=async url=>{
 const u=new URL(url),market=u.pathname.includes('stk_bydd')?'KOSPI':'KOSDAQ';
 assert.equal(u.searchParams.get('basDd'),TARGET.replaceAll('-',''));
 return {ok:true,status:200,headers:{get:()=>null},
  json:async()=>raw(TARGET,market)};
};
const fetched=await fetchOfficialMarketPair(TARGET,{key:'TEST_KRX_KEY_123456789',fetchImpl:mock});
assert.deepEqual(fetched.statuses,{KOSPI:'VERIFIED',KOSDAQ:'VERIFIED'});
assert.equal(fetched.pair.date,TARGET);
const denied=await fetchOfficialMarketPair(TARGET,{key:'TEST_KRX_KEY_123456789',
 fetchImpl:async()=>({ok:false,status:403})});
assert.equal(denied.pair,null);
assert.deepEqual(denied.statuses,{
 KOSPI:'PERMISSION_DENIED',KOSDAQ:'PERMISSION_DENIED'});
let requests=0;
const trace=[];
const collected=await collectHistory({
 now:new Date('2026-11-16T09:20:00+09:00'),
 key:'TEST_KRX_KEY_123456789',maxDates:2,pause:async()=>{},
 fetchImpl:async url=>{
  requests++;
  const u=new URL(url),market=u.pathname.includes('stk_bydd')?'KOSPI':'KOSDAQ';
  const dt=u.searchParams.get('basDd');
  const d=dt.slice(0,4)+'-'+dt.slice(4,6)+'-'+dt.slice(6);
  return {ok:true,status:200,headers:{get:()=>null},json:async()=>raw(d,market)};
 },log:x=>trace.push(x)
});
assert.equal(requests,4,'only two date pairs are queried per bounded run');
assert.equal(collected.report.addedDates,2);
assert.equal(collected.report.storedSessions,2);
assert.equal(collected.report.windowStart,dates[0]);
assert.equal(collected.report.windowEnd,TARGET);
assert.equal(collected.report.officialPublicationPolicy,
 'NEXT_KRX_OPEN_AFTER_0815_KST');

assert.equal(collected.report.attemptedResults.length,2);
assert.deepEqual(collected.report.attemptedResults.map(x=>x.saved),[true,true]);
assert.ok(collected.report.attemptedResults.every(x=>
 x.KOSPI==='VERIFIED'&&x.KOSDAQ==='VERIFIED'));
assert.equal(collected.report.sourceCoverage,'HISTORY_INCOMPLETE');
assert.equal(collected.counts.markets,null);
assert.equal(trace[0].portfolioWrites,0);
assert.ok(!JSON.stringify(trace).includes('TEST_KRX_KEY'));
await assert.rejects(collectHistory({key:''}),/KRX52_KEY_UNAVAILABLE/);
// Regression: the older 11-day artifact was selected instead of the newer
// 22-day artifact when unsorted first was treated as newest.
// The main-only runner must sort artifacts by created_at then id.
const {readFileSync}=await import('node:fs');
const workflowSource=readFileSync('.github/workflows/krx-52week-history.yml','utf8');
assert.match(workflowSource,/sort_by\(\.created_at, \.id\) \| last \| \.workflow_run\.id \/\/ empty/);
assert.doesNotMatch(workflowSource,/\| first \/\/ empty/);
assert.match(workflowSource,/KRX52_PRIOR_ARCHIVE_RESTORED run=\$previous/);
console.log('KRX_52W_252_SESSION_MARKET_HISTORY_PASS exact OHLC, count, holidays, incomplete, reentry, source-only');
