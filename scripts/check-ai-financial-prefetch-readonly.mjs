import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {buildAiFinancialEvidence,formatAiFinancialEvidence}
 from './briefing-financial-evidence.mjs';
import {financialPrefetchWindow,prefetchAiFinancialEvidence,
 verifyFinancialPrefetchArtifact,FINANCIAL_PREFETCH_REPO,
 FINANCIAL_PREFETCH_FILE} from './prefetch-ai-financial-evidence-readonly.mjs';

const now=()=>new Date('2026-11-08T21:20:00Z'); // 2026-11-09 Mon 06:20 KST
const day='2026-11-09',usSessionDate='2026-11-06';
const is=financialPrefetchWindow(now());
assert.deepEqual(is,{allowed:true,date:day,status:'IN_WINDOW'});
assert.equal(financialPrefetchWindow(new Date('2026-11-08T21:14:59Z')).allowed,false);
assert.equal(financialPrefetchWindow(new Date('2026-11-08T22:25:00Z')).allowed,false);
assert.equal(financialPrefetchWindow(new Date('invalid')).allowed,false);
const sentinelAt=()=>new Date('2026-11-08T22:30:00Z'); // 07:30 KST
assert.deepEqual(financialPrefetchWindow(sentinelAt(),{mode:'sentinel'}),
 {date:day,allowed:true,status:'IN_WINDOW'});
assert.equal(financialPrefetchWindow(new Date('2026-11-08T22:19:59Z'),{mode:'sentinel'}).allowed,false);
assert.equal(financialPrefetchWindow(new Date('2026-11-08T22:38:00Z'),{mode:'sentinel'}).allowed,false);
assert.equal(financialPrefetchWindow(sentinelAt(),{mode:'unknown'}).allowed,false);

const proof=buildAiFinancialEvidence({
 asOfKst:day,usSessionDate,domesticSessionDate:null,
 ttm:{statuses:[{symbol:'MSFT',status:'VERIFIED_TTM'}],
  reports:[{symbol:'MSFT',periodEnd:'2026-09-30',quarterFiledAt:'2026-10-24',
   quarterAccession:'mock-quarter',annualAccession:'mock-annual',
   method:'FY_PLUS_CURRENT_YTD_MINUS_PRIOR_YTD',
   fields:{operatingCashFlow:1000,capex:300},
   calculated:{freeCashFlow:700}}]},
 fyValues:{statuses:[{symbol:'MSFT',status:'VERIFIED_FY_BPS_PBR'}],
  snapshots:[{symbol:'MSFT',source:'SEC_10K_US_GAAP',
   asOf:'2026-06-30',reportedAt:'2026-07-31',
   priceDate:usSessionDate,priceSource:'YAHOO_DAILY_REFERENCE',
   bpsUsd:50,splitAdjustedBpsUsd:50,splitSharesPerOldShare:1,
   priceUsd:500,pbrTimes:10}]},
 dart:{statuses:[{symbol:'005930',status:'DART_KEY_NOT_CONFIGURED'},
                 {symbol:'000660',status:'DART_KEY_NOT_CONFIGURED'}],
       rows:[]}
});
assert.deepEqual(proof.coverage,{ttm:1,fyOnly:0,referencePbr:1,domestic:0});
assert.ok(formatAiFinancialEvidence(proof).length);
let called=0;
const writer=async ({usSessionDate:session,domesticSessionDate,domesticQuotes})=>{
 called++;
 assert.equal(session,usSessionDate);
 assert.equal(domesticSessionDate,null);
 assert.deepEqual(domesticQuotes,[]);
 return proof;
};
const built=await prefetchAiFinancialEvidence({now,collector:writer});
assert.equal(called,1);
assert.equal(built.ready,true);
assert.equal(built.artifactName,'ai-financial-evidence-'+day);
assert.equal(built.data.source,'SEC_DART_PUBLIC_READ_ONLY');
assert.equal(built.data.repository,FINANCIAL_PREFETCH_REPO);
assert.equal(FINANCIAL_PREFETCH_FILE,'financial-evidence.json');
assert.ok(JSON.stringify(built.data).length<45000);
assert.deepEqual(verifyFinancialPrefetchArtifact(day,built.data,{now:now()}),proof);
// The independent sentinel keeps strict freshness and public-only fields.
const fallback=await prefetchAiFinancialEvidence({
 now:sentinelAt,collector:writer,mode:'sentinel'});
assert.equal(fallback.ready,true);
assert.equal(fallback.artifactName,'ai-financial-evidence-sentinel-'+day);
assert.equal(fallback.data.captureMode,'SENTINEL_PUSH');
assert.deepEqual(verifyFinancialPrefetchArtifact(day,fallback.data,
 {now:sentinelAt()}),proof);
