import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const raw=fs.readFileSync('ops/performance-standalone-gas/Code.gs','utf8');
assert.match(raw,/__PERF_BEARER_SHA256__/);
assert.doesNotMatch(raw,/SpreadsheetApp|DriveApp|GmailApp|CalendarApp|UrlFetchApp|GAS_SCRIPT_ID|Snapshot|NHPLUG/);
const expected='a'.repeat(64);
const src=raw.replace('__PERF_BEARER_SHA256__',expected);
const props=new Map();
let held=false,blocked=false;
const lock={
 tryLock(){if(blocked||held)return false;held=true;return true},
 releaseLock(){held=false}
};
const ctx=vm.createContext({
 JSON,Object,Math,Date,Array,String,Number,Utilities:{
 formatDate:(date,tz,fmt)=>{assert.equal(tz,'Asia/Seoul');assert.equal(fmt,'yyyyMMdd');
 return new Date(date.getTime()+9*3600000).toISOString().slice(0,10).replaceAll('-','')}
 },PropertiesService:{getScriptProperties:()=>({
 getProperty:k=>props.get(k)||null,
 getProperties:()=>Object.fromEntries(props),
 setProperty:(k,v)=>{props.set(k,String(v))},
 deleteProperty:k=>{props.delete(k)}
 })},LockService:{getScriptLock:()=>lock},
 ContentService:{MimeType:{JSON:'json'},createTextOutput:t=>({
  getContent:()=>t,setMimeType(){return this}
 })}
});
vm.runInContext(src,ctx);
const call=(action,body,accessToken=expected)=>JSON.parse(ctx.doPost({
 parameter:{action,accessToken,...(body?{data:JSON.stringify(body)}:{})}
}).getContent());
const post={version:1,device:'mobile',samples:[
 {stage:'price.poll-total',ms:2350,result:'ok'},
 {stage:'price.poll-total',ms:5000,result:'error'},
 {stage:'price.poll-render',ms:120,result:'ok'}
]};
assert.equal(call('appendPerformanceMetrics',post,'wrong').message,'AUTH_REQUIRED');
assert.equal(JSON.parse(ctx.doGet({}).getContent()).message,'POST_ONLY');
assert.equal(props.size,0);
assert.equal(call('appendPerformanceMetrics',post).accepted,3);
assert.equal(props.size,1);
const summary=call('getPerformanceSummary');
assert.equal(summary.sampleCount,3);
assert.equal(summary.groups.find(g=>g.stage==='price.poll-total').medianMs,2350);
assert.equal(summary.groups.find(g=>g.stage==='price.poll-total').p95Ms,5000);
assert.equal(summary.groups.find(g=>g.stage==='price.poll-total').failureRatePct,50);
const invalid={...post,samples:[{stage:'price.poll-total',ms:1,result:'ok',account:'SECRET'}]};
assert.equal(call('appendPerformanceMetrics',invalid).message,'PAYLOAD_INVALID');
blocked=true;
assert.equal(call('appendPerformanceMetrics',post).message,'LOW_PRIORITY_BUSY');
blocked=false;
assert.equal(call('appendPerformanceMetrics',{...post,device:'desktop'}).status,'ok');
assert.ok(call('getPerformanceSummary').groups.some(x=>x.device==='desktop'));
const oldDay='pfv1_20200101_mobile';
props.set(oldDay,'[]');
call('appendPerformanceMetrics',post);
assert.equal(props.has(oldDay),false,'7 day retention cleanup');
let writes=0;while(true){
 const res=call('appendPerformanceMetrics',post);
 if(res.status==='error'){assert.equal(res.message,'DAILY_CAP');break;}
 writes+=3;if(writes>150)throw Error('cap bypass');
}
assert.ok(props.size<=2);
assert.equal(call('getPerformanceSummary').sampleCount<=200,true);
console.log('PASS isolated performance GAS: no finance scopes, auth, POST-only, cap, p50/p95, retention, lock');
