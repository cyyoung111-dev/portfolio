import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';

const gas = process.argv.includes('--baseline-cache')
  ? execFileSync('git',['show','a1148f4:src/gas/apps_script.gs'],{encoding:'utf8'})
  : process.argv.includes('--baseline')
  ? execFileSync('git',['show','5dab55f:src/gas/apps_script.gs'],{encoding:'utf8'})
  : isolateGasBusinessLogic(fs.readFileSync('src/gas/apps_script.gs', 'utf8'));
const ctx = vm.createContext({ console, Date, JSON, Number, String, Math, isFinite, encodeURIComponent });
new vm.Script(gas, {filename:'apps_script.gs'}).runInContext(ctx);
ctx.CONFIG = {TIMEZONE:'UTC'};
ctx.Utilities = {formatDate:(date,zone,format) => {
  const iso=new Date(date).toISOString();
  if (format==='HHmm') return iso.slice(11,16).replace(':','');
  if (format==='yyyyMMdd') return iso.slice(0,10).replaceAll('-','');
  return iso.slice(0,10);
}};
ctx.Logger = {log:()=>{}};
ctx._getKrxAuthKeySlots_ = () => ({key:'bad-primary',alternative:'approved-alternative'});
let cacheWrites=0,dayCacheWrites=0;
function resetCache() {
  cacheWrites=0;
  dayCacheWrites=0;
  const cache=new Map();
  ctx.CacheService={getScriptCache:()=>({get:key=>cache.get(key)||null,
    getAll:keys=>Object.fromEntries(keys.filter(k=>cache.has(k)).map(k=>[k,cache.get(k)])),
    putAll:items=>{dayCacheWrites++;Object.entries(items).forEach(([k,v])=>cache.set(k,v));},
    put:(k,v)=>{cacheWrites++;cache.set(k,v);}})};
}
function http(code,rows) {
  return {getResponseCode:()=>code,getContentText:()=>JSON.stringify({OutBlock_1:rows||[]})};
}
const night=[{BAS_DD:'20261008',MKT_NM:'야간',PROD_NM:'코스피200 선물',
  ISU_NM:'코스피200 F 202610 (야간)',TDD_CLSPRC:'351.25'}];
const now=new Date('2026-10-08T06:15:00Z');
let calls=[];
const normalizedCalls=()=>JSON.parse(JSON.stringify(calls));
ctx.UrlFetchApp={fetch:(url,opt)=>{
  calls.push({url,key:opt.headers.AUTH_KEY});
  return opt.headers.AUTH_KEY==='bad-primary'?http(401):http(200,night);
}};
const recoveredNight=ctx.fetchKrxK200NightClose('2026-10-08',now);
assert.equal(recoveredNight?.value,351.25);
assert.equal(recoveredNight?.status,'FINAL');
assert.equal(recoveredNight?.sourceDate,'2026-10-08');
assert.deepEqual(calls.map(x=>x.key),['bad-primary','approved-alternative']);
assert.ok(calls.every(x=>x.url.includes('basDd=20261008')));

calls=[];
ctx.UrlFetchApp={fetch:(url,opt)=>{calls.push(opt.headers.AUTH_KEY);return http(200,night);}};
assert.equal(ctx.fetchKrxK200NightClose('2026-10-08',now)?.value,351.25);
assert.deepEqual(normalizedCalls(),['bad-primary'],'successful primary must not invoke a second key');

calls=[];
ctx.UrlFetchApp={fetch:(url,opt)=>{calls.push(opt.headers.AUTH_KEY);return http(opt.headers.AUTH_KEY==='bad-primary'?401:403);}};
assert.throws(()=>ctx.fetchKrxK200NightClose('2026-10-08',now),/PRIMARY_HTTP_401_ALTERNATE_HTTP_403/);
assert.deepEqual(normalizedCalls(),['bad-primary','approved-alternative']);

calls=[];
ctx.UrlFetchApp={fetch:(url,opt)=>{calls.push(opt.headers.AUTH_KEY);return http(200,[]);}};
assert.equal(ctx.fetchKrxK200NightClose('2026-10-08',now),null,'empty trading session not FINAL');
assert.deepEqual(normalizedCalls(),['bad-primary'],'HTTP 200 empty cannot trigger credential fallback');
assert.equal(ctx.fetchKrxK200NightClose('2026-10-08',new Date('2026-10-08T05:59:59Z')),null);

const vkospi=(day,close='26.52')=>[{BAS_DD:day,IDX_NM:'코스피 200 변동성지수',CLSPRC_IDX:close}];
resetCache();
calls=[];
ctx.UrlFetchApp={fetchAll:requests=>{
  calls.push(requests.map(x=>x.headers.AUTH_KEY));
  return requests.map(x=>http(x.headers.AUTH_KEY==='bad-primary'?401:200,
    x.headers.AUTH_KEY==='bad-primary'?[]:vkospi(new URL(x.url).searchParams.get('basDd'))));
}};
const recoveredVol=ctx._readVkospiPointsFromKrx('2026-10-08','2026-10-08');
assert.equal(recoveredVol.length,1);
assert.equal(recoveredVol[0].date,'2026-10-08');
assert.equal(recoveredVol[0].value,26.52);
assert.deepEqual(normalizedCalls(),[['bad-primary'],['approved-alternative']]);

