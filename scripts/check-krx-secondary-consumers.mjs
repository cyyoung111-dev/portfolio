import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const gas = fs.readFileSync('src/gas/apps_script.gs', 'utf8');
const ctx = vm.createContext({ console, Date, JSON, Number, String, Math, isFinite, encodeURIComponent });
new vm.Script(gas, {filename:'apps_script.gs'}).runInContext(ctx);
ctx.CONFIG = {TIMEZONE:'UTC'};
ctx.Utilities = {formatDate:(date,zone,format) => format==='HHmm'
  ? new Date(date).toISOString().slice(11,16).replace(':','')
  : new Date(date).toISOString().slice(0,10)};
ctx.Logger = {log:()=>{}};
ctx._getKrxAuthKeySlots_ = () => ({key:'bad-primary',alternative:'approved-alternative'});
function resetCache() {
  const cache=new Map();
  ctx.CacheService={getScriptCache:()=>({get:key=>cache.get(key)||null,put:(k,v)=>cache.set(k,v)})};
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
assert.deepEqual(calls.map(x=>x.length),[2,1],'only denied date should be retried');

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

console.log('✅ K200 night/VKOSPI authorized fallback and exact-date safety passed');
