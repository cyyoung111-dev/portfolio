// Issue #507: exercise the actual pinned GAS NH close collector offline.
// No credentials, API, GAS endpoint, sheet, prices, or finance writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {pathToFileURL} from 'node:url';
import {proposeNhDomesticCloseBatching} from './nh-domestic-close-batching-proposal.mjs';
import {proposeNhDomesticCloseFullCoverage} from './nh-domestic-close-full-coverage-proposal.mjs';

const CODE_COUNT=37,DATE='2026-10-30',BUDGET_MS=55000,WAIT_MS=1000;
const target=Array.from({length:CODE_COUNT},(_,i)=>({code:String(i+1).padStart(6,'0'),
 currency:'KRW',market:'KR',type:i%3===0?'주식':'ETF'}));

function extractCollector(source){
 const token='function fetchNhRegularCloses(';
 const first=source.indexOf(token);
 assert.ok(first>=0&&source.indexOf(token,first+token.length)===-1,'unique production function');
 const finish=source.indexOf('\n}',first);
 assert.ok(finish>first,'function end');
 const fn=source.slice(first,finish+2);
 assert.match(fn,/Date\.now\(\)-started>55000/,'55s budget not silently changed');
 assert.match(fn,/Utilities\.sleep\(1000\)/,'1s pacing not silently changed');
 assert.match(fn,/view_main_yn:'Y'/,'NH domestic regular-session bar required');
 assert.match(fn,/\/krstock\/quote\/v1\/currentDaily/);
 assert.match(fn,/source:'NH_REGULAR_CLOSE'/);
 return fn;
}
function extractProductionTimezone(source){
 // Read each production source's CONFIG, not an independent test-only zone.
 const blocks=[...source.matchAll(/(?:^|\n)var CONFIG\s*=\s*\{([\s\S]*?)\n\};/g)];
 assert.equal(blocks.length,1,'exactly one production CONFIG block');
 const matches=[...blocks[0][1].matchAll(/(?:^|\n)\s*TIMEZONE\s*:\s*['"]([^'"]+)['"]/g)];
 assert.equal(matches.length,1,'exactly one production CONFIG.TIMEZONE');
 assert.equal(matches[0][1],'Asia/Seoul','production CONFIG.TIMEZONE must be Asia/Seoul');
 return matches[0][1];
}
function emulate(fn,timezone,{requestLatencyMs=0,provider='OK',cacheHits=0,credentials=true}={}){
 let clock=0,requests=0,sleeps=0,cacheCalls=0;
 const Clock=class extends Date{
  constructor(...args){super(...(args.length?args:['2026-10-31T04:00:00.000Z']));}
  static now(){return clock;}
 };
 const ctx={
  Date:Clock,
  _nhCredentials_:()=>credentials?{key:'SYNTHETIC_KEY',secret:'SYNTHETIC_SECRET'}:{key:'',secret:''},
  _nhCloseDate_:raw=>['20261030','2026-10-30'].includes(String(raw))?'2026-10-30':'',
  _isFundCode:()=>false,
  _isKrxDailyCloseTarget_:()=>true,
  _krxCalendarStatus_:()=> 'OPEN',
  Utilities:{
   formatDate:(date,tz,pattern)=>{
    assert.equal(tz,timezone,'collector must use production CONFIG.TIMEZONE');
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
     timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',
     hour:'2-digit',minute:'2-digit',hourCycle:'h23'
    }).formatToParts(date).map(x=>[x.type,x.value]));
    if(pattern==='yyyy-MM-dd')return p.year+'-'+p.month+'-'+p.day;
    if(pattern==='HHmm')return p.hour+p.minute;
    throw Error('unexpected GAS date pattern');
   },
   sleep:ms=>{assert.equal(ms,WAIT_MS);sleeps++;clock+=ms;}
  },
  CONFIG:{TIMEZONE:timezone},
  CacheService:{getScriptCache:()=>({
   get:()=>++cacheCalls<=cacheHits?
    JSON.stringify({price:12345,usedDate:DATE,source:'NH_REGULAR_CLOSE',
      status:'CONFIRMED',priceType:'REGULAR_CLOSE',marketDate:DATE}):null,
   put:()=>{}
  })},
  _nhPost_:(path,body,_creds)=>{
   assert.equal(path,'/krstock/quote/v1/currentDaily');
   assert.equal(body.view_main_yn,'Y');
   assert.equal(body.array_cnt,'200');
   requests++;clock+=requestLatencyMs;
   if(provider==='AUTH_FAIL')throw Error('NH_HTTP_401');
   if(provider==='RATE_LIMIT')throw Error('NH_HTTP_429');
   if(provider==='EMPTY')return {Output_0:[]};
   if(provider==='BAD_DATE')return {Output_0:[{iem_cd:body.iem_cd,bsop_date:'20261029',stck_clpr:'12345'}]};
   return {Output_0:[{iem_cd:body.iem_cd,bsop_date:'20261030',stck_clpr:'12345'}]};
  },
 };
 const r=vm.runInNewContext(fn+'\nfetchNhRegularCloses(items,requestDate)',
  {...ctx,items:target,requestDate:DATE},{timeout:5000});
 return {results:Object.keys(r).length,requests,sleeps,elapsedMs:clock,cacheCalls};
}
export function auditBudgetSources(){
 const sources=[
  '../reference/gas-v9.281.gs',
  '../reference/gas-v9.282.gs',
 ];
 const output=[];
 for(const relative of sources){
  const source=fs.readFileSync(fileURLToPath(new URL(relative,import.meta.url)),'utf8');
  const fn=extractCollector(source);
  const timezone=extractProductionTimezone(source);
  // Mutation must fail: a silently changed source timezone is not allowed.
  assert.throws(()=>extractProductionTimezone(source.replace(
   /TIMEZONE:\s*'Asia\/Seoul'/,"TIMEZONE: 'Etc/UTC'")),
   /production CONFIG.TIMEZONE must be Asia\/Seoul/);
  const nearBoundary=new Date('2026-10-30T15:10:00Z');
  const inSourceZone=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
   timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(nearBoundary).map(x=>[x.type,x.value]));
  assert.deepEqual([inSourceZone.year,inSourceZone.month,inSourceZone.day],
   ['2026','10','31'],'cross-UTC-midnight must be next KST day');
  const fast=emulate(fn,timezone,{requestLatencyMs:400});
  assert.deepEqual([fast.results,fast.requests,fast.sleeps],[37,37,37],
   '400ms latency must permit all 37 requests');
  const slow=emulate(fn,timezone,{requestLatencyMs:700});
  assert.equal(slow.requests,33,'700ms latency silently skips last four positions');
  assert.equal(slow.results,33);
  const auth=emulate(fn,timezone,{provider:'AUTH_FAIL'});
  assert.deepEqual([auth.requests,auth.results],[1,0],
   'first 401 silently blocks remaining 36 positions');
  const limited=emulate(fn,timezone,{provider:'RATE_LIMIT'});
  assert.deepEqual([limited.requests,limited.results],[1,0],
   'first 429 silently blocks remaining 36 positions');
  const empty=emulate(fn,timezone,{provider:'EMPTY'});
  assert.deepEqual([empty.requests,empty.results],[37,0]);
  const wrongDate=emulate(fn,timezone,{provider:'BAD_DATE'});
  assert.deepEqual([wrongDate.requests,wrongDate.results],[37,0]);
  const noCredentials=emulate(fn,timezone,{credentials:false});
  assert.deepEqual([noCredentials.requests,noCredentials.results],[0,0]);
  const hit=emulate(fn,timezone,{requestLatencyMs:400,cacheHits:37});
  assert.deepEqual([hit.requests,hit.results,hit.sleeps],[0,37,0],
   'cached bars need no extra NH calls or pacing');
  output.push({version:relative.includes('v9.281')?'9.281':'9.282',
   expectedHeldCodes:CODE_COUNT,sourceTimezone:timezone,waitPerUncachedMs:WAIT_MS,budgetMs:BUDGET_MS,
   fast400msResults:fast.results,slow700msRequests:slow.requests,
   slow700msSkipped:CODE_COUNT-slow.results,first401Requests:auth.requests,
   first401Results:auth.results,first429Results:limited.results,
   emptyPayloadResults:empty.results,wrongDateResults:wrongDate.results,
   noCredentialsRequests:noCredentials.requests,cacheFullyHitRequests:hit.requests,
   operationalHistoricalCause:'NOT_PROVEN',
   officialCloseIndependentlyVerified:false,
   nhTokensRequested:0,externalCalls:0,financialWrites:0});
 }
 return {mode:'ISSUE507_NH_CLOSE_BUDGET_SOURCE_ONLY',results:output,
   heldCodeCoverageEvidence:'SYNTHETIC_37_CODES',
   historicalActualCause:'UNKNOWN',
   productionDataChanged:false};
}
// Source-only candidate: the immutable GAS v9.282 blob remains unchanged.
{
 const original=fs.readFileSync('reference/gas-v9.282.gs','utf8');
 const proposed=proposeNhDomesticCloseBatching(original);
 assert.notEqual(proposed.candidateSha,proposed.baseSha);
 assert.equal(proposed.changedFunction,'fetchDomesticRegularCloses');
 assert.equal(proposed.gasDeployed,false);
 assert.equal(proposed.financialWritesAdded,false);
 assert.throws(()=>proposeNhDomesticCloseBatching(original+' '),/BASE_GAS_BLOB_MISMATCH/);
 const held=Array.from({length:37},(_,i)=>({
   code:String(900000+i),currency:'KRW',market:'KRX',type:i%2?'ETF':'주식'
 }));
 function simulate(code,missOne=false){
   const start=code.indexOf('function fetchDomesticRegularCloses(');
   const end=code.indexOf(String.fromCharCode(10)+'}',start);
   assert.ok(start>=0&&end>start,'domestic aggregator extraction');
   const calls=[],fallbacks=[],logs=[];
   const ctx=vm.createContext({
     Date:{now:()=>10000},Logger:{log:line=>logs.push(line)},
     fetchNhRegularCloses:(items,date)=>{
       calls.push(items.length);
       // A single 37-code read can only return its first 32 NH bars
       // within the synthetic 55-second/1-second-paced provider window.
       const accepted=items.slice(0,32).filter(item=>!missOne||item.code!=='900012');
       return Object.fromEntries(accepted.map(item=>[item.code,{
         price:100,marketDate:date,usedDate:date,source:'NH_REGULAR_CLOSE',
         currency:'KRW',priceType:'REGULAR_CLOSE',status:'CONFIRMED'
       }]));
     },
     fetchPricesKrx:items=>{
       fallbacks.push(items.length);
       return Object.fromEntries(items.map(item=>[item.code,{
         price:101,usedDate:'2026-10-30',source:'KRX_OTP'
       }]));
     }
   });
   vm.runInContext(code.slice(start,end+2),ctx);
   const result=ctx.fetchDomesticRegularCloses(held,DATE);
   return {calls,fallbacks,logs,
     nh:Object.values(result).filter(x=>x.source==='NH_REGULAR_CLOSE').length,
     krx:Object.values(result).filter(x=>x.source==='KRX_OTP').length};
 }
 const before=simulate(original);
 assert.deepEqual(before.calls,[37]);
 assert.equal(before.nh,32);assert.equal(before.krx,5);
 const after=simulate(proposed.candidate);
 assert.deepEqual(after.calls,[12,12,12,1]);
 assert.equal(after.nh,37);assert.equal(after.krx,0);
 assert.equal(after.fallbacks.length,0);
 assert.equal(after.logs.length,1);
 const receipt=JSON.parse(after.logs[0].slice('[NH_CLOSE_BATCH_COVERAGE] '.length));
 assert.equal(receipt.verified,37);assert.equal(receipt.batches,4);
 assert.ok(!after.logs[0].includes('900000'),'no held code in summary');
 const missing=simulate(proposed.candidate,true);
 assert.equal(missing.nh,36);assert.equal(missing.krx,1);
 assert.deepEqual(missing.fallbacks,[1]);
}


