import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import YAML from 'yaml';
import {DATE,REPO,windowFor,selectPeriod,claimFor,formatClosingTest,prepareSunday,deliverSunday,persistConfirmedSundaySent}
 from './telegram-sunday-test-20261101.mjs';

const morning=()=>new Date('2026-11-01T07:45:00+09:00');
const closing=()=>new Date('2026-11-01T16:45:00+09:00');
assert.equal(DATE,'2026-11-01');
assert.equal(windowFor('morning',new Date('2026-11-01T07:29:59+09:00')).allowed,false);
assert.equal(windowFor('morning',morning()).allowed,true);
assert.equal(windowFor('morning',new Date('2026-11-01T11:00:00+09:00')).allowed,false);
assert.equal(windowFor('close',new Date('2026-11-01T16:29:59+09:00')).allowed,false);
assert.equal(windowFor('close',closing()).allowed,true);
assert.equal(windowFor('close',new Date('2026-11-01T20:00:00+09:00')).allowed,false);
assert.equal(windowFor('morning',new Date('2026-11-08T08:00:00+09:00')).allowed,false);
assert.equal(windowFor('close',new Date('2026-10-31T16:45:00+09:00')).allowed,false);
assert.equal(selectPeriod('schedule',{schedule:'35 22 * * 6'}),'morning');
assert.equal(selectPeriod('schedule',{schedule:'30 7 * * 0'}),'close');
assert.equal(selectPeriod('schedule',{schedule:'0 0 * * *'}),null);
assert.equal(selectPeriod('workflow_dispatch',{inputs:{period:'close'}}),'close');
assert.equal(selectPeriod('workflow_dispatch',{inputs:{period:'invalid'}}),null);
assert.equal(selectPeriod('push',{inputs:{period:'morning'}}),null);
assert.notEqual(claimFor('morning'),claimFor('close'));

let reads=0,builds=0,sends=0,claimed=false;
const options={period:'morning',now:morning,repository:REPO,gitToken:'SYNTHETIC-GITHUB',
 fetchImpl:async url=>{reads++;assert.match(url,/api[.]github[.]com/);
 return {ok:true,json:async()=>({total_count:claimed?1:0,
 artifacts:claimed?[{name:claimFor('morning')}]:[]})};},
 compose:async()=>{builds++;return {text:'[일요일 장전 TEST] source labels only',sourceCount:0};}};
const ready=await prepareSunday(options);
assert.equal(ready.ready,true);
assert.equal(ready.claim,claimFor('morning'));
assert.equal(reads,1);assert.equal(builds,1);
const confirmed=await deliverSunday(ready,{now:morning,send:async()=>{sends++;}});
assert.equal(confirmed.status,'SENT');
assert.equal(sends,1);
// Execute the exact production receipt writer against a real temporary file.
const proofDir=fs.mkdtempSync(join(tmpdir(),'sunday-telegram-sent-'));
try {
  const proofPath=join(proofDir,'sent.json');
  const proof=persistConfirmedSundaySent(confirmed,ready,{path:proofPath,runId:'SYNTHETIC_RUN'});
  const persisted=JSON.parse(fs.readFileSync(proofPath,'utf8'));
  assert.deepEqual(persisted,proof);
  assert.deepEqual(Object.keys(persisted),['status','testDate','period','claim','workflowRunId']);
  assert.equal(persisted.status,'SENT');
  assert.equal(persisted.testDate,DATE);
  assert.equal(persisted.period,'morning');
  assert.equal(persisted.claim,claimFor('morning'));
  assert.equal(persisted.workflowRunId,'SYNTHETIC_RUN');
  assert.doesNotMatch(JSON.stringify(persisted),/SYNTHETIC-GITHUB|CHAT_ID|TELEGRAM_BOT_TOKEN|source labels only/);
  assert.throws(()=>persistConfirmedSundaySent(confirmed,ready,{path:proofPath,runId:'DUPLICATE'}),
    /EEXIST/,'SENT receipt must not overwrite an existing proof');
  const failPath=join(proofDir,'should-not-exist.json');
  await assert.rejects(deliverSunday(ready,{
    now:morning,send:async()=>{throw Error('TELEGRAM_SEND_UNCONFIRMED_DO_NOT_RETRY');}
  }),/TELEGRAM_SEND_UNCONFIRMED_DO_NOT_RETRY/);
  assert.equal(fs.existsSync(failPath),false,'failed send must not create a success artifact');
  assert.throws(()=>persistConfirmedSundaySent({status:'PREPARED'},ready,{path:failPath}),
    /SEND_PROOF_INVALID/);
  assert.equal(fs.existsSync(failPath),false);
  assert.throws(()=>persistConfirmedSundaySent(confirmed,{...ready,date:'2026-11-08'},{path:failPath}),
    /SEND_PROOF_INVALID/);
  assert.equal(fs.existsSync(failPath),false);
  assert.throws(()=>persistConfirmedSundaySent({...confirmed,period:'close'},ready,{path:failPath}),
    /SEND_PROOF_INVALID/);
  assert.equal(fs.existsSync(failPath),false);
} finally {
  fs.rmSync(proofDir,{recursive:true,force:true});
}
claimed=true;
assert.equal((await prepareSunday(options)).status,'ALREADY_CLAIMED');
assert.equal(builds,1,'duplicate must not fetch or build market report');
await assert.rejects(deliverSunday({...ready,claim:claimFor('close')},
 {now:morning,send:async()=>{sends++;}}),/SEND_DENIED/);