resetCache();calls=[];
ctx.UrlFetchApp={fetchAll:requests=>{
  calls.push(requests.map(x=>x.headers.AUTH_KEY));
  return requests.map(x=>{
    const day=new URL(x.url).searchParams.get('basDd');
    if(x.headers.AUTH_KEY==='bad-primary')return day==='20261008'?http(401):http(200,vkospi(day,'24.50'));
    return http(200,vkospi(day,'26.52'));
  });
}};
const mixed=ctx._readVkospiPointsFromKrx('2026-10-07','2026-10-08');
assert.deepEqual(Array.from(mixed,x=>x.date),['2026-10-07','2026-10-08']);
assert.deepEqual(Array.from(mixed,x=>x.value),[24.5,26.52]);
assert.deepEqual(normalizedCalls().map(x=>x.length),[2,1],'only denied date should be retried');

resetCache();calls=[];
ctx.UrlFetchApp={fetchAll:requests=>{
  calls.push(requests.map(x=>x.headers.AUTH_KEY));
  return requests.map(x=>http(x.headers.AUTH_KEY==='bad-primary'?401:403));
}};
assert.throws(()=>ctx._readVkospiPointsFromKrx('2026-10-08','2026-10-08'),/AUTH_KEY/);
assert.deepEqual(normalizedCalls(),[['bad-primary'],['approved-alternative']]);

resetCache();calls=[];
ctx.UrlFetchApp={fetchAll:requests=>{
  calls.push(requests.map(x=>x.headers.AUTH_KEY));
  return requests.map(()=>http(200,[]));
}};
assert.equal(ctx._readVkospiPointsFromKrx('2026-10-08','2026-10-08').length,0);
assert.deepEqual(normalizedCalls(),[['bad-primary']],'HTTP 200 empty must not cause fallback');

resetCache();
ctx.UrlFetchApp={fetchAll:requests=>requests.map(()=>http(200,vkospi('20261007')))};
assert.equal(ctx._readVkospiPointsFromKrx('2026-10-08','2026-10-08').length,0,
  'response from a different trading date must not be relabeled as requested date');

for(const alternateFailure of [403,500,'network']) {
  resetCache();calls=[];
  ctx.UrlFetchApp={fetchAll:requests=>{
    calls.push(requests.map(x=>x.headers.AUTH_KEY));
    if(requests[0].headers.AUTH_KEY==='approved-alternative' && alternateFailure==='network') throw Error('network');
    return requests.map(x=>{
      const day=new URL(x.url).searchParams.get('basDd');
      if(x.headers.AUTH_KEY==='approved-alternative') return http(alternateFailure);
      return day==='20261008'?http(401):http(200,vkospi(day,'24.50'));
    });
  }};
  const partial=ctx._readVkospiPointsFromKrx('2026-10-07','2026-10-08');
  assert.deepEqual(Array.from(partial,x=>[x.date,x.value]),[['2026-10-07',24.50]],
    'secondary failure must preserve primary successful dates');
  assert.equal(cacheWrites,0,'partial auth failures must not suppress future retry through caching');
  ctx.UrlFetchApp={fetchAll:requests=>{
    calls.push(requests.map(x=>x.headers.AUTH_KEY));
    return requests.map(x=>http(200,vkospi(new URL(x.url).searchParams.get('basDd'))));
  }};
  assert.equal(ctx._readVkospiPointsFromKrx('2026-10-07','2026-10-08').length,2);
  assert.equal(cacheWrites,1,'a later complete successful result may be cached');
}
// Model: an HTTP response is a candidate; only a valid point on each requested
// date permits a complete-range cache. Cover missing data on either auth slot.
for(const useSecondary of [false,true]) {
  for(const invalid of ['wrongDate','empty','wrongIndex','zero','parseError','serverError']) {
    resetCache();calls=[];
    ctx.UrlFetchApp={fetchAll:requests=>{
      calls.push(requests.map(x=>x.headers.AUTH_KEY));
      return requests.map(x=>{
        const day=new URL(x.url).searchParams.get('basDd');
        if(day==='20261007') return http(200,vkospi(day));
        if(useSecondary && x.headers.AUTH_KEY==='bad-primary') return http(401);
        if(invalid==='parseError') return {getResponseCode:()=>200,getContentText:()=>'{'};
        if(invalid==='serverError') return http(500);
        if(invalid==='empty') return http(200,[]);
        if(invalid==='wrongIndex') return http(200,[{BAS_DD:day,IDX_NM:'KOSPI',CLSPRC_IDX:'2500'}]);
        return http(200,vkospi(invalid==='wrongDate'?'20261007':day,invalid==='zero'?'0':'26.52'));
      });
    }};
    const result=ctx._readVkospiPointsFromKrx('2026-10-07','2026-10-08');
    assert.deepEqual(Array.from(result,x=>x.date),['2026-10-07']);
    assert.equal(cacheWrites,0,`${useSecondary?'secondary':'primary'} ${invalid} must not cache an incomplete range`);
    ctx.UrlFetchApp={fetchAll:requests=>requests.map(x=>http(200,vkospi(new URL(x.url).searchParams.get('basDd'))))};
    assert.equal(ctx._readVkospiPointsFromKrx('2026-10-07','2026-10-08').length,2);
    assert.equal(cacheWrites,1);
  }
}
resetCache();calls=[];
ctx.UrlFetchApp={fetchAll:requests=>{
  calls.push(requests.map(x=>new URL(x.url).searchParams.get('basDd')));
  return requests.map(x=>http(200,vkospi(new URL(x.url).searchParams.get('basDd'))));
}};
assert.equal(ctx._krxCalendarStatus_('2026-10-05'),'CLOSED');
assert.equal(ctx._readVkospiPointsFromKrx('2026-10-02','2026-10-06').length,2);
assert.deepEqual(normalizedCalls(),[['20261002','20261006']],'confirmed weekday closure must not be requested');
assert.equal(cacheWrites,1,'holiday range is complete over actual trading days');
assert.equal(ctx._readVkospiPointsFromKrx('2026-10-02','2026-10-06').length,2);
assert.equal(calls.length,1,'complete holiday range is reused');
resetCache();calls=[];
assert.equal(ctx._readVkospiPointsFromKrx('2026-10-05','2026-10-05').length,0);
assert.equal(calls.length,0,'all-closed range makes no HTTP requests');
assert.equal(ctx._krxCalendarStatus_('2028-01-03'),'UNKNOWN');
assert.equal(ctx._readVkospiPointsFromKrx('2028-01-03','2028-01-03').length,1,
  'unknown year is still queried rather than assumed closed');

