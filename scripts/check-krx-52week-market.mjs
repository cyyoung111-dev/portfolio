import {planKisAdjusted52WeekRequests,parseKisAdjusted52WeekPages,
 auditKisAdjustedSymbol,KIS_ADJUSTED_TR,KIS_ADJUSTED_PATH}
 from './krx-52week-kis-adjusted-audit.mjs';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import {MARKETS,SOURCE,WINDOW,sessionStatus,expectedSessions,
 completedSession,parseOfficialStockDay,validMarketDay,verifyArchive,
 appendArchive,countNewHighsAndLows,audit52WeekRawDiscontinuity,
 audit52WeekHistoryEligibility,updateSummary,render52WeekMarketCounts}
 from './krx-52week-market.mjs';
import {fetchOfficialMarketPair,collectHistory} from './collect-krx-52week-history.mjs';
import {sealKrxArchive,openKrxArchive} from './krx-52week-archive-crypto.mjs';
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
// KRX raw OHLC must not become a plaintext downloadable artifact in a
// publicly readable repository. Round-trip the full 252-session source,
// validate authenticated integrity, wrong-key rejection and no plaintext in
// the sealed envelope. It uses a TEST key only, never an operating secret.
const TEST_ARCHIVE_KEY='TEST_KRX_ARCHIVE_123456789';
const sealed=sealKrxArchive(complete,TEST_ARCHIVE_KEY);
assert.equal(sealed.subarray(0,5).toString('ascii'),'K52E1');
assert.deepEqual(openKrxArchive(sealed,TEST_ARCHIVE_KEY),complete);
assert.ok(!sealed.includes(Buffer.from(complete.sessions[0].date,'utf8')));
assert.throws(()=>openKrxArchive(sealed,'TEST_WRONG_ARCHIVE_KEY_12345'),
 /AUTHENTICATION_FAILED/);
const damaged=Buffer.from(sealed);damaged[damaged.length-1]^=0xff;
assert.throws(()=>openKrxArchive(damaged,TEST_ARCHIVE_KEY),
 /AUTHENTICATION_FAILED/);
assert.throws(()=>sealKrxArchive(complete,'short'),/KEY_UNAVAILABLE/);
const workflowArchive=await import('node:fs').then(fs=>fs.readFileSync(
 '.github/workflows/krx-52week-history.yml','utf8'));
assert.match(workflowArchive,/krx-52week-archive-crypto\.mjs seal/);
assert.match(workflowArchive,/krx-52week-archive-crypto\.mjs open/);
assert.match(workflowArchive,/KRX52_AUTHENTICATED_SOURCE_ROUNDTRIP_PASS/);
assert.match(workflowArchive,/cmp --silent \.krx-52week\/history\.json \.krx-52week\/reopened\.json/);
assert.match(workflowArchive,/rm \.krx-52week\/reopened\.json/);
assert.match(workflowArchive,/\.krx-52week\/history\.k52e/);
const uploadSection=workflowArchive.split('uses: actions\/upload-artifact@v4').at(-1);
assert.ok(uploadSection&&!uploadSection.includes('.krx-52week/history.json'),
 'raw historic prices must never be uploaded as a public Actions artifact');
assert.match(workflowArchive,/43433853869/,
 'migrate only the last verified legacy plaintext archive exactly once');

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
// Raw market-source completeness is NOT proof of comparable split-adjusted
// historic prices. Audit only securities with all 252 sessions; an ordinary
// last-day +30% move must not be mislabeled a confirmed corporate action.
const baselineQuality=audit52WeekRawDiscontinuity(complete,dates,count);
assert.equal(baselineQuality.status,'RAW_DISCONTINUITY_REVIEW_REQUIRED');
assert.equal(baselineQuality.thresholdAbsPct,31);
for(const market of ['KOSPI','KOSDAQ']){
 assert.equal(baselineQuality.markets[market].discontinuityCodes,0);
 assert.equal(baselineQuality.markets[market].flaggedHighs,0);
 assert.equal(baselineQuality.markets[market].flaggedLows,0);
 assert.equal(baselineQuality.markets[market].eligible,
  count.markets[market].eligible);
}
assert.equal(audit52WeekRawDiscontinuity(archive,dates,
 countNewHighsAndLows(archive,dates)).status,'HISTORY_INCOMPLETE');
