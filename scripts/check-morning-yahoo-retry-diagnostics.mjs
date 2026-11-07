import assert from 'node:assert/strict';
import {MORNING_SERIES,expectedMorningDate,collectMorningSeries}
 from './telegram-morning-report.mjs';

const date='2026-11-02',now=new Date('2026-11-02T07:45:00+09:00');
const find=id=>MORNING_SERIES.find(x=>x.id===id);
const only=id=>new Set(MORNING_SERIES.filter(x=>x.id!==id).map(x=>x.symbol));
const dated=(id,sourceDate,value=123)=>({
 label:find(id).label,symbol:find(id).symbol,date:sourceDate,
 value,changePercent:1,source:'Yahoo Finance 일봉'
});
const expected=id=>expectedMorningDate(id,date,now);

let request=[],observed=[];
const recovered=await collectMorningSeries(date,{
 now,skipSymbols:only('NVDA'),
 fetchDaily:async(label,symbol,day,{host}={})=>{
  assert.equal(symbol,'NVDA');assert.equal(label,'엔비디아');
  assert.equal(day,date);request.push(host||'query1.finance.yahoo.com');
  if(!host)throw Error('SECRET_NETWORK_EXCEPTION_RAW_URL_NEVER_LOG');
  return dated('NVDA',expected('NVDA'),209);
 },
 onDiagnostic:row=>observed.push(row)
});
assert.deepEqual(request,['query1.finance.yahoo.com','query2.finance.yahoo.com']);
assert.equal(recovered.length,1);
assert.equal(recovered[0].value,209);
assert.deepEqual(observed,[{
 kind:'YAHOO_MORNING_DAILY_READ',id:'NVDA',
 status:'BACKUP_VERIFIED',primaryReason:'REQUEST_THROWN',backupReason:null
}]);
assert.ok(!JSON.stringify(observed).includes('SECRET_NETWORK_EXCEPTION'));
assert.ok(!JSON.stringify(observed).includes('209'));
assert.ok(!JSON.stringify(observed).includes('query1.finance.yahoo.com'));

request=[];observed=[];
const noFakeClose=await collectMorningSeries(date,{
 now,skipSymbols:only('MU'),
 fetchDaily:async(_label,_symbol,_date,{host}={})=>{
  request.push(host||'query1.finance.yahoo.com');
  return host?dated('MU','2026-10-28'):dated('MU',date);
 },
 onDiagnostic:row=>observed.push(row)
});
assert.deepEqual(noFakeClose,[],'same-day incomplete and stale prior bar never count');
assert.deepEqual(request,['query1.finance.yahoo.com','query2.finance.yahoo.com']);
assert.deepEqual(observed,[{
 kind:'YAHOO_MORNING_DAILY_READ',id:'MU',
 status:'BOTH_UNVERIFIED',primaryReason:'UNVERIFIED_DATE_OR_VALUE',
 backupReason:'UNVERIFIED_DATE_OR_VALUE'
}]);

request=[];observed=[];
const badPrimaryRecovered=await collectMorningSeries(date,{
 now,skipSymbols:only('SOX'),
 fetchDaily:async(_label,_symbol,_date,{host}={})=>{
  request.push(host||'query1.finance.yahoo.com');
  return host?dated('SOX',expected('SOX'),100):
   {label:'SOX',symbol:'^SOX',date:expected('SOX'),value:0,source:'Yahoo Finance 일봉'};
 },
 onDiagnostic:row=>observed.push(row)
});
assert.equal(badPrimaryRecovered.length,1);
assert.deepEqual(request,['query1.finance.yahoo.com','query2.finance.yahoo.com']);
assert.equal(observed[0].primaryReason,'UNVERIFIED_DATE_OR_VALUE');
assert.equal(observed[0].status,'BACKUP_VERIFIED');

request=[];observed=[];
const firstVerified=await collectMorningSeries(date,{
 now,skipSymbols:only('WTI'),
 fetchDaily:async(_label,_symbol,_date,{host}={})=>{
  request.push(host||'query1.finance.yahoo.com');
  if(host)throw Error('should not call backup for verified primary');
  return dated('WTI',expected('WTI'),98);
 },
 onDiagnostic:row=>observed.push(row)
});
assert.equal(firstVerified.length,1);
assert.deepEqual(request,['query1.finance.yahoo.com']);
assert.deepEqual(observed,[{
 kind:'YAHOO_MORNING_DAILY_READ',id:'WTI',
 status:'PRIMARY_VERIFIED',primaryReason:null,backupReason:null
}]);

request=[];observed=[];
const bothFail=await collectMorningSeries(date,{
 now,skipSymbols:only('BRENT'),
 fetchDaily:async(_label,_symbol,_date,{host}={})=>{
  request.push(host||'query1.finance.yahoo.com');
  if(host)throw Error('PRIVATE_PROVIDER_TOKEN_BACKUP');
  return null;
 },
 onDiagnostic:row=>observed.push(row)
});
assert.deepEqual(bothFail,[]);
assert.deepEqual(request,['query1.finance.yahoo.com','query2.finance.yahoo.com']);
assert.deepEqual(observed,[{
 kind:'YAHOO_MORNING_DAILY_READ',id:'BRENT',status:'BOTH_UNVERIFIED',
 primaryReason:'NO_ROW',backupReason:'REQUEST_THROWN'
}]);
assert.ok(!JSON.stringify(observed).includes('PRIVATE_PROVIDER_TOKEN_BACKUP'));

const callbackFailure=await collectMorningSeries(date,{
 now,skipSymbols:only('GOLD'),
 fetchDaily:async()=>dated('GOLD',expected('GOLD'),2500),
 onDiagnostic:()=>{throw Error('LOCAL_TELEMETRY_FAILED');}
});
assert.equal(callbackFailure.length,1,'logging may not affect 07:40 source selection');
assert.equal(callbackFailure[0].symbol,'GC=F');

let n=0;
const bypass=await collectMorningSeries(date,{
 now,skipSymbols:new Set(MORNING_SERIES.map(x=>x.symbol)),
 fetchDaily:async()=>{n++;return null;},
 onDiagnostic:()=>{n++;}
});
assert.deepEqual(bypass,[]);
assert.equal(n,0,'NH-owned and explicitly skipped symbols must never use Yahoo fallback');
console.log('MORNING_YAHOO_RETRY_DIAGNOSTIC_PASS thrown_primary fallback exact_day statuses no_privacy no_financial_writes');
