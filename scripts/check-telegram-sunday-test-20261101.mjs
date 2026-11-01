import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import YAML from 'yaml';
import {DATE,REPO,windowFor,selectPeriod,claimFor,formatClosingTest,prepareSunday,composeSunday,deliverSunday,persistConfirmedSundaySent,deliverAndRecordSunday}
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
const trustedPush={repository:{full_name:REPO},ref:'refs/heads/main'};
assert.equal(selectPeriod('push',trustedPush,morning()),'morning');
assert.equal(selectPeriod('push',trustedPush,closing()),'close');
assert.equal(selectPeriod('push',trustedPush,new Date('2026-11-01T11:00:00+09:00')),null);
assert.equal(selectPeriod('push',trustedPush,new Date('2026-11-08T08:00:00+09:00')),null);
assert.equal(selectPeriod('push',{...trustedPush,repository:{full_name:'attacker/portfolio'}},morning()),null);
assert.equal(selectPeriod('push',{...trustedPush,ref:'refs/heads/feature'},morning()),null);
assert.equal(selectPeriod('push',{inputs:{period:'morning'}},morning()),null);
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
  const actualPath=join(proofDir,'real-path.json');
  const delivered=await deliverAndRecordSunday(ready,{now:morning,
    send:async()=>true,path:actualPath,runId:'REAL_PATH_TEST'});
  assert.equal(delivered.status,'SENT');
  assert.equal(JSON.parse(fs.readFileSync(actualPath,'utf8')).workflowRunId,'REAL_PATH_TEST');
  assert.equal(JSON.parse(fs.readFileSync(actualPath,'utf8')).claim,claimFor('morning'));
  assert.throws(()=>persistConfirmedSundaySent(confirmed,ready,{path:proofPath,runId:'DUPLICATE'}),
    /EEXIST/,'SENT receipt must not overwrite an existing proof');
  const failPath=join(proofDir,'should-not-exist.json');
  await assert.rejects(deliverAndRecordSunday(ready,{
    now:morning,path:failPath,runId:'FAILED_RUN',
    send:async()=>{throw Error('TELEGRAM_SEND_UNCONFIRMED_DO_NOT_RETRY');}
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
// Verify the real production formatter and prepare->compose path, not only
// injected mock messages. Every external request is rejected by the fixture,
// so this cannot fetch NH OAuth, GAS secrets, prices, or contact Telegram.
for (const [period,clock] of [['morning',morning],['close',closing]]) {
  const attemptedUrls=[];
  let claimChecks=0;
  const network=async endpoint=>{
    const url=String(endpoint);
    attemptedUrls.push(url);
    if (url===`https://api.github.com/repos/${REPO}/actions/artifacts?name=${claimFor(period)}&per_page=100`) {
      claimChecks++;
      return {ok:true,status:200,json:async()=>({total_count:0,artifacts:[]})};
    }
    // All live market-provider lookups fail closed, with no actual requests.
    return {ok:false,status:503};
  };
  const full=await composeSunday(period,{
    now:clock,gasUrl:'',gasToken:'',fetchImpl:network
  });
  assert.equal(full.sourceCount,0);
  assert.equal(typeof full.text,'string');
  assert.ok(full.text.length>100 && full.text.length<=4000);
  assert.ok(full.text.startsWith('[일요일 '));
  assert.match(full.text,/2026-11-01/);
  assert.match(full.text,/일요일 휴장/);
  assert.match(full.text,/미확보|자료 부족/);
  const readyWithRealCompose=await prepareSunday({
    period,now:clock,repository:REPO,gitToken:'SYNTHETIC-GITHUB',
    fetchImpl:network,
    compose:async (chosen,opts)=>composeSunday(chosen,{
      ...opts,gasUrl:'',gasToken:''
    })
  });
  assert.equal(claimChecks,1,'real prepare must check one dated claim');
  assert.equal(readyWithRealCompose.status,'PREPARED');
  assert.equal(readyWithRealCompose.ready,true);
  assert.equal(readyWithRealCompose.date,DATE);
  assert.equal(readyWithRealCompose.claim,claimFor(period));
  assert.equal(readyWithRealCompose.sourceCount,0);
  assert.equal(readyWithRealCompose.message,full.text);
  assert.ok(readyWithRealCompose.message.length<=4000,
    'the actual full message must fit the Telegram transport contract');
  assert.ok(attemptedUrls.every(u=>!u.includes('api.telegram.org')
    && !u.includes('oauth2.googleapis.com') && !u.includes('script.googleapis.com')),
  'read-only composer must not request Telegram, Google OAuth or Script APIs');
}

// The same real composer must accept only correctly dated past observations.
// All "providers" below are local synthetic responses. A stale Friday-US
// series and an NH-only index are deliberately denied; neither may be
// silently substituted or elevated to a verified Sunday close.
for (const [period,clock,expectedCount] of [
  ['morning',morning,4],['close',closing,5]
]) {
  const queried=[],forbidden=[];
  const chart=(symbol,isoDates,prices,zone='America/New_York')=>({
    chart:{result:[{meta:{symbol,exchangeTimezoneName:zone},
      timestamp:isoDates.map(x=>Date.parse(x)/1000),
      indicators:{quote:[{close:prices}]}}]}
  });
  const dated={
    '^DJI':chart('^DJI',['2026-10-29T20:00:00Z','2026-10-30T20:00:00Z'],[51000,51200]),
    'NVDA':chart('NVDA',['2026-10-29T20:00:00Z','2026-10-30T20:00:00Z'],[195,201]),
    'MU':chart('MU',['2026-10-28T20:00:00Z','2026-10-29T20:00:00Z'],[112,113]),
    '^TNX':chart('^TNX',['2026-10-29T20:00:00Z','2026-10-30T20:00:00Z'],[40.8,41.2]),
    'BTC-USD':chart('BTC-USD',['2026-10-30T18:00:00Z','2026-10-31T18:00:00Z'],[69000,70000],'Etc/UTC')
  };
  const syntheticFetch=async (endpoint,init={})=>{
    const url=String(endpoint);
    queried.push(url);
    if(url==='https://script.google.com/macros/s/TEST_SUNDAY_COMPOSE/exec'){
      const form=new URLSearchParams(init.body);
      assert.equal(form.get('action'),'getMarketBriefingMaster');
      assert.equal(form.get('accessToken'),'SYNTHETIC_ONLY');
      return {ok:true,status:200,json:async()=>({status:'ok',observations:[{
        seriesId:'KOSPI',status:'FINAL',value:4100,sourceDate:'2026-10-30',
        receivedAt:'2026-10-30T16:00:00+09:00',
        source:'KRX_OFFICIAL',finality:'REGULAR_CLOSE',session:'REGULAR'
      },{
        seriesId:'KOSDAQ',status:'FINAL',value:999,sourceDate:'2026-10-29',
        receivedAt:'2026-10-30T16:00:00+09:00',
        source:'KRX_OFFICIAL',finality:'REGULAR_CLOSE',session:'REGULAR'
      }]})};
    }
    if(url.includes('/v8/finance/chart/')){
      const symbol=decodeURIComponent(new URL(url).pathname.split('/').at(-1));
      if(['^GSPC','^IXIC','^NDX'].includes(symbol))
        forbidden.push(symbol);
      return dated[symbol]
        ?{ok:true,status:200,json:async()=>dated[symbol]}
        :{ok:false,status:503};
    }
    return {ok:false,status:503};
  };
  const full=await composeSunday(period,{now:clock,
    gasUrl:'https://script.google.com/macros/s/TEST_SUNDAY_COMPOSE/exec',
    gasToken:'SYNTHETIC_ONLY',fetchImpl:syntheticFetch});
  assert.equal(full.sourceCount,expectedCount);
  assert.ok(full.text.length<4000 && full.text.length>100);
  assert.match(full.text,/KOSPI: 4,100.*2026-10-30/);
  assert.match(full.text,/다우존스: 51,200.*2026-10-30/);
  assert.match(full.text,/엔비디아: 201.*2026-10-30/);
  assert.match(full.text,/미 10년물: 4.12%.*2026-10-30/);
  assert.match(full.text,/마이크론: (미확보|확정 출처 미확보)/);
  assert.doesNotMatch(full.text,/마이크론: 113/,'stale Thursday close cannot masquerade as Friday');
  assert.match(full.text,/S&P 500: (미확보|확정 출처 미확보)/);
  assert.match(full.text,/NASDAQ100: (미확보|확정 출처 미확보)/);
  if(period==='morning'){
    assert.match(full.text,/BTC: 미확보/,'Sunday 07:35 KST BTC must be skipped');
  }else{
    assert.match(full.text,/BTC: 70,000.*2026-10-31/);
  }
  assert.deepEqual(forbidden,[],'NH-only indices may not call Yahoo');
  assert.ok(queried.every(u=>!u.includes('api.telegram.org')
    && !u.includes('oauth2.googleapis.com') && !u.includes('script.googleapis.com')
    && !u.includes('getBenchmarks')),'synthetic data path must never trigger secrets, NH tokens or Telegram');
}

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
assert.ok(Object.hasOwn(wf.on,'push'),'workflow main push fallback is needed if Sunday cron slots never trigger');
assert.deepEqual(wf.on.push.branches,['main']);
assert.deepEqual(wf.on.push.paths,['.github/workflows/telegram-sunday-test-20261101.yml']);
assert.match(wf.jobs.test.if,/github.event_name == 'push'/);
assert.match(scriptSource,/event\?\.repository\?\.full_name!==REPO/);
assert.match(scriptSource,/windowFor\(period,instant\)\.allowed/);
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
 'production delivery orchestration must await real Telegram send');
assert.match(scriptSource,/const sent=await deliverAndRecordSunday\(payload,/,
 'production send CLI must use the tested send-and-proof orchestration');
assert.match(scriptSource,/if\(sent\?\.status!=='SENT'/,
 'proof must verify the accepted response before writing');
assert.doesNotMatch(scriptSource,/chatId:String\(process\.env\.TELEGRAM_CHAT_ID\)/,
 'SENT artifact must never contain Telegram credentials or recipient');

assert.equal(steps[send].env.GAS_ACCESS_TOKEN,undefined,'send must not receive GAS token');
assert.equal(steps.find(x=>x.id==='prepare').env.TELEGRAM_BOT_TOKEN,undefined,'prepare must not receive Telegram token');
console.log('SUNDAY_20261101_TELEGRAM_SIMULATION PASS slots=2 uniqueClaims=true pastOnly=true sends=1');
