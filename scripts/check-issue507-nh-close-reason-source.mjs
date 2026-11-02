import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {proposeNhCloseReasonSource,APPROVED_GAS_BLOB} from './issue507-nh-close-reason-source-proposal.mjs';
import {buildIssue507LiveRelease} from './build-issue507-live-release.mjs';

// Test production 9.282 code verbatim, compare against pinned 9.281 behavior.
// Only synthetic dates and 37 synthetic codes. No production GAS/NH/Sheets.
const DAY='2026-10-30';
const items=Array.from({length:37},(_,i)=>({
 code:String(i+1).padStart(6,'0'),name:'PRIVATE_NAME',type:i%2?'ETF':'주식',
 currency:'KRW',market:'KR'
}));
function extract(source){
 const prefix='function fetchNhRegularCloses(items, requestedDate, options) {';
 const i=source.indexOf(prefix),j=source.indexOf('\n}',i);
 assert.ok(i>=0&&j>i);
 assert.equal(source.indexOf(prefix,i+1),-1);
 const fn=source.slice(i,j+2);
 assert.match(fn,/Date\.now\(\)-started>55000/);
 assert.match(fn,/Utilities\.sleep\(1000\)/);
 assert.match(fn,/view_main_yn:'Y'/);
 return fn;
}
function extractProductionTimezone(source){
 const configs=[...source.matchAll(/(?:^|\n)var CONFIG\s*=\s*\{([\s\S]*?)\n\};/g)];
 assert.equal(configs.length,1,'one production CONFIG block required');
 const zones=[...configs[0][1].matchAll(/(?:^|\n)\s*TIMEZONE\s*:\s*['"]([^'"]+)['"]/g)];
 assert.equal(zones.length,1,'one production timezone required');
 assert.equal(zones[0][1],'Asia/Seoul','production CONFIG.TIMEZONE must remain KST');
 return zones[0][1];
}
function simulate(fn,timezone,{latency=0,mode='OK',cacheHits=0,hasCredentials=true}={}){
 let clock=0,requests=0,sleeps=0,logs=[],cacheReads=0;
 const FakeDate=class extends Date {
  constructor(...args){super(...(args.length?args:['2026-10-31T02:00:00Z']));}
  static now(){return clock;}
 };
 const api=(_path,input)=>{
  requests++;clock+=latency;
  if(mode==='401')throw Error('NH_HTTP_401 KEY_PRIVATE');
  if(mode==='429')throw Error('NH_HTTP_429 KEY_PRIVATE');
  if(mode==='NETWORK')throw Error('NH_NETWORK_ERROR RESPONSE_PRIVATE');
  if(mode==='SCHEMA')return {Output_0:null};
  if(mode==='EMPTY')return {Output_0:[]};
  if(mode==='BAD_DATE')return {Output_0:[{bsop_date:'20261029',iem_cd:input.iem_cd,stck_clpr:'12345'}]};
  if(mode==='INVALID_PRICE')return {Output_0:[{bsop_date:'20261030',iem_cd:input.iem_cd,stck_clpr:'0'}]};
  if(mode==='IDENTITY')return {Output_0:[{bsop_date:'20261030',iem_cd:'XXXXXX',stck_clpr:'12345'}]};
  return {Output_0:[{bsop_date:'20261030',iem_cd:input.iem_cd,stck_clpr:'12345'}]};
 };
 const context={
  _issue507GateInside_:true,
  _nhCredentials_:()=>hasCredentials?{key:'KEY_PRIVATE',secret:'SECRET_PRIVATE'}:{key:'',secret:''},
  _nhCloseDate_:v=>v==='2026-10-30'||v==='20261030'?DAY:'2026-10-29',
  _isFundCode:()=>false,
  _isKrxDailyCloseTarget_:()=>true,
  _krxCalendarStatus_:()=> 'OPEN',
  Utilities:{
   formatDate:(date,tz,format)=>{
    assert.equal(tz,timezone,'collector must use production source timezone');
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
     timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',
     hour:'2-digit',minute:'2-digit',hourCycle:'h23'
    }).formatToParts(date).map(x=>[x.type,x.value]));
    if(format==='yyyy-MM-dd')return parts.year+'-'+parts.month+'-'+parts.day;
    if(format==='HHmm')return parts.hour+parts.minute;
    throw Error('unexpected date pattern');
   },
   sleep:ms=>{assert.equal(ms,1000);clock+=ms;sleeps++;}
  },
  CONFIG:{TIMEZONE:timezone},
  Date:FakeDate,
  Logger:{log:msg=>logs.push(String(msg))},
  CacheService:{getScriptCache:()=>({
   get:()=>++cacheReads<=cacheHits?
    JSON.stringify({price:12345,usedDate:DAY,marketDate:DAY,
      source:'NH_REGULAR_CLOSE',priceType:'REGULAR_CLOSE',status:'CONFIRMED'}):null,
   put:()=>{}
  })},
  _nhPost_:(_path,input)=>api(_path,input)
 };
 const result=vm.runInNewContext(fn+'\nfetchNhRegularCloses(items,date)',{
  ...context,items,date:DAY},{timeout:4000});
 return {results:Object.keys(result).length,requests,sleeps,logs,
   rawPrices:Object.values(result).map(x=>x.price)};
}
function oneReason(state,reason,expected){
 const [line]=state.logs;
 assert.equal(state.logs.length,1,'one summary log per invocation');
 assert.ok(line.startsWith('[NH_CLOSE_REASON_SUMMARY] '));
 const output=JSON.parse(line.slice('[NH_CLOSE_REASON_SUMMARY] '.length));
 assert.equal(output.mode,'NH_REGULAR_CLOSE_REASON_COUNTS');
 assert.equal(output.date,DAY);
 assert.equal(output.inputCount,37);
 assert.equal(output.returnedCount,state.results);
 assert.equal(output.reasons[reason],expected);
 assert.equal(output.containsRawProviderData,false);
 for(const forbidden of ['KEY_PRIVATE','SECRET_PRIVATE','RESPONSE_PRIVATE','PRIVATE_NAME','000001','12345','Output_0'])
  assert.ok(!line.includes(forbidden),'forbidden sensitive value in diagnostic');
 return output;
}
const pinnedSource=fs.readFileSync(fileURLToPath(
 new URL('../reference/gas-v9.281.gs',import.meta.url)),'utf8');