// Simulate an ex-rights-looking discontinuity in an existing KOSPI code
// without calling the source event a confirmed corporate action. The next
// 170+ sessions remain valid and exactly dated.
const discontinuous=structuredClone(complete);
for(let i=80;i<discontinuous.sessions.length;i++){
 // Suspended securities are removed from daily rows, so an array index
 // is NOT a stable security identity across different sessions.
 const row=discontinuous.sessions[i].markets.KOSPI.rows
  .find(x=>x[0]==='KR000008');
 assert.ok(row,'target security identity must persist through the window');
 row[1]=60;row[2]=30;row[3]=40;
}
discontinuous.sessions.at(-1).markets.KOSPI.rows
 .find(x=>x[0]==='KR000008')[2]=20;
const discontinuousCounts=countNewHighsAndLows(discontinuous,dates);
const flagged=audit52WeekRawDiscontinuity(discontinuous,dates,discontinuousCounts);
assert.equal(discontinuousCounts.markets.KOSPI.lows,3);
assert.equal(flagged.markets.KOSPI.discontinuityCodes,1);
assert.equal(flagged.markets.KOSPI.flaggedLows,1);
assert.equal(flagged.markets.KOSPI.flaggedHighs,0);
assert.deepEqual(flagged.markets.KOSPI.flaggedExtremes,[{
 code:'KR000008',kind:'LOW',discontinuityDate:dates[80],
 discontinuityDirection:'DOWN'
}]);
assert.equal(flagged.markets.KOSDAQ.discontinuityCodes,0);
assert.equal(flagged.corporateActionsConfirmed,false);
assert.equal(flagged.splitAdjusted,false);
assert.throws(()=>audit52WeekRawDiscontinuity(discontinuous,dates.slice(1),
 discontinuousCounts),/WINDOW_UNVERIFIED/);

