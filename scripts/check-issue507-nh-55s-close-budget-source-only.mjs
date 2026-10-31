// Issue #507: exercise the actual pinned GAS NH close collector offline.
// No credentials, API, GAS endpoint, sheet, prices, or finance writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {pathToFileURL} from 'node:url';

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
function emulate(fn,{requestLatencyMs=0,provider='OK',cacheHits=0,credentials=true}={}){
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
   formatDate:(_d,_tz,pattern)=>pattern==='yyyy-MM-dd'?'2026-10-31':'12:00',
   sleep:ms=>{assert.equal(ms,WAIT_MS);sleeps++;clock+=ms;}
  },
  CONFIG:{TIMEZONE:'Asia/Seoul'},
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
  '../src/gas/apps_script.gs',
 ];
 const output=[];
 for(const relative of sources){
  const source=fs.readFileSync(fileURLToPath(new URL(relative,import.meta.url)),'utf8');
  const fn=extractCollector(source);
  const fast=emulate(fn,{requestLatencyMs:400});
  assert.deepEqual([fast.results,fast.requests,fast.sleeps],[37,37,37],
   '400ms latency must permit all 37 requests');
  const slow=emulate(fn,{requestLatencyMs:700});
  assert.equal(slow.requests,33,'700ms latency silently skips last four positions');
  assert.equal(slow.results,33);
  const auth=emulate(fn,{provider:'AUTH_FAIL'});
  assert.deepEqual([auth.requests,auth.results],[1,0],
   'first 401 silently blocks remaining 36 positions');
  const limited=emulate(fn,{provider:'RATE_LIMIT'});
  assert.deepEqual([limited.requests,limited.results],[1,0],
   'first 429 silently blocks remaining 36 positions');
  const empty=emulate(fn,{provider:'EMPTY'});
  assert.deepEqual([empty.requests,empty.results],[37,0]);
  const wrongDate=emulate(fn,{provider:'BAD_DATE'});
  assert.deepEqual([wrongDate.requests,wrongDate.results],[37,0]);
  const noCredentials=emulate(fn,{credentials:false});
  assert.deepEqual([noCredentials.requests,noCredentials.results],[0,0]);
  const hit=emulate(fn,{requestLatencyMs:400,cacheHits:37});
  assert.deepEqual([hit.requests,hit.results,hit.sleeps],[0,37,0],
   'cached bars need no extra NH calls or pacing');
  output.push({version:relative.includes('v9.281')?'9.281':'9.282',
   expectedHeldCodes:CODE_COUNT,waitPerUncachedMs:WAIT_MS,budgetMs:BUDGET_MS,
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
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 console.log(JSON.stringify(auditBudgetSources()));
}
