#!/usr/bin/env node
// Uses the actual public Hanwha C-RPe reader with fake HTTP; no GAS, Sheets or
// account access. Network retries must NOT weaken code/class/date validation.
import assert from 'node:assert/strict';
import {runPublicHanwhaSource} from './collect-hanwha-public-nav.mjs';

const clock=new Date('2026-11-09T12:00:00+09:00');
const valid={list:[
 {wkdate:'2026-11-06',price:'1,939.57'},
 {wkdate:'2026-11-07',price:'1,868.45'},
 {wkdate:'2026-11-08',price:'1,868.41'},
 {wkdate:'2026-11-09',price:'1,868.42'}
]};
const ok=()=>({ok:true,json:async()=>valid});
const checked=(url,options)=>{
 const u=new URL(url);
 assert.equal(u.hostname,'www.hanwhafund.co.kr');
 assert.equal(u.pathname,'/api/fund/dailyPrice');
 assert.equal(u.searchParams.get('fundCd'),'008942');
 assert.equal(u.searchParams.get('endDate'),'2026-11-09');
 assert.equal(options.method,'GET');
 assert(options.signal);
};
let calls=0;
const normal=await runPublicHanwhaSource({now:clock,fetchImpl:async(u,o)=>{
 checked(u,o);calls++;return ok();
}});
assert.equal(calls,1);
assert.equal(normal.code,'F00001');
assert.equal(normal.classCode,'C-RPe');
assert.equal(normal.latestDate,'2026-11-08');
assert.equal(normal.rows.length,3);
assert.equal(normal.sameDayExcluded,1);
assert.equal(normal.writerInvoked,false);

calls=0;
const retry=await runPublicHanwhaSource({now:clock,fetchImpl:async(u,o)=>{
 checked(u,o);calls++;
 if(calls===1)throw Error('PRIVATE_HTTP_PROXY_DETAILS');
 return ok();
}});
assert.equal(calls,2);
assert.deepEqual(retry.rows,normal.rows);
assert.equal(retry.writerInvoked,false);
calls=0;
await assert.rejects(()=>runPublicHanwhaSource({now:clock,
 fetchImpl:async()=>{calls++;throw Error('PRIVATE_ACCOUNT_URL');}}),
 e=>e.message==='HANWHA_SOURCE_NETWORK_UNVERIFIED');
assert.equal(calls,2,'Persistent transport failure must end after 2 attempts');

calls=0;
await assert.rejects(()=>runPublicHanwhaSource({now:clock,
 fetchImpl:async()=>{calls++;const e=Error('PRIVATE');e.name='TimeoutError';throw e;}}),
 e=>e.message==='HANWHA_SOURCE_TIMEOUT_UNVERIFIED');
assert.equal(calls,2);
calls=0;
await assert.rejects(()=>runPublicHanwhaSource({now:clock,
 fetchImpl:async()=>{calls++;return {ok:false,status:403};}}),
 /HANWHA_SOURCE_HTTP_UNVERIFIED/);
assert.equal(calls,1,'HTTP 403 must not retry or masquerade as network');

calls=0;
await assert.rejects(()=>runPublicHanwhaSource({now:clock,
 fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({list:[
  {wkdate:'2026-11-08',price:'BAD'}
 ]})};}}),/HANWHA_SOURCE_SCHEMA/);
assert.equal(calls,1,'Malformed source must never retry as transient transport');
await assert.rejects(()=>runPublicHanwhaSource({now:clock,
 fetchImpl:async()=>({ok:true,json:async()=>({list:[
  {wkdate:'2026-11-09',price:'1,868.42'}
 ]})})}),/HANWHA_SOURCE_NO_PRIOR_DAY_ROWS/);
console.log(JSON.stringify({
 kind:'HANWHA_NAV_BOUNDED_TRANSPORT_RETRY',
 firstAttemptSuccessCalls:1,recoveredCalls:2,
 permanentNetworkFailureCalls:2,httpFailureCalls:1,
 exactFundCd:'008942',exactClass:'C-RPe',
 malformedDataFailClosed:true,todaysUnpublishedNavNotImported:true,
 financialWrites:0,gasDeployments:0,telegramSends:0
}));