{
 const original=fs.readFileSync('reference/gas-v9.282.gs','utf8');
 const next=proposeNhDomesticCloseFullCoverage(original);
 assert.equal(next.gasDeployed,false);
 assert.equal(next.sourceOnly,true);
 assert.equal(next.financialWritesAdded,false);
 assert.equal(next.regularSessionRequiresFullCloseCoverage,true);
 assert.equal(next.krxHolidayCarryPolicyUnchanged,true);
 assert.notEqual(next.candidateSha,next.baseSha);
 assert.deepEqual(next.modifiedFunctions,
  ['fetchDomesticRegularCloses','saveDailyPriceHistory']);
 assert.throws(()=>proposeNhDomesticCloseFullCoverage(original+' '),
  /BASE_GAS_BLOB_MISMATCH/);
 // Extract the real policy expression, not a separately reimplemented test.
 function coverageRule(source) {
  const marker='var closeVerification = _assessDailyKrxStockClose(items, krxPrev, requestedCloseDate);';
  const start=source.indexOf(marker);
  const stopMarker="throw new Error('TARGET_EXACT_KRX_INCOMPLETE');";
  const stop=source.indexOf(stopMarker,start);
  assert.ok(start>=0&&stop>start&&stop-start<1200,'exact acceptance rule');
  return source.slice(start,stop+stopMarker.length)
    .replace(marker,'var closeVerification = report;');
 }
 const before=coverageRule(original),after=coverageRule(next.candidate);
 function run(rule,{closed=false,expected=37,confirmed=37,required=true,
   actualDate=DATE,requireAllKrx=false}={}) {
  vm.runInNewContext(rule,{
   report:{required,expected,confirmed,date:actualDate},
   options:{requireAllKrx},
   requestedCloseDate:DATE,
   _krxCalendarStatus_:()=>closed?'CLOSED':'OPEN'
  });
 }
 // Baseline can accept 36/37 under the 70% group threshold.
 assert.doesNotThrow(()=>run(before,{confirmed:36}));
 // The release candidate cannot declare normal-day success without 37/37.
 assert.throws(()=>run(after,{confirmed:36}),/TARGET_EXACT_KRX_INCOMPLETE/);
 assert.throws(()=>run(after,{confirmed:0}),/TARGET_EXACT_KRX_INCOMPLETE/);
 assert.throws(()=>run(after,{actualDate:'2026-10-29'}),/TARGET_EXACT_KRX_INCOMPLETE/);
 assert.doesNotThrow(()=>run(after,{confirmed:37}));
 // No domestic holdings and Korean closed-day carried closes are not blocked.
 assert.doesNotThrow(()=>run(after,{required:false,expected:0,confirmed:0}));
 assert.doesNotThrow(()=>run(after,{closed:true,confirmed:36,actualDate:'2026-10-29'}));
 // An explicit strict historical-recovery request remains strict on holidays.
 assert.throws(()=>run(after,{closed:true,confirmed:36,
   actualDate:'2026-10-29',requireAllKrx:true}),/TARGET_EXACT_KRX_INCOMPLETE/);
}