const pinned=extract(pinnedSource),pinnedZone=extractProductionTimezone(pinnedSource);
const runningGas=fs.readFileSync(fileURLToPath(
 new URL('../src/gas/apps_script.gs',import.meta.url)),'utf8');
const frozenGas=buildIssue507LiveRelease().source;
assert.equal(extract(runningGas),extract(frozenGas),
 '06:45 proxy-only source must preserve the original regular-close collector');
const candidateZone=extractProductionTimezone(frozenGas);
assert.equal(candidateZone,pinnedZone,'baseline and candidate production zones agree');
for(const source of [pinnedSource,frozenGas]){
 assert.throws(()=>extractProductionTimezone(source.replace(
  /TIMEZONE:\s*'Asia\/Seoul'/,"TIMEZONE: 'Etc/UTC'")),
  /production CONFIG.TIMEZONE must remain KST/);
}
const boundary=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
 timeZone:candidateZone,year:'numeric',month:'2-digit',day:'2-digit'
}).formatToParts(new Date('2026-10-30T15:10:00Z')).map(x=>[x.type,x.value]));
assert.deepEqual([boundary.year,boundary.month,boundary.day],['2026','10','31']);
const proposal=proposeNhCloseReasonSource(frozenGas);
const candidate=extract(proposal);
assert.notEqual(proposal,frozenGas,'proposal must be separate from frozen candidate');
assert.doesNotMatch(extract(frozenGas),/NH_CLOSE_REASON_SUMMARY/,
 'immutable GAS source must remain free of the pending telemetry');
assert.doesNotMatch(pinned,/NH_CLOSE_REASON_SUMMARY/);
assert.match(candidate,/NH_CLOSE_REASON_SUMMARY/);
const scenarios=[
 [{latency:400},'EXACT_DATE_CONFIRMED',37,37],
 [{latency:700},'BUDGET_EXCEEDED',4,33],
 [{mode:'401'},'AUTH_BLOCKED',1,0],
 [{mode:'429'},'RATE_LIMITED',1,0],
 [{mode:'NETWORK'},'NETWORK_ERROR',37,0],
 [{mode:'EMPTY'},'OUTPUT_EMPTY',37,0],
 [{mode:'BAD_DATE'},'DATE_MISMATCH',37,0],
 [{mode:'SCHEMA'},'SCHEMA_INVALID',37,0],
 [{mode:'INVALID_PRICE'},'INVALID_PRICE',37,0],
 [{mode:'IDENTITY'},'IDENTITY_MISMATCH',37,0],
 [{cacheHits:37,latency:400},'CACHE_HIT',37,37],
 [{hasCredentials:false},'CREDENTIALS_MISSING',1,0]
];
const checks=[];
for(const [scenario,reason,expected,count] of scenarios){
 const before=simulate(pinned,pinnedZone,scenario),after=simulate(candidate,candidateZone,scenario);
 assert.equal(after.results,count,reason);
 assert.deepEqual(after.rawPrices,before.rawPrices,reason+' must preserve prices');
 assert.equal(after.requests,before.requests,reason+' must preserve call count');
 assert.equal(after.sleeps,before.sleeps,reason+' must preserve pacing');
 assert.equal(before.logs.length,0,'9.281 must remain untouched');
 const summary=oneReason(after,reason,expected);
 if(reason==='BUDGET_EXCEEDED')assert.equal(summary.reasons.EXACT_DATE_CONFIRMED,33);
 if(reason==='AUTH_BLOCKED'||reason==='RATE_LIMITED')
  assert.equal(summary.reasons.PRIOR_AUTH_BLOCKED,36);
 checks.push({reason,observed:expected,returned:count});
}
const out={mode:'ISSUE507_NH_CLOSE_REASON_SOURCE_REGRESSION',result:'PASS',
 scenarios:checks,productionVersion:'9.282',baseline:'9.281',sourceTimezone:candidateZone,
 productionSourceModified:false,proposalOnly:true,frozenSourceSha:APPROVED_GAS_BLOB,
 operationalReleasePerformed:false,
 credentialsUsed:false,nhTokenRequested:false,externalCalls:0,financialWrites:0};
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 console.log(JSON.stringify(out));