assert.equal(verifyFinancialPrefetchArtifact(day,
 {...fallback.data,capturedAt:'2026-11-08T22:39:00Z'},
 {now:new Date('2026-11-08T22:42:00Z')}),null);
assert.equal(verifyFinancialPrefetchArtifact(day,
 {...built.data,captureMode:'SENTINEL_PUSH'},
 {now:sentinelAt()}),null,'scheduled 06:20 time cannot impersonate sentinel');

// Artifact may be displayed only for this same KST trading day and same US
// completed regular session. A stale or mismatched copy is rejected.
const invalid=(mutate,options={})=>
 verifyFinancialPrefetchArtifact(day,mutate(structuredClone(built.data)),
  {now:now(),...options});
assert.equal(invalid(x=>({...x,date:'2026-11-06'})),null);
assert.equal(invalid(x=>({...x,capturedAt:'2026-11-09T12:00:00Z'})),null);
assert.equal(invalid(x=>({...x,source:'USER_PORTFOLIO_FILE'})),null);
assert.equal(invalid(x=>({...x,repository:'other/repo'})),null);
assert.equal(invalid(x=>{x.evidence.usSessionDate='2026-11-05';return x;}),null);
assert.equal(invalid(x=>{x.evidence.items[0].symbol='GOOGL';return x;}),null);
assert.equal(invalid(x=>{x.evidence.items[0].ttm.fcfUsd=999;return x;}),null);
assert.equal(invalid(x=>{x.evidence.items[0].ttm.period='2026-12-01';return x;}),null);
assert.equal(invalid(x=>{x.evidence.items[0].value.pbrTimes=-7;return x;}),null);
assert.equal(invalid(x=>{x.evidence.coverage.ttm=9;return x;}),null);
assert.equal(invalid(x=>{x.evidence.domestic[0].evidence={
 status:'INDICATIVE_MULTICLASS_BPS',period:'2026-08-31',
 filingDate:'2026-10-10',bpsKrw:50000,indicative:true,
 priceDate:'2026-11-09',pbrTimes:2.5
};return x;}),null);
assert.equal(verifyFinancialPrefetchArtifact(day,built.data,
 {now:new Date('2026-11-09T09:02:00Z')}),null, '18:02 KST expired');
assert.equal(verifyFinancialPrefetchArtifact(day,built.data,
 {now:new Date('2026-11-08T21:19:59Z')}),null, 'future artifact rejected');

const none=await prefetchAiFinancialEvidence({now,
 collector:async ()=>buildAiFinancialEvidence({
  asOfKst:day,usSessionDate,ttm:{},fyValues:{},dart:{}})});
assert.equal(none.ready,false);
assert.equal(none.status,'PUBLIC_EVIDENCE_UNVERIFIED');
const off=await prefetchAiFinancialEvidence({
 now:()=>new Date('2026-11-07T21:20:00Z'),
 collector:async()=>{throw Error('collector should not run on closed Sunday');}});
assert.equal(off.ready,false);
assert.equal(off.status,'MARKET_NOT_OPEN');
const timeout=await prefetchAiFinancialEvidence({
 now:(()=>{let i=0;return ()=>i++===0?now():new Date('2026-11-08T22:26:00Z');})(),
 collector:async()=>proof});
assert.equal(timeout.ready,false);
assert.equal(timeout.status,'PREFETCH_TOO_LATE');
assert.equal(proof.portfolioWrites,0);
assert.equal(proof.telegramSends,0);
assert.equal(proof.gasDeployments,0);
const wf=YAML.parse(fs.readFileSync('.github/workflows/ai-financial-evidence-prefetch.yml','utf8'));
assert.deepEqual(wf.on.push.paths,['ops/telegram-morning-arm-trigger.txt']);
assert.deepEqual(wf.on.push.branches,['main']);
assert.equal(wf.jobs.collect.steps.find(x=>x.id==='sentinel').if,"github.event_name == 'push'");
assert.ok(wf.jobs.collect.steps.find(x=>x.id==='sentinel').run.includes('NOT_EXACT_FILE'));
assert.match(wf.jobs.collect.steps.find(x=>x.id==='evidence').if,/sentinel.outputs.verified == 'true'/);
assert.equal(wf.jobs.collect.steps.find(x=>x.id==='evidence').env.FINANCIAL_SENTINEL_VERIFIED,
 '
+'{{ steps.sentinel.outputs.verified }}');
assert.equal(wf.jobs.collect.steps.find(x=>x.id==='evidence').env.SEC_USER_AGENT,
 '
+'{{ secrets.SEC_USER_AGENT }}');
assert.equal(wf.jobs.collect.steps.find(x=>x.id==='evidence').env.DART_API_KEY,
 '
+'{{ secrets.DART_API_KEY }}');
console.log('AI_FINANCIAL_PREFETCH_READONLY_PASS schedule/sentinel/source/FCF/PBR/failclosed');