// #734: 252/252 raw market history DOES NOT mean a 252-session history for
// every currently traded stock. The strict count stays unchanged; audit each
// excluded code as continuously late first observed (IPO CANDIDATE only)
// versus an internal missing trading-history gap (halt/schema/rename candidate).
{
 const good=audit52WeekHistoryEligibility(complete,dates,count);
 assert.equal(good.status,'HISTORY_ELIGIBILITY_DIAGNOSTIC_ONLY');
 assert.equal(good.publicationAllowed,false);
 for(const m of ['KOSPI','KOSDAQ']){
  assert.equal(good.markets[m].fullHistory,count.markets[m].eligible);
  assert.equal(good.markets[m].shortHistory,0);
  assert.equal(good.markets[m].lateFirstObservedContinuous,0);
  assert.equal(good.markets[m].interruptedAfterFirstObserved,0);
 }
 const coverageFixture=structuredClone(complete);
 for(let i=0;i<coverageFixture.sessions.length;i++){
  const rows=coverageFixture.sessions[i].markets.KOSPI.rows;
  const absent=new Set();
  if(i<120)absent.add('KR000008');
  if(i===120)absent.add('KR000009');
  if(i<80||i===125)absent.add('KR000010');
  if(i<WINDOW-1)absent.add('KR000011');
  const retained=rows.filter(x=>!absent.has(x[0]));
  const dayMarket=coverageFixture.sessions[i].markets.KOSPI;
  dayMarket.totalRows-=rows.length-retained.length;
  dayMarket.rows=retained;
 }
 const today=coverageFixture.sessions.at(-1).markets.KOSPI.rows;
 const split= today.find(x=>x[0]==='KR000008');
 assert.ok(split);
 split[1]=145;split[2]=55;split[3]=100;
 verifyArchive(coverageFixture);
 const rawCoverage=countNewHighsAndLows(coverageFixture,dates);
 const audit=audit52WeekHistoryEligibility(coverageFixture,dates,rawCoverage);
 assert.equal(rawCoverage.markets.KOSPI.shortHistory,4);
 assert.equal(audit.markets.KOSPI.fullHistory,400);
 assert.equal(audit.markets.KOSPI.lateFirstObservedContinuous,2);
 assert.equal(audit.markets.KOSPI.interruptedAfterFirstObserved,2);
 assert.equal(audit.markets.KOSPI.oneDayOnly,1);
 assert.equal(audit.markets.KOSPI.shortHistoryCandidateHighs,1);
 assert.equal(audit.markets.KOSPI.shortHistoryCandidateLows,1);
 assert.equal(audit.markets.KOSPI.noValidOhlcToday,1);
 assert.equal(audit.markets.KOSPI.sourceReportedToday,405);
 assert.equal(audit.markets.KOSDAQ.fullHistory,rawCoverage.markets.KOSDAQ.eligible);
 assert.equal(audit.listingEventsVerified,false);
 assert.equal(audit.marketWideCertified,false);
 assert.equal(audit.splitAdjusted,false);
 assert.equal(audit.publicationAllowed,false);
 assert.equal(audit52WeekHistoryEligibility(archive,dates,
  countNewHighsAndLows(archive,dates)).status,'HISTORY_INCOMPLETE');
 const inconsistent=structuredClone(rawCoverage);
 inconsistent.markets.KOSPI.eligible++;
 assert.throws(()=>audit52WeekHistoryEligibility(coverageFixture,dates,inconsistent),
  /ELIGIBILITY_DENOMINATOR_UNVERIFIED/);
 assert.throws(()=>audit52WeekHistoryEligibility(coverageFixture,dates.slice(1),
  rawCoverage),/ELIGIBILITY_WINDOW_UNVERIFIED/);
 assert.equal(render52WeekMarketCounts(rawCoverage).includes('분할 미보정'),true,
  'no change in 52-week raw market-wide publication policy');
 console.log('KRX52_ELIGIBILITY_DIAGNOSTIC_PASS late vs interrupted, IPO unverified, current denominator');
}

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
assert.equal(collected.quality.status,'HISTORY_INCOMPLETE');
assert.equal(collected.report.quality,undefined);
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
// The KRX official daily OHLC source is T+1. An 18:40 collection
// would redundantly fetch the same completed 252-session window near
// 19:00 portfolio CLOSE. Keep one 23:30 weekday slot, independent of NAV.
assert.match(workflowSource,/^\s+- cron: '30 14 \* \* 1-5'/m);
assert.equal((workflowSource.match(/^\s+- cron:/gm)||[]).length,1,
 'one nightly KRX scheduled probe, no 18:40 duplicate');