{
 // P1 integration: execute the actual pinned/candidate GAS writer and close
 // assessor, not just the conditional snippet. All services are synthetic.
 const original=fs.readFileSync('reference/gas-v9.282.gs','utf8');
 const proposed=proposeNhDomesticCloseFullCoverage(original).candidate;
 function extractReal(source,name) {
   const token='function '+name+'(';
   const first=source.indexOf(token);
   assert.ok(first>=0&&source.indexOf(token,first+token.length)===-1,
     name+' must be unique in the GAS source');
   const end=source.indexOf('\n}',first);
   assert.ok(end>first,name+' body must be extractable');
   return source.slice(first,end+2);
 }
 function executeWriter(source,{nhCount=37,wrongDate=false}={}) {
   const items=Array.from({length:37},(_,i)=>({
     code:String(900000+i),name:'synthetic held ETF',market:'ETF',
     currency:'KRW',type:'ETF'
   }));
   const requested='2026-10-30',pending='portfolio_close_pending_krx_dates';
   const propsData=new Map([[pending,JSON.stringify(['2026-10-29'])]]);
   const counters={priceWrites:0,snapshotWrites:0,successMarkers:0,
     queued:0,flushes:0,acquire:0,release:0};
   const nhChunks=[],fallbacks=[];
   const props={
     getProperty:k=>propsData.has(k)?propsData.get(k):null,
     setProperty:(k,v)=>{
       propsData.set(k,String(v));
       if(k==='snapshot_last_success_date')counters.successMarkers++;
       if(k===pending)counters.queued++;
     },
     deleteProperty:k=>propsData.delete(k)
   };
   const ctx=vm.createContext({
     Date,JSON,Number,String,isFinite,
     CONFIG:{TIMEZONE:'Asia/Seoul'},_snapshotBackupOperationId:'',
     PORTFOLIO_CLOSE_PENDING_KRX_DATES_KEY:pending,
     PropertiesService:{getScriptProperties:()=>props},
     LockService:{getScriptLock:()=>({waitLock(){counters.acquire++;},
       releaseLock(){counters.release++;}})},
     SpreadsheetApp:{flush(){counters.flushes++;}},
     Utilities:{formatDate:()=> '2026-10-30 19:33:30',getUuid:()=> 'synthetic-uuid'},
     Logger:{log(){}},
     today:()=>requested,getss:()=>({}),
     _normalizeDate:v=>String(v||''),_cleanCode:v=>String(v||'').trim(),
     _isFundCode:v=>/^F\d{5}$/.test(String(v||'')),
     getCodeItems:()=>items,_getDailyHeldCodeItems:()=>items,
     _seedMissingKrxCloseDates_:()=>{},
     _krxCalendarStatus_:()=> 'OPEN',_countBusinessWeekdaysBetween:()=>0,
     _verifyForeignDailyCloseCoverage_:()=>{},_latestConfirmedForeignCloseDate_:()=> '',
     fetchNhRegularCloses:(chunk,date)=>{
       nhChunks.push(chunk.length);
       return Object.fromEntries(chunk.filter(item=>
         Number(item.code)-900000<nhCount).map(item=>[item.code,{
           price:100,usedDate:wrongDate?'2026-10-29':date,
           marketDate:wrongDate?'2026-10-29':date,
           source:'NH_REGULAR_CLOSE',priceType:'REGULAR_CLOSE',
           status:'CONFIRMED',currency:'KRW'
         }]));
     },
     fetchPricesKrx:(missing)=>{fallbacks.push(missing.length);return {};},
     fetchPricesGoogleFinance:()=>({}),
     _hasKrxHoldingsForCloseDate_:()=>true,
     _buildSnapshotRowsFromTradeAndPriceHistory:()=>Array.from({length:39},
       (_,i)=>[requested,i<37?items[i].code:'F'+String(i).padStart(5,'0')]),
     _readSnapshotRowsByDate:()=>[],
     _snapshotRewritePlan:()=>({unsafe:[],needsRewrite:true}),
     writeSnapshotRows:()=>{counters.snapshotWrites++;},
     _settleSnapshotBackupOperation:()=>{},
     diagnoseSnapshotIntegrity:()=>({status:'VALID'}),
     batchUpsertPriceHistory:()=>{counters.priceWrites++;}
   });
   for(const name of ['_isKrxDailyCloseTarget_',
     '_assertSupportedDailyCloseMarkets_','_isConfirmedHistoryPrice_',
     '_assessDailyKrxStockClose','_selectPortfolioCloseSnapshotDate_',
     '_readPendingKrxCloseDates_','_enqueuePendingKrxCloseDate_',
     'fetchDomesticRegularCloses','saveDailyPriceHistory']) {
     vm.runInContext(extractReal(source,name),ctx);
   }
   let result=null,error=null;
   try {result=ctx.saveDailyPriceHistory(undefined,{deferQueueCompletion:true});}
   catch(e){error=String(e.message||e);}
   return {result,error,nhChunks,fallbacks,counters,
     pendingDates:JSON.parse(propsData.get(pending)),failureMarker:propsData.has('snapshot_last_error'),
     successDate:propsData.get('snapshot_last_success_date')||''};
 }
 const oldPartial=executeWriter(original,{nhCount:36});
 assert.equal(oldPartial.error,null,'baseline 36/37 reaches false success path');
 assert.equal(oldPartial.counters.priceWrites,1);
 assert.equal(oldPartial.counters.snapshotWrites,1);
 assert.equal(oldPartial.counters.successMarkers,1);
 const partial=executeWriter(proposed,{nhCount:36});
 assert.match(partial.error||'',/TARGET_EXACT_KRX_INCOMPLETE/);
 assert.deepEqual(partial.nhChunks,[12,12,12,1]);
 assert.deepEqual(partial.fallbacks,[1]);
 assert.equal(partial.counters.priceWrites,0,'partial close cannot be persisted');
 assert.equal(partial.counters.snapshotWrites,0,'partial close cannot rewrite Snapshot');
 assert.equal(partial.counters.successMarkers,0,'partial close cannot set success receipt');
 assert.equal(partial.failureMarker,true);
 assert.deepEqual(partial.pendingDates,['2026-10-29','2026-10-30'],
   'failed current day must be enqueued without dropping an older pending day');
 assert.equal(partial.counters.acquire,1);
 assert.equal(partial.counters.release,1);
 for(const [name,settings] of [
   ['empty',{nhCount:0}],['stale',{nhCount:37,wrongDate:true}]
 ]) {
   const failed=executeWriter(proposed,settings);
   assert.ok(failed.error,name+' must not be accepted as exact date');
   assert.equal(failed.counters.priceWrites,0);
   assert.equal(failed.counters.snapshotWrites,0);
   assert.equal(failed.counters.successMarkers,0);
   assert.deepEqual(failed.pendingDates,['2026-10-29','2026-10-30']);
 }
 const full=executeWriter(proposed,{nhCount:37});
 assert.equal(full.error,null,'complete 37/37 must still succeed');
 assert.equal(full.result?.ok,true);
 assert.equal(full.result?.rows,39);
 assert.deepEqual(full.nhChunks,[12,12,12,1]);
 assert.equal(full.counters.priceWrites,1);
 assert.equal(full.counters.snapshotWrites,1);
 assert.equal(full.counters.successMarkers,1);
 assert.equal(full.successDate,'2026-10-30');
 assert.equal(full.failureMarker,false);
 assert.deepEqual(full.pendingDates,['2026-10-29'],
   'a successful deferred writer must not erase historical queued dates');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 console.log(JSON.stringify(auditBudgetSources()));
}