await assert.rejects(deliverSunday(ready,{now:()=>new Date('2026-11-08T08:00:00+09:00'),
 send:async()=>{sends++;}}),/SEND_DENIED/);
assert.equal(sends,1);
const nonDay=await prepareSunday({...options,now:()=>new Date('2026-11-08T08:00:00+09:00'),
 fetchImpl:async()=>assert.fail('future Sunday must not read Github'),
 compose:async()=>assert.fail('future Sunday must not fetch market')});
assert.equal(nonDay.status,'OUTSIDE_ONE_DAY_TEST_WINDOW');
assert.equal((await prepareSunday({...options,period:'close',now:morning})).ready,false);
await assert.rejects(prepareSunday({...options,now:closing,period:'close',
 fetchImpl:async()=>({ok:false})}),/CLAIM_LOOKUP_FAILED/);
const rows=[{label:'KOSPI',symbol:'^KS11',date:'2026-10-30',value:4100,
 changePercent:1,source:'FDR_KRX_CACHE'},
 {label:'S&P 500',symbol:'^GSPC',date:'2026-10-30',value:7000,
 changePercent:0.5,source:'NH_INDEX_DAILY'},
 {label:'NASDAQ',symbol:'^IXIC',date:'2026-10-29',value:24000,
 changePercent:1,source:'NH_INDEX_DAILY'},
 {label:'미 10년물',symbol:'^TNX',date:'2026-10-30',value:41.2,
 changePercent:0.1,source:'Yahoo Finance 일봉'}];
const message=formatClosingTest(rows);
assert.match(message,/일요일 휴장/);
assert.match(message,/KOSPI: 4,100.*2026-10-30/);
assert.match(message,/S&P 500: 7,000.*NH_INDEX_DAILY/);
assert.match(message,/NASDAQ: 확정 출처 미확보/);
assert.match(message,/미 10년물: 4.12%.*2026-10-30/);
const scriptSource=fs.readFileSync('scripts/telegram-sunday-test-20261101.mjs','utf8');
assert.doesNotMatch(scriptSource,/readNhMorningIndexes|action:'getBenchmarks'/,
 'Sunday test must never request NH OAuth refresh indirectly');
assert.doesNotMatch(message,/일요일.*확정 종가/);
const wf=YAML.parse(fs.readFileSync('.github/workflows/telegram-sunday-test-20261101.yml','utf8'));
assert.ok(Object.hasOwn(wf.on,'schedule'));
assert.ok(Object.hasOwn(wf.on,'workflow_dispatch'));
assert.ok(!Object.hasOwn(wf.on,'push'));
assert.equal(wf.concurrency.group,'telegram-sunday-20261101-once');
assert.equal(wf.jobs.test.environment,'portfolio-production-gas');
assert.deepEqual(wf.jobs.test['timeout-minutes'],8);
const steps=wf.jobs.test.steps;
const ci=steps.findIndex(x=>x.uses==='actions/upload-artifact@v4');
const send=steps.findIndex(x=>String(x.run||'').endsWith('telegram-sunday-test-20261101.mjs send'));
assert.ok(ci>=0&&send>ci,'claim artifact must succeed before sending');
const sentProof=steps.findIndex(x=>x.name==='Archive confirmed Telegram acceptance evidence');
assert.ok(sentProof>send,'SENT artifact must be created ONLY after Telegram API confirms acceptance');
assert.equal(steps[sentProof].uses,'actions/upload-artifact@v4');
assert.equal(steps[sentProof].with.name,'${{ steps.prepare.outputs.claim }}-sent');
assert.equal(steps[sentProof].with.path,'.sunday-test-runtime/sent.json');
assert.equal(steps[sentProof].with['if-no-files-found'],'error');
assert.equal(steps[sentProof].env,undefined,'proof upload must not receive operational tokens');
assert.match(scriptSource,/const sent=await deliverSunday\(payload,/,
 'SENT proof must follow actual deliverSunday await');
assert.match(scriptSource,/persistConfirmedSundaySent\(sent,payload,/,
 'production send CLI must invoke the tested receipt writer');
assert.match(scriptSource,/if\(sent\?\.status!=='SENT'/,
 'proof must verify the accepted response before writing');
assert.doesNotMatch(scriptSource,/chatId:String\(process\.env\.TELEGRAM_CHAT_ID\)/,
 'SENT artifact must never contain Telegram credentials or recipient');

assert.equal(steps[send].env.GAS_ACCESS_TOKEN,undefined,'send must not receive GAS token');
assert.equal(steps.find(x=>x.id==='prepare').env.TELEGRAM_BOT_TOKEN,undefined,'prepare must not receive Telegram token');
console.log('SUNDAY_20261101_TELEGRAM_SIMULATION PASS slots=2 uniqueClaims=true pastOnly=true sends=1');
