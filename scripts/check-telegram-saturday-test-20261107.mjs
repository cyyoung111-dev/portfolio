import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import YAML from 'yaml';
import {DATE,REPO,CLAIM,testWindow,authorizeSaturday,countVerified,
 composeSaturday,prepareSaturday,deliverSaturday,saveSentSaturday,
 deliverAndRecordSaturday} from './telegram-saturday-test-20261107.mjs';
import {MORNING_SERIES,expectedMorningDate}
 from './telegram-morning-report.mjs';

const good=()=>new Date('2026-11-07T06:18:00+09:00');
const now=good;
assert.equal(DATE,'2026-11-07');
assert.equal(expectedMorningDate('KOSPI',DATE), '2026-11-06');
assert.equal(expectedMorningDate('SPX',DATE), '2026-11-06');
assert.equal(testWindow(new Date('2026-11-07T05:59:59+09:00')).allowed,false);
assert.equal(testWindow(good()).allowed,true);
assert.equal(testWindow(new Date('2026-11-07T10:29:00+09:00')).allowed,true);
assert.equal(testWindow(new Date('2026-11-07T10:30:00+09:00')).allowed,false);
assert.equal(testWindow(new Date('2026-11-08T06:18:00+09:00')).allowed,false);
const route='.github/workflows/telegram-saturday-test-20261107.yml';
const push={repository:{full_name:REPO},ref:'refs/heads/main',
 commits:[{added:[route],modified:[],removed:[]}]};
assert.equal(authorizeSaturday('push',push,good()),true);
for(const input of [
 ['push',{...push,ref:'refs/heads/feature'}],
 ['push',{...push,repository:{full_name:'attacker/repo'}}],
 ['push',{...push,commits:[{added:[],modified:[route]}]}],
 ['push',{...push,commits:[{added:[route]},{added:[route]}]}],
 ['schedule',push],
 ['workflow_dispatch',push]
])assert.equal(authorizeSaturday(...input,good()),false);
assert.equal(authorizeSaturday('push',push,new Date('2026-11-08T06:18:00+09:00')),false);

const empty=await composeSaturday({now,gasUrl:'',gasToken:'',
 master:async()=>[],domestic:async()=>[],collect:async()=>[]});
assert.equal(empty.sourceCount,0);
assert.match(empty.text,/토요일 장전 브리핑 테스트/);
assert.match(empty.text,/금요일|11월 6일/);
assert.match(empty.text,/■ QC:/);
assert.match(empty.text,/미확보/);
assert.ok(empty.text.length<=4000);
assert.doesNotMatch(empty.text,/11월 7일.*당일 종가 확정/);

const row=(id,date,value,source='YAHOO_REFERENCE')=>{
 const item=MORNING_SERIES.find(x=>x.id===id);
 return {label:item.label,symbol:item.symbol,date,value,changePercent:0,source};
};
assert.equal(countVerified(DATE,[row('KOSPI','2026-11-06',3000),
 row('SPX','2026-11-06',7000)],now()),2);
assert.equal(countVerified(DATE,[row('KOSPI','2026-11-05',3000)],now()),0);
assert.equal(countVerified(DATE,[row('SPX','2026-11-05',7000)],now()),0);
assert.equal(countVerified(DATE,[row('KOSPI','2026-11-06',3000),
 row('KOSPI','2026-11-06',3010)],now()),0);

let listed=0,compiled=0,sent=0,seen='';
const validMessage='[토요일 장전 브리핑 테스트 | 2026-11-07] TEST ONLY\n■ QC: synthetic';
const claimReply=(n=0)=>({ok:true,json:async()=>({
 total_count:n,artifacts:n?[{name:CLAIM}]:[]})});
