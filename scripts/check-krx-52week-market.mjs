import {planKisAdjusted52WeekRequests,parseKisAdjusted52WeekPages,
 auditKisAdjustedSymbol,KIS_ADJUSTED_TR,KIS_ADJUSTED_PATH}
 from './krx-52week-kis-adjusted-audit.mjs';
import assert from 'node:assert/strict';
import {MARKETS,SOURCE,WINDOW,sessionStatus,expectedSessions,
 completedSession,parseOfficialStockDay,validMarketDay,verifyArchive,
 appendArchive,countNewHighsAndLows,audit52WeekRawDiscontinuity,
 updateSummary,render52WeekMarketCounts}
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
// The KRX official daily OHLC source is T+1. An 18:40 collection would
// fetch the same completed 252-session window again and can trigger NAV
// collection just before 19:00 portfolio CLOSE. One 23:30 weekday slot only.
assert.match(workflowSource,/^\s+- cron: '30 14 \* \* 1-5'/m);
assert.equal((workflowSource.match(/^\s+- cron:/gm)||[]).length,1,
 'one nightly KRX scheduled probe, no 18:40 duplicate');
assert.doesNotMatch(workflowSource,/^\s+- cron: '40 9 /m);
const navSource=readFileSync('.github/workflows/kb-fund-nav-collect.yml','utf8');
assert.match(navSource,/workflow_run:/);
assert.match(navSource,/github\.event\.workflow_run\.event == 'schedule'/);
assert.match(navSource,/github\.event\.workflow_run\.path == '\.github\/workflows\/krx-52week-history\.yml'/);


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

console.log('KRX_52W_252_SESSION_MARKET_HISTORY_PASS exact OHLC, count, holidays, incomplete, reentry, source-only');