resetCache();calls=[];
let unpublished=true;
ctx.UrlFetchApp={fetchAll:requests=>{
  calls.push(requests.map(x=>new URL(x.url).searchParams.get('basDd')));
  return requests.map(x=>{
    const day=new URL(x.url).searchParams.get('basDd');
    return http(200,unpublished && day==='20261012'?[]:vkospi(day));
  });
}};
assert.equal(ctx._readVkospiPointsFromKrx('2026-10-08','2026-10-12').length,1);
assert.equal(cacheWrites,0);
assert.equal(ctx._readVkospiPointsFromKrx('2026-10-08','2026-10-12').length,1);
assert.deepEqual(normalizedCalls(),[['20261008','20261012'],['20261012']],
  'unpublished current date retries without refetching confirmed history');
unpublished=false;
assert.equal(ctx._readVkospiPointsFromKrx('2026-10-08','2026-10-12').length,2);
assert.equal(cacheWrites,1);
for(const failedBatch of [0,1,2]) {
  resetCache();calls=[];
  ctx.UrlFetchApp={fetchAll:requests=>{
    const index=calls.length;
    calls.push(requests.map(x=>new URL(x.url).searchParams.get('basDd')));
    if(index===failedBatch) throw Error('batch network failure');
    return requests.map(x=>http(200,vkospi(new URL(x.url).searchParams.get('basDd'))));
  }};
  const partial=ctx._readVkospiPointsFromKrx('2026-01-01','2026-06-30');
  assert.equal(calls.length,3,'three batches exercise early/middle/last transport failure');
  const succeeded=calls.filter((_,i)=>i!==failedBatch).flat();
  const failed=Array.from(calls[failedBatch]);
  assert.equal(partial.length,succeeded.length,'later transport exception preserves successful batches');
  assert.equal(dayCacheWrites,2,'each successful batch caches before the next batch');
  assert.equal(cacheWrites,0);
  calls=[];
  ctx.UrlFetchApp={fetchAll:requests=>{
    calls.push(requests.map(x=>new URL(x.url).searchParams.get('basDd')));
    return requests.map(x=>http(200,vkospi(new URL(x.url).searchParams.get('basDd'))));
  }};
  assert.equal(ctx._readVkospiPointsFromKrx('2026-01-01','2026-06-30').length,succeeded.length+failed.length);
  assert.deepEqual(normalizedCalls().flat(),failed,'retry only the failed dates');
  const count=calls.length;
  ctx._readVkospiPointsFromKrx('2026-01-01','2026-06-30');
  assert.equal(calls.length,count,'complete recovery avoids subsequent HTTP requests');
}
resetCache();
ctx.UrlFetchApp={fetchAll:()=>{throw Error('all batches failed');}};
assert.throws(()=>ctx._readVkospiPointsFromKrx('2026-10-08','2026-10-08'),/배치 네트워크 오류/);
console.log('✅ K200/VKOSPI 인증·휴장·당일·배치 통신 부분 실패 및 최소 재조회 계약 통과');