const base={now,repository:REPO,gitToken:'TEST_GITHUB',
 fetchImpl:async url=>{
  assert.ok(url.endsWith('artifacts?name='+CLAIM+'&per_page=100'));
  listed++;return claimReply();
 },
 compose:async()=>{compiled++;return {text:validMessage,sourceCount:3};}
};
const prepared=await prepareSaturday(base);
assert.equal(prepared.ready,true);
assert.equal(prepared.claim,CLAIM);
assert.equal(prepared.sourceCount,3);
assert.equal(listed,1);assert.equal(compiled,1);
const destination=fs.mkdtempSync(join(tmpdir(),'sat-proof-'));
try {
 const sentPath=join(destination,'sent.json');
 const result=await deliverAndRecordSaturday(prepared,{
  now,runId:'fixture-run',path:sentPath,send:async(_token,_chat,message)=>{
   sent++;seen=message;return true;
  }});
 assert.equal(sent,1);assert.equal(result.status,'SENT');
 assert.equal(seen,validMessage);
 const proof=JSON.parse(fs.readFileSync(sentPath,'utf8'));
 assert.deepEqual(proof,{status:'SENT',testDate:DATE,claim:CLAIM,runId:'fixture-run'});
 assert.doesNotMatch(JSON.stringify(proof),/TEST_GITHUB|TEST ONLY/);
 assert.throws(()=>saveSentSaturday(result,prepared,{path:sentPath}),/EEXIST/);
 const notSent=join(destination,'never.json');
 await assert.rejects(deliverAndRecordSaturday(prepared,{
  now,path:notSent,send:async()=>{throw Error('TELEGRAM_SEND_UNCONFIRMED_DO_NOT_RETRY');}
 }),/TELEGRAM_SEND_UNCONFIRMED_DO_NOT_RETRY/);
 assert.equal(fs.existsSync(notSent),false);
} finally {fs.rmSync(destination,{recursive:true,force:true});}
assert.equal((await prepareSaturday({...base,fetchImpl:async()=>claimReply(1)})).status,'ALREADY_CLAIMED');
assert.equal(compiled,1,'duplicate must not run any market source');
assert.equal((await prepareSaturday({...base,now:()=>new Date('2026-11-08T06:18:00+09:00'),
 fetchImpl:async()=>assert.fail('must not query outside 2026-11-07')})).ready,false);
await assert.rejects(deliverSaturday({...prepared,date:'2026-11-06'},
 {now,send:async()=>{sent++;}}),/SEND_DENIED/);
await assert.rejects(deliverSaturday(prepared,{
 now:()=>new Date('2026-11-08T06:18:00+09:00'),send:async()=>{sent++;}
}),/SEND_DENIED/);
assert.equal(sent,1);

const workflow=YAML.parse(fs.readFileSync(route,'utf8'));
assert.deepEqual(workflow.on.push.paths,[route]);
assert.deepEqual(workflow.on.push.branches,['main']);
assert.equal(workflow.jobs['saturday-test'].environment,'portfolio-production-gas');
assert.equal(workflow.jobs['saturday-test']['timeout-minutes'],9);
const steps=workflow.jobs['saturday-test'].steps;
const pIndex=steps.findIndex(x=>x.id==='prepare');
const cIndex=steps.findIndex(x=>x.name==='Claim unique Saturday test before Telegram');
const sIndex=steps.findIndex(x=>x.name==='Send claimed Saturday test once');
const aIndex=steps.findIndex(x=>x.name==='Archive Telegram API-confirmed Saturday SENT proof');
assert.ok(pIndex>=0&&pIndex<cIndex&&cIndex<sIndex&&sIndex<aIndex);
assert.equal(steps[pIndex].env.TELEGRAM_BOT_TOKEN,undefined);
assert.equal(steps[sIndex].env.GAS_ACCESS_TOKEN,undefined);
assert.equal(steps[cIndex].with['if-no-files-found'],'error');
assert.equal(steps[aIndex].with['if-no-files-found'],'error');
assert.equal(workflow.on.schedule,undefined,'not a recurrent Saturday cron');
const script=fs.readFileSync('scripts/telegram-saturday-test-20261107.mjs','utf8');
assert.doesNotMatch(script,/readNhMorningIndexes|readNhNightFromGas/);
assert.match(script,/await deliverSaturday\(payload,opts\)/);
assert.match(script,/await deliverAndRecordSaturday\(payload,/);
console.log('SATURDAY_20261107_MORNING_TEST_PASS pastDay_only=true uniqueClaim=true confirmedSENT=true noWrites=true');