assert.doesNotMatch(workflowSource,/^\s+- cron: '40 9 /m);
const navSource=readFileSync('.github/workflows/kb-fund-nav-collect.yml','utf8');
assert.doesNotMatch(navSource,/^\s+workflow_run:/m,
 'a KRX 52-week OHLC completion must not fan out to private NAV');
assert.doesNotMatch(navSource,/github\.event\.workflow_run/,
 'NAV jobs may only use their own cron or explicit manual dispatch');
assert.match(navSource,/cron: '30 0 \* \* 1-5'/);
assert.match(navSource,/cron: '10 9 \* \* 1-5'/);
assert.match(navSource,/cron: '17 10 \* \* 1-5'/);


// One-time cleanup must preserve BOTH successful encrypted backup points and
// must never delete unrelated Actions artifacts or bypass workflow provenance.
const {selectLegacyArtifacts,pruneLegacy}=await import(
 './prune-krx52-legacy-public-artifacts.mjs');
const legacyArt={id:1001,name:'krx-52week-archive',expired:false,
 created_at:'2026-11-13T13:28:12Z',workflow_run:{id:43433853869}};
const sealedA={id:2001,name:'krx-52week-archive',expired:false,
 created_at:'2026-11-13T13:38:26Z',workflow_run:{id:43435348491}};
const sealedB={id:2002,name:'krx-52week-archive',expired:false,
 created_at:'2026-11-13T13:43:26Z',workflow_run:{id:43436095621}};
assert.deepEqual(selectLegacyArtifacts([legacyArt,sealedA,sealedB]),[legacyArt]);
assert.throws(()=>selectLegacyArtifacts([legacyArt,sealedA]),
 /ENCRYPTED_RECOVERY_ARTIFACT_MISSING/);
assert.deepEqual(selectLegacyArtifacts([sealedA,sealedB]),[]);
const pruneRequests=[];
const mockArtifacts=[legacyArt,sealedA,sealedB];
const fetchPrune=async (url,opts)=>{
 const u=new URL(url),suffix=u.pathname;
 pruneRequests.push({path:suffix,method:opts.method});
 if(suffix.endsWith('/actions/artifacts'))return {
  ok:true,json:async()=>({artifacts:mockArtifacts})};
 if(/\/actions\/runs\/[0-9]+$/.test(suffix)){
  const id=Number(suffix.split('/').at(-1));
  return {ok:true,json:async()=>({
   id,name:'KRX 252-session 52-week market breadth archive (source only)',
   path:'.github/workflows/krx-52week-history.yml',
   head_branch:'main',head_repository:{full_name:'cyyoung111-dev/portfolio'},
   conclusion:'success'})};
 }
 if(opts.method==='DELETE'&&suffix==='/repos/cyyoung111-dev/portfolio/actions/artifacts/1001')
  return {ok:true,status:204};
 throw Error('unexpected test GitHub API call');
};
const dry=await pruneLegacy({token:'TEST_GITHUB_TOKEN_123456789',
 fetchImpl:fetchPrune,deleteEnabled:false});
assert.equal(dry.legacyCandidateCount,1);
assert.equal(dry.deletedCount,0);
assert.equal(pruneRequests.filter(x=>x.method==='DELETE').length,0);
const executed=await pruneLegacy({token:'TEST_GITHUB_TOKEN_123456789',
 fetchImpl:fetchPrune,deleteEnabled:true});
assert.equal(executed.deletedCount,1);
assert.deepEqual(pruneRequests.filter(x=>x.method==='DELETE').map(x=>x.path),[
 '/repos/cyyoung111-dev/portfolio/actions/artifacts/1001'
]);
assert.ok(!JSON.stringify(executed).includes('TEST_GITHUB_TOKEN'));

// #734: KIS adjusted price audit is separate from the existing KRX raw
// archive. A correct source contract requires three exact 100/100/52-session
// requests, adjusted=0, dated high/low/close, and a same-date KRX crosscheck.
// No KIS credentials, remote calls, public historical prices or finance writes.
{
 const pages=planKisAdjusted52WeekRequests(dates,'005930');
 assert.deepEqual(pages.map(p=>p.expectedDates.length),[100,100,52]);
 assert.equal(pages[0].trId,KIS_ADJUSTED_TR);
 assert.equal(pages[0].path,KIS_ADJUSTED_PATH);
 assert.equal(pages[0].params.FID_COND_MRKT_DIV_CODE,'J');
 assert.equal(pages[0].params.FID_ORG_ADJ_PRC,'0','KIS 0 is adjusted, NOT raw');
 assert.equal(pages[1].params.FID_INPUT_DATE_1,dates[100].replaceAll('-',''));
 assert.equal(pages[2].params.FID_INPUT_DATE_2,TARGET.replaceAll('-',''));
 assert.throws(()=>planKisAdjusted52WeekRequests(dates,'KR000000'),/CODE_UNVERIFIED/);
 assert.throws(()=>planKisAdjusted52WeekRequests(dates.slice(1),'005930'),/WINDOW_INVALID/);
 const archiveFixture=structuredClone(complete);
 for(let i=0;i<archiveFixture.sessions.length;i++){
  const rows=archiveFixture.sessions[i].markets.KOSPI.rows;
  const row=rows.find(x=>x[0]==='KR000000');
  assert.ok(row);
  row[0]='005930';
  if(i<WINDOW-1){row[1]=200;row[2]=100;row[3]=150;}
  else{row[1]=160;row[2]=120;row[3]=140;}
  rows.sort((a,b)=>a[0].localeCompare(b[0],'en'));
 }
 assert.equal(verifyArchive(archiveFixture).sessions.length,WINDOW);
 const responsePages=pages.map(p=>({
  rt_cd:'0',
  // Official output2 may be reverse chronological; keep date mapping exact.
  output2:[...p.expectedDates].reverse().map(date=>{
   const last=date===TARGET;
   return {stck_bsop_date:date.replaceAll('-',''),
    stck_hgpr:last?'160':'100',stck_lwpr:last?'120':'50',
    stck_clpr:last?'140':'75'};
  })
 }));
 const parsed=parseKisAdjusted52WeekPages(dates,'005930',responsePages);
 assert.equal(parsed.bars.length,252);
 assert.equal(parsed.bars.at(-1).date,TARGET);
 const audit=auditKisAdjustedSymbol(archiveFixture,dates,'KOSPI','005930',responsePages);
 assert.deepEqual(audit.raw,{newHigh:false,newLow:false});
 assert.deepEqual(audit.adjusted,{newHigh:true,newLow:false},
  'synthetic 2:1 split changes the high classification');
 assert.equal(audit.marketWideCertified,false);
 assert.equal(audit.publicationAllowed,false);
 assert.equal(audit.gasWrites,0);
 assert.equal(audit.portfolioWrites,0);
 assert.equal(audit.telegramSends,0);
 const tamper=(which,edit)=>{
  const cloned=structuredClone(responsePages);
  edit(cloned[which].output2);
  assert.throws(()=>parseKisAdjusted52WeekPages(dates,'005930',cloned),
   /KRX52_KIS_/);
 };
 tamper(0,rows=>{rows.pop()});
 tamper(1,rows=>{rows[1].stck_bsop_date=rows[0].stck_bsop_date});
 tamper(2,rows=>{rows[0].stck_hgpr='0'});
 tamper(0,rows=>{rows[0].stck_bsop_date='20260101'});
 const mismatched=structuredClone(responsePages);
 mismatched[2].output2[0].stck_hgpr='161';
 assert.throws(()=>auditKisAdjustedSymbol(archiveFixture,dates,
  'KOSPI','005930',mismatched),/LATEST_KRX_PRICE_BASIS_MISMATCH/);
 const rejected=structuredClone(responsePages);
 rejected[0].rt_cd='1';
 assert.throws(()=>parseKisAdjusted52WeekPages(dates,'005930',rejected),
  /RESPONSE_OR_COVERAGE_UNVERIFIED/);
 assert.throws(()=>auditKisAdjustedSymbol(archiveFixture,dates,
  'KOSDAQ','005930',responsePages),/RAW_SECURITY_COVERAGE_UNVERIFIED/);
 console.log('KRX52_KIS_ADJUSTED_SOURCE_CONTRACT_PASS three dated pages, corporate action, crosscheck, publication blocked');
}


// #734: Official KRX stock basic-info listing dates are a DISTINCT,
 // approval-gated service. They may validate short late histories but cannot
 // certify exchange halts, split adjustment or the all-stock 52-week total.
{
 const {parseKrxBaseInfo,analyzeOfficialListingCoverage,
  fetchKrxBaseInfo,runKrxListingReadOnly,KRX_BASE_INFO_PATHS}
  =await import('./krx-52week-listing-metadata-readonly.mjs');
 const stamped=structuredClone(complete);
 for(let i=0;i<stamped.sessions.length;i++){
  const session=stamped.sessions[i];
  for(const [market,renames] of [
   ['KOSPI',{'KR000008':'005930','KR000009':'000660'}],
   ['KOSDAQ',{'KQ000008':'035555'}]
  ]){
   const rows=session.markets[market].rows;
   for(const row of rows)if(renames[row[0]])row[0]=renames[row[0]];
   // 005930: first observed at index 200, official listing same day.
   // 000660: existing stock with one interior gap, never claim halt.
   // 035555: listed and first observed at index 80.
   const trimmed=rows.filter(([code])=>
    !(market==='KOSPI'&&code==='005930'&&i<200) &&
    !(market==='KOSPI'&&code==='000660'&&i===125) &&
    !(market==='KOSDAQ'&&code==='035555'&&i<80));
   session.markets[market].totalRows-=rows.length-trimmed.length;
   session.markets[market].rows=trimmed.sort((a,b)=>a[0].localeCompare(b[0],'en'));
  }
 }
 verifyArchive(stamped);
 const fixture=m=>{
  const rows=Array.from({length:MARKETS[m].min+5},(_,i)=>({
   ISU_SRT_CD:String(i+100000).padStart(6,'0'),
   ISU_CD:'KR7'+String(i).padStart(9,'0'),
   LIST_DD:'20200102',SECUGRP_NM:'주권',KIND_STKCERT_TP_NM:'보통주'
  }));
  if(m==='KOSPI'){
   rows[0].ISU_SRT_CD='005930';
   rows[0].LIST_DD=dates[200].replaceAll('-','');
   rows[1].ISU_SRT_CD='000660';
  }else{
   rows[0].ISU_SRT_CD='035555';
   rows[0].LIST_DD=dates[80].replaceAll('-','');
  }
  return {OutBlock_1:rows};
 };
 const payloadK=fixture('KOSPI'),payloadQ=fixture('KOSDAQ');
 const metaK=parseKrxBaseInfo(TARGET,'KOSPI',payloadK);
 const metaQ=parseKrxBaseInfo(TARGET,'KOSDAQ',payloadQ);
 assert.equal(metaK.codes.get('005930').listed,dates[200]);
 assert.equal(metaQ.codes.get('035555').listed,dates[80]);
 assert.throws(()=>parseKrxBaseInfo(TARGET,'KOSPI',{}),/SCHEMA_OR_COVERAGE/);
 const duplicate=structuredClone(payloadK);
 duplicate.OutBlock_1[1].ISU_SRT_CD=duplicate.OutBlock_1[0].ISU_SRT_CD;
 assert.throws(()=>parseKrxBaseInfo(TARGET,'KOSPI',duplicate),/CODE_IDENTITY_OR_DUPLICATE/);
 const future=structuredClone(payloadK);
 future.OutBlock_1[0].LIST_DD='20261201';
 assert.throws(()=>parseKrxBaseInfo(TARGET,'KOSPI',future),/FUTURE_LISTING/);
 const report=analyzeOfficialListingCoverage(stamped,dates,{KOSPI:metaK,KOSDAQ:metaQ});
 assert.equal(report.publicationAllowed,false);
 assert.equal(report.corporateActionsVerified,false);
 assert.equal(report.markets.KOSPI.matched,2);
 assert.equal(report.markets.KOSPI.matchedLateContinuous,1);
 assert.equal(report.markets.KOSPI.matchedInterrupted,1);
 assert.equal(report.markets.KOSPI.confirmedListedWithinWindowLate,1);
 assert.equal(report.markets.KOSPI.listedBeforeWindowButInterrupted,1);
 assert.equal(report.markets.KOSDAQ.matched,1);
 assert.equal(report.markets.KOSDAQ.confirmedListedWithinWindowLate,1);
 assert.equal(report.markets.KOSPI.sourceStatus,'PARTIAL_OR_IDENTITY_CONFLICT');
 const badIdentity=structuredClone(payloadK);
 badIdentity.OutBlock_1[0].LIST_DD=dates[201].replaceAll('-','');
 const conflict=analyzeOfficialListingCoverage(stamped,dates,{
  KOSPI:parseKrxBaseInfo(TARGET,'KOSPI',badIdentity),KOSDAQ:metaQ
 });
 assert.equal(conflict.markets.KOSPI.listedDateAfterFirstQuote,1);
 assert.equal(conflict.markets.KOSPI.sourceStatus,'PARTIAL_OR_IDENTITY_CONFLICT');
 let calls=[];
 const fake=async (url,o)=>{
  const u=new URL(url);
  calls.push(u.pathname);
  assert.equal(o.method,'GET');
  assert.equal(u.searchParams.get('basDd'),'20261113');
  const q=u.pathname===KRX_BASE_INFO_PATHS.KOSDAQ;
  return {ok:true,headers:{get:()=>null},json:async()=>q?payloadQ:payloadK};
 };
 const valid=await runKrxListingReadOnly({archive:stamped,
  key:'TEST_KRX_KEY_123456789',fetchImpl:fake,
  now:new Date('2026-11-16T09:30:00+09:00')});
 assert.deepEqual(calls,[KRX_BASE_INFO_PATHS.KOSPI,KRX_BASE_INFO_PATHS.KOSDAQ]);
 assert.equal(valid.markets.KOSPI.confirmedListedWithinWindowLate,1);
 assert.equal(valid.markets.KOSDAQ.confirmedListedWithinWindowLate,1);
 assert.equal(valid.status,'LISTING_METADATA_AUDIT_ONLY');
 assert.equal(valid.publicationAllowed,false);
 const denied=await runKrxListingReadOnly({archive:stamped,
  key:'TEST_KRX_KEY_123456789',
  fetchImpl:async()=>({ok:false,status:403}),
  now:new Date('2026-11-16T09:30:00+09:00')});
 assert.equal(denied.status,'SOURCE_UNVERIFIED');
 assert.equal(denied.sourceStatus.KOSPI,'KRX_HTTP403_ACCESS_DENIED');
 assert.equal(denied.sourceStatus.KOSDAQ,'KRX_HTTP403_ACCESS_DENIED',
  '403 in the first market must not hide independent second-market approval');
 // Explicit same-day one-shot proof: KOSPI denied, KOSDAQ approved, still
 // SOURCE_UNVERIFIED. No portfolio write and no false overall SUCCESS.
 const checked=[];
 const separatelyApproved=await runKrxListingReadOnly({archive:stamped,
  key:'TEST_KRX_KEY_123456789',now:new Date('2026-11-16T09:30:00+09:00'),
  fetchImpl:async url=>{
   const p=new URL(url).pathname;checked.push(p);
   if(p===KRX_BASE_INFO_PATHS.KOSPI)return {ok:false,status:403};
   return {ok:true,headers:{get:()=>null},json:async()=>payloadQ};
  }});
 assert.deepEqual(checked,[KRX_BASE_INFO_PATHS.KOSPI,KRX_BASE_INFO_PATHS.KOSDAQ]);
 assert.deepEqual(separatelyApproved.sourceStatus,{
  KOSPI:'KRX_HTTP403_ACCESS_DENIED',KOSDAQ:'VERIFIED'});
 assert.equal(separatelyApproved.status,'SOURCE_UNVERIFIED');
 assert.equal(separatelyApproved.publicationAllowed,false);
 let authCalls=0;
 const invalidSharedAuth=await runKrxListingReadOnly({archive:stamped,
  key:'TEST_KRX_KEY_123456789',now:new Date('2026-11-16T09:30:00+09:00'),
  fetchImpl:async()=>{authCalls++;return {ok:false,status:401};}});
 assert.equal(authCalls,2,'401 may deny a single KRX service; test both once');
 assert.equal(invalidSharedAuth.sourceStatus.KOSPI,'KRX_HTTP401_ACCESS_DENIED');
 assert.equal(invalidSharedAuth.sourceStatus.KOSDAQ,'KRX_HTTP401_ACCESS_DENIED');
 const independentlyAllowedAfter401=await runKrxListingReadOnly({archive:stamped,
  key:'TEST_KRX_KEY_123456789',now:new Date('2026-11-16T09:30:00+09:00'),
  fetchImpl:async url=>new URL(url).pathname===KRX_BASE_INFO_PATHS.KOSPI
   ?{ok:false,status:401}
   :{ok:true,headers:{get:()=>null},json:async()=>payloadQ}});
 assert.deepEqual(independentlyAllowedAfter401.sourceStatus,{
  KOSPI:'KRX_HTTP401_ACCESS_DENIED',KOSDAQ:'VERIFIED'});
 assert.equal(independentlyAllowedAfter401.publicationAllowed,false);
 assert.equal(invalidSharedAuth.status,'SOURCE_UNVERIFIED');
 let throttleCalls=0;
 const throttled=await runKrxListingReadOnly({archive:stamped,
  key:'TEST_KRX_KEY_123456789',now:new Date('2026-11-16T09:30:00+09:00'),
  fetchImpl:async()=>{throttleCalls++;return {ok:false,status:429};}});
 assert.equal(throttleCalls,1);
 assert.equal(throttled.sourceStatus.KOSPI,'RATE_LIMITED');
 const statusCli=(await import('node:fs')).readFileSync(
  'scripts/krx-52week-listing-metadata-readonly.mjs','utf8');
 assert.match(statusCli,/process\.exitCode=2/,
  'source / identity unverified must return a failing job outcome');
 assert.match(statusCli,/SOURCE_OR_IDENTITY_NOT_VERIFIED/);
 assert.equal(denied.marketWideCertified,false);
 assert.equal(denied.gasWrites,0);
 assert.equal(denied.portfolioWrites,0);
 const stale=await runKrxListingReadOnly({archive:stamped,
  key:'TEST_KRX_KEY_123456789',fetchImpl:()=>{throw Error('should_not_call');},
  now:new Date('2026-11-17T09:30:00+09:00')});
 assert.equal(stale.status,'ARCHIVE_STALE');
 assert.equal(stale.portfolioWrites,0);
 const script=(await import('node:fs')).readFileSync(
  '.github/workflows/krx-52week-listing-audit-readonly.yml','utf8');
 assert.match(script,/node scripts\/krx-52week-listing-metadata-readonly\.mjs/);
 assert.match(script,/--input=\.krx-52week\/listing\/history\.json/);
 assert.match(script,/gh run download/);
 assert.match(script,/history\.k52e/);
 assert.match(script,/process\.env\.KRX_AUTH_KEY|KRX_AUTH_KEY:/);
 assert.doesNotMatch(script,/actions\/upload-artifact|gas-deploy|workflow_run:|TELEGRAM_/);
  // Unapproved listing metadata may return HTTP 401 on source pushes.
  // Keep offline CI continuous and real KRX calls manual-only until approval.
  function checkManualKrxListing(source){
   const doc=YAML.parseDocument(source,{uniqueKeys:true,version:'1.2'});
   assert.equal(doc.errors.length,0);
   const cfg=doc.toJS({maxAliasCount:0});
   assert.deepEqual(Object.keys(cfg.on),['workflow_dispatch']);
   assert.deepEqual(cfg.permissions,{contents:'read',actions:'read'});
   const job=cfg.jobs['listing-date-audit'];
   assert.equal(job.environment,'portfolio-production-gas');
   assert.equal(job.if,
    "github.repository == 'cyyoung111-dev/portfolio' && github.ref == 'refs/heads/main' && github.run_attempt == 1 && github.event_name == 'workflow_dispatch'");
   assert.equal(job.steps.at(-1).env.KRX_AUTH_KEY,
    ' source approval, real dates, unknown-halt, zero writes');
}

console.log('KRX_52W_252_SESSION_MARKET_HISTORY_PASS exact OHLC, count, holidays, incomplete, reentry, source-only');
+'{{ secrets.KRX_AUTH_KEY }}');
  }
  checkManualKrxListing(script);
  assert.throws(()=>checkManualKrxListing(script.replace(
   '  workflow_dispatch:',
   "  push:\n    branches: [main]\n  workflow_dispatch:")));
  assert.throws(()=>checkManualKrxListing(script.replace(
   "github.event_name == 'workflow_dispatch'",
   "(github.event_name == 'push' || github.event_name == 'workflow_dispatch')")));
 console.log('KRX52_OFFICIAL_LISTING_DATE_SOURCE_CONTRACT_PASS source approval, real dates, unknown-halt, zero writes');
}

console.log('KRX_52W_252_SESSION_MARKET_HISTORY_PASS exact OHLC, count, holidays, incomplete, reentry, source-only');
