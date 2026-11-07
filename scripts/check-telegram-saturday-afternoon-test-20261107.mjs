import assert from 'node:assert/strict';
import fs from 'node:fs';
import {testWindow,authorize,prepare,validateSendPayload,
 sendAndRecord,PREFIX,CLAIM,DATE} from './telegram-saturday-afternoon-test-20261107.mjs';

const on=new Date('2026-11-07T14:00:00+09:00'),now=()=>on;
for(const stamp of ['2026-11-07T12:00:00+09:00','2026-11-07T20:59:00+09:00'])
 assert.equal(testWindow(new Date(stamp)),true,stamp);
for(const stamp of ['2026-11-07T11:59:59+09:00','2026-11-07T21:00:00+09:00',
 '2026-11-08T14:00:00+09:00'])
 assert.equal(testWindow(new Date(stamp)),false,stamp);
const evt={repository:{full_name:'cyyoung111-dev/portfolio'},ref:'refs/heads/main',
 before:'a'.repeat(40),after:'b'.repeat(40)};
const auth={eventName:'push',event:evt,instant:on,additionVerified:true,attempt:1};
assert.equal(authorize(auth),true);
for(const patch of [{attempt:2},{additionVerified:false},{eventName:'workflow_dispatch'},
 {instant:new Date('2026-11-08T14:00:00+09:00')},
 {event:{...evt,before:evt.after}}]){
 assert.equal(authorize({...auth,...patch}),false);
}
const base='[기존 토요일 테스트]\nTEST ONLY · 전일 확정 시장 참고\n■ QC: 15/21';
const okReply={ok:true,json:async()=>({total_count:0,artifacts:[]})};
let fetched=0,composed=0;
const fresh=await prepare({now,githubToken:'public-read-token',
 fetchImpl:async(url,options)=>{
  fetched++;assert.match(url,/actions\/artifacts\?name=/);
  assert.equal(options.redirect,'error');return okReply;
 },compose:async(args)=>{
  composed++;assert.equal(typeof args.now,'function');
  assert.equal(Object.hasOwn(args,'gasToken'),false);
  return {text:base,sourceCount:15};
 }});
assert.equal(fetched,1);assert.equal(composed,1);
assert.equal(fresh.status,'PREPARED');assert.equal(fresh.ready,true);
assert.equal(fresh.sourceCount,15);
assert.equal(fresh.date,DATE);assert.equal(fresh.claim,CLAIM);
assert.ok(fresh.message.startsWith(PREFIX));
assert.match(fresh.message,/TEST ONLY/);assert.match(fresh.message,/■ QC:/);
validateSendPayload(fresh,on);
const existing=await prepare({now,githubToken:'public-read-token',
 fetchImpl:async()=>({ok:true,json:async()=>({
  total_count:1,artifacts:[{name:CLAIM}]})}),
 compose:async()=>{throw Error('COMPOSE_MUST_NOT_RUN');}});
assert.equal(existing.status,'ALREADY_CLAIMED');assert.equal(existing.ready,false);
await assert.rejects(()=>prepare({now,githubToken:'public-read-token',
 fetchImpl:async()=>{throw Error('SECRET_NEVER_LOG');},
 compose:async()=>{throw Error('NOT_CALLED');}}),/EXTRA_TEST_CLAIM_LOOKUP_FAILED/);
await assert.rejects(()=>prepare({now,githubToken:'public-read-token',
 fetchImpl:async()=>({ok:true,json:async()=>({
  total_count:0,artifacts:[{name:'unclaimed'}]})}),
 compose:async()=>{throw Error('NOT_CALLED');}}),/EXTRA_TEST_CLAIM_INVALID/);
assert.equal((await prepare({now:()=>new Date('2026-11-08T14:00:00+09:00'),
 githubToken:'any',fetchImpl:async()=>{throw Error('NO_FETCH');}})).ready,false);
for(const [payload,instant] of [
 [{...fresh,claim:'wrong'},on],
 [{...fresh,message:'other'},on],
 [fresh,new Date('2026-11-08T14:00:00+09:00')],
 [{...fresh,date:'2026-11-06'},on]
]){
 assert.throws(()=>validateSendPayload(payload,instant),/EXTRA_TEST_SEND_DENIED/);
}
let sends=0,writes=0;
const expectedText=fresh.message;
const sent=await sendAndRecord(fresh,{now,token:'test',chatId:'42',runId:'mock-run',
 send:async(token,chat,text)=>{
  sends++;assert.equal(token,'test');assert.equal(chat,'42');
  assert.equal(text,expectedText);
 },writeFile:(path,body,options)=>{
  writes++;assert.match(path,/sent\.json$/);
  assert.deepEqual(JSON.parse(body),{
   status:'SENT',date:DATE,claim:CLAIM,runId:'mock-run'});
  assert.equal(options.flag,'wx');
 }});
assert.equal(sent.status,'SENT');assert.equal(sends,1);assert.equal(writes,1);
writes=0;
await assert.rejects(()=>sendAndRecord(fresh,{now,
 send:async()=>{throw Error('TELEGRAM_SEND_UNCONFIRMED_DO_NOT_RETRY');},
 writeFile:()=>{writes++;}}),/TELEGRAM_SEND_UNCONFIRMED_DO_NOT_RETRY/);
assert.equal(writes,0,'do not mark SENT when provider rejected');
sends=0;writes=0;
await assert.rejects(()=>sendAndRecord({...fresh,claim:'wrong'},{
 now,send:async()=>{sends++;},writeFile:()=>{writes++;}}),/EXTRA_TEST_SEND_DENIED/);
assert.equal(sends,0);assert.equal(writes,0);
const workflow=fs.readFileSync('.github/workflows/telegram-saturday-afternoon-test-20261107.yml','utf8');
assert.match(workflow,/git diff --diff-filter=A/);
assert.match(workflow,/Persist unique claim before any Telegram contact/);
assert.match(workflow,/Send one explicitly labeled Saturday test briefing/);
assert.equal(workflow.includes('GAS_ACCESS_TOKEN'),false);
assert.equal(workflow.includes('NHPLUG_APP_SECRET'),false);
assert.equal(workflow.includes('workflow_dispatch:'),false);
console.log('SATURDAY_AFTERNOON_EXTRA_PRODUCTION_CONTRACT_OK');
